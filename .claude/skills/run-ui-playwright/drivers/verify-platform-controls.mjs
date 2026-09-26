// verify-platform-controls.mjs — the five Platform surfaces no other driver
// opens: the stranded-parents panel ("Signed up but not in any business"), the
// `N unpaid` staff_without_rate chip, the Change / Set owner modal AND its
// stale-response guard, the "Credit stays with the old business" advisory
// (both exits, and BOTH checkFailed sites), and the Family status search.
//
// Fixture: fixtures-platform-controls.sql   Teardown: fixtures-platform-controls-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U8. BACKLOG item: "A verify-platform-controls driver…".
//
// Logs in as the seed PLATFORM admin (superadmin@swimsync.test). Every write
// lands on the fixture's own two businesses ("PlatCtl Alpha Swim", "PlatCtl
// Bravo Swim") — owners and one moved child — never on a seed row (plan rule 12).
//
// ⚠ CROSS-TENANT SURFACES. The Businesses table, the stranded panel, the move
// search and family status list EVERY business's rows, seed and sibling
// fixtures included. So this driver asserts its OWN rows by name, scoped to
// the card they live in (§7.246: tenant names appear in several tables), and
// never counts rows.
//
// ⚠ THE STALE-RESPONSE GUARD (useOwnerTransfer.ts:45/53/68) is driven with a
// PROMISE GATE, not a delay: Alpha's admin-list response is fetched and then
// HELD in the route handler until the driver has opened Bravo's modal and seen
// a Bravo-only admin rendered; only then is Alpha's released, and the driver
// waits for that request to FINISH before re-reading Bravo's modal. No timing
// window exists for a slow 04:00 runner to lose.
//
// ⚠ FORCED FAILURES (plan rule 9): the parent-link read (the first checkFailed
// site) and the balance read (the second) are each page.route'd → 500
// {"message":"forced by driver"}, GET only, scoped to ONE student's / one
// business's query, hit-counted and unrouted straight after.
//
// MUTATION PROOFS (§7.25) — each made on app code, run, seen red, reverted
// (`git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean after):
//
//   | # | mutation | result | red checks |
//   |---|----------|--------|------------|
//   | 1 | platform/domain/useStudentMove.ts:115 → `if (credit > 0) {` (checkFailed no longer prompts) | 20/37 | "⚠ a FAILED parent-link read still prompts…" (read "(no advisory)"), "Cancel moves nothing…" (Checkkid silently MOVED to Bravo), "a FAILED balance read also prompts…" and "closing the advisory (×) moves nothing…" (Creditkid moved too); the run then crashed — Creditkid's picker no longer offers Bravo |
//   | 2 | platform/ui/TenantsTable.tsx:175 → `t.staff_without_rate > 1 &&` (the chip hides a single unpaid coach) | 36/37 | "⚠ Alpha's Coaches cell flags its ONE rate-less staff coach: '1 unpaid'" (read "(no chip)") |
//   | 3 | platform/domain/useOwnerTransfer.ts:68 → `if (false && ownerModalTenantRef.current !== t.tenant_id) return;` (the stale guard off) | 10/37 | "⚠ Alpha's LATE admin list does not land in Bravo's modal (the ref guard)" (Bravo's modal read "PlatCtl Alpha Coadmin \| PlatCtl Alpha Owner — current owner"); the run then crashed — Bravo's admins were gone |
//
// (2026-09-26, all three reverted; `git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean. Each mutation's
// arrival was grepped in the served chunk `/_next/static/chunks/app/(admin)/platform/page.js` as the changed
// CODE — `if (credit > 0) {` with `credit > 0 || checkFailed` absent; `staff_without_rate > 1`; for #3 the
// compiler drops the `false &&` line, so the proof is `ownerModalTenantRef.current !== t.tenant_id` ABSENT —
// and each original re-grepped present after the revert.) Proof 3 is beyond the plan's two: the guard is the
// plan's named timing risk, and a promise-gated check that could not redden would be the vacuous kind.

import { execFileSync } from "node:child_process";
import { launch, loginAdmin, ADMIN, EXPO } from "./lib.mjs";

// ── Refuse anything but the local stack (plan rule 14) ──────────────────────
const API = "http://127.0.0.1:54321";
for (const u of [ADMIN, EXPO]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) {
    console.error(`refusing to run against a non-local URL: ${u}`);
    process.exit(2);
  }
}

const EXPECTED_CHECKS = 37;

const DB = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
  .split("\n").find((n) => n.startsWith("supabase_db_"));
if (!DB) throw new Error("no running supabase_db_* container — `supabase start` first");
const sql = (q) =>
  execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-Atc", q], { encoding: "utf8" }).trim();
// Poll until the DB value satisfies `ok` — a UI write lands asynchronously.
async function dbUntil(q, ok, ms = 10000) {
  const end = Date.now() + ms;
  let v = sql(q);
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    v = sql(q);
  }
  return v;
}

const ALPHA = "d5000000-0000-0000-0000-000000000001";
const BRAVO = "d5000000-0000-0000-0000-000000000002";
const A_OWNER = "d5000000-0000-0000-0000-0000000000a1";
const A_COADMIN = "d5000000-0000-0000-0000-0000000000a2";
const B_LEAD = "d5000000-0000-0000-0000-0000000000b1";
const STRANDED = "d5000000-0000-0000-0000-0000000000f1";
const TWOFAM = "d5000000-0000-0000-0000-0000000000f4";
const CREDITKID = "d5000000-0000-0000-0000-0000000000e1";
const CHECKKID = "d5000000-0000-0000-0000-0000000000e2";
if (sql(`SELECT count(*) FROM tenants WHERE id IN ('${ALPHA}','${BRAVO}')`) !== "2") {
  throw new Error("fixture not loaded — load fixtures-platform-controls.sql first");
}
const ALPHA_NAME = "PlatCtl Alpha Swim";
const BRAVO_NAME = "PlatCtl Bravo Swim";
const ALPHA_ADMINS = ["PlatCtl Alpha Owner", "PlatCtl Alpha Coadmin"];
const BRAVO_ADMINS = ["PlatCtl Bravo Deputy", "PlatCtl Bravo Lead"];

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const flat = (s) => s.replace(/\s+/g, " ").trim();
const FORCED = JSON.stringify({ message: "forced by driver", code: "P0001" });

const { browser, ctx, page } = await launch({ headless: true });
page.setDefaultTimeout(15000);
if (process.env.SHOT_DIR) console.log("shots:", process.env.SHOT_DIR);

// ── Network guard over the WHOLE run ────────────────────────────────────────
const offLocal = [];
let localApiCalls = 0;
await ctx.route(/\/(rest|auth|functions|storage)\/v1\//, (route) => {
  const origin = new URL(route.request().url()).origin;
  if (origin !== API) { offLocal.push(route.request().url()); return route.abort(); }
  localApiCalls++;
  return route.continue();
});
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// ── Page handles (each card scoped by its own heading) ──────────────────────
const card = (heading) =>
  page.locator("div.rounded-2xl", { has: page.getByRole("heading", { name: heading }) });
const bizCard = card(/^Businesses$/);
const strandedCard = card(/^Signed up but not in any business/);
const moveCard = card(/^Move a student to another business$/);
const famCard = card(/^Family status$/);
const bizRow = (name) => bizCard.locator("tr", { hasText: name });
// The Modal primitive renders null when closed; an open one is the fixed z-50
// layer, told apart by its title.
const modalTitled = (title) =>
  page.locator("div.fixed.inset-0.z-50", { has: page.getByRole("heading", { name: title, exact: true }) });
const ownerModal = (tenant) => modalTitled(`Change owner — ${tenant}`);
const creditModal = modalTitled("Credit stays with the old business");
const optionTexts = async (m) =>
  (await m.locator("option").allInnerTexts().catch(() => [])).map(flat).join(" | ");
const unpaidChip = (row) => row.locator("span", { hasText: /^\d+ unpaid$/ });

const tenantOf = (id) => sql(`SELECT tenant_id FROM students WHERE id='${id}'`);
const ownerOf = (id) => sql(`SELECT coalesce(owner_profile_id::text,'NULL') FROM tenants WHERE id='${id}'`);
const auditQ = (tenant) =>
  `SELECT count(*) FROM audit_log WHERE action='owner_reassigned' AND entity_id='${tenant}'`;
const bravoMembershipsQ = `SELECT count(*) FROM parent_tenants pt JOIN parent_students ps ON ps.parent_id = pt.parent_id
                            WHERE ps.student_id='${CREDITKID}' AND pt.tenant_id='${BRAVO}'`;
const alphaCreditQ = `SELECT coalesce(sum(b.credit_balance),0) FROM parent_tenant_balances b
                        JOIN parent_students ps ON ps.parent_id = b.parent_id
                       WHERE ps.student_id='${CREDITKID}' AND b.tenant_id='${ALPHA}'`;

async function searchChild(name) {
  await moveCard.getByPlaceholder("Search a child's name").fill(name);
  await moveCard.getByRole("button", { name: "Search", exact: true }).click();
  await moveCard.locator("tr", { hasText: name }).waitFor();
}
const pickerOf = (name) => moveCard.locator("tr", { hasText: name }).locator("select");

try {
  await loginAdmin(page, "superadmin@swimsync.test");
  await page.goto(`${ADMIN}/platform`, { waitUntil: "networkidle" });
  await bizRow(ALPHA_NAME).waitFor();

  // ══ 1. Stranded parents ═══════════════════════════════════════════════════
  check("PRECONDITION: the stranded parent has ZERO memberships; the credit parent has one",
    sql(`SELECT count(*) FROM parent_tenants pt JOIN parents p ON p.id = pt.parent_id WHERE p.profile_id='${STRANDED}'`) === "0" &&
    sql(`SELECT count(*) FROM parent_tenants pt JOIN parents p ON p.id = pt.parent_id
          WHERE p.profile_id='d5000000-0000-0000-0000-0000000000f2'`) === "1");
  const strandedRow = strandedCard.locator("tr", { hasText: "PlatCtl Stranded Parent" });
  const strandedText = (await strandedRow.count()) ? flat(await strandedRow.innerText()) : "(no row)";
  check("the stranded panel lists the parent with no business, with their email",
    strandedText.includes("platform-ctl-stranded@swimsync.test"), strandedText);
  check("…and does NOT list a parent who belongs to a business",
    (await strandedCard.locator("tr", { hasText: "PlatCtl Credit Mum" }).count()) === 0);

  // ══ 2. The `N unpaid` chip ════════════════════════════════════════════════
  const ratelessStaff = sql(`SELECT count(*) FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
     WHERE co.tenant_id='${ALPHA}' AND pr.role <> 'tenant_admin'
       AND NOT EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = co.id)`);
  const ratelessAdmins = sql(`SELECT count(*) FROM coaches co JOIN profiles pr ON pr.id = co.profile_id
     WHERE co.tenant_id IN ('${ALPHA}','${BRAVO}') AND pr.role = 'tenant_admin'
       AND NOT EXISTS (SELECT 1 FROM coach_rates r WHERE r.coach_id = co.id)`);
  check("PRECONDITION: Alpha has 1 rate-less STAFF coach (+1 rated); each business has a rate-less ADMIN coach",
    ratelessStaff === "1" && ratelessAdmins === "2", `staff ${ratelessStaff} · admins ${ratelessAdmins}`);
  const alphaChip = (await unpaidChip(bizRow(ALPHA_NAME)).count())
    ? flat(await unpaidChip(bizRow(ALPHA_NAME)).innerText()) : "(no chip)";
  check("⚠ Alpha's Coaches cell flags its ONE rate-less staff coach: '1 unpaid'", alphaChip === "1 unpaid", alphaChip);
  check("Bravo (a rate-less ADMIN coach only) carries no chip — the owner/admin is excluded in SQL (§7.131)",
    (await unpaidChip(bizRow(BRAVO_NAME)).count()) === 0, flat(await bizRow(BRAVO_NAME).innerText()));

  // ══ 3. Owner modal: the stale-response guard ══════════════════════════════
  check("PRECONDITION: Alpha is owned by its owner-admin, Bravo has NO owner, no transfer audited",
    ownerOf(ALPHA) === A_OWNER && ownerOf(BRAVO) === "NULL" &&
      sql(auditQ(ALPHA)) === "0" && sql(auditQ(BRAVO)) === "0",
    `Alpha ${ownerOf(ALPHA)} · Bravo ${ownerOf(BRAVO)}`);

  let releaseAlpha;
  const alphaGate = new Promise((r) => { releaseAlpha = r; });
  let alphaHits = 0;
  let alphaArrived;
  const alphaHeld = new Promise((r) => { alphaArrived = r; });
  const isAdminsRpc = (url) => {
    const u = new URL(url);
    return u.origin === API && u.pathname === "/rest/v1/rpc/platform_tenant_admins";
  };
  const holdAlpha = async (route) => {
    const req = route.request();
    if (req.method() !== "POST" || !(req.postData() ?? "").includes(ALPHA)) return route.fallback();
    alphaHits++;
    const response = await route.fetch();   // the server has answered…
    alphaArrived();
    await alphaGate;                        // …but the page does not see it yet
    return route.fulfill({ response });
  };
  await page.route(isAdminsRpc, holdAlpha);

  await bizRow(ALPHA_NAME).getByRole("button", { name: "Change owner" }).click();
  await ownerModal(ALPHA_NAME).waitFor();
  // Wait until the handler HOLDS Alpha's answer — never a sleep.
  await Promise.race([alphaHeld, new Promise((r) => setTimeout(r, 10000))]);
  const alphaLoading = await ownerModal(ALPHA_NAME).getByText("Loading admins…").isVisible();
  check("Alpha's modal is still loading while its admin list is HELD (the gate is live)",
    alphaLoading && alphaHits === 1, `loading ${alphaLoading} · hits ${alphaHits}`);

  await ownerModal(ALPHA_NAME).getByRole("button", { name: "Cancel" }).click();
  await ownerModal(ALPHA_NAME).waitFor({ state: "detached" });
  await bizRow(BRAVO_NAME).getByRole("button", { name: "Set owner" }).click();
  const bravoModal = ownerModal(BRAVO_NAME);
  await bravoModal.locator("option", { hasText: "PlatCtl Bravo Deputy" }).waitFor({ state: "attached" });
  const bravoBefore = await optionTexts(bravoModal);
  const bravoIntro = flat(await bravoModal.innerText());
  check("Set owner on an ownerless business says so, and lists ITS two admins",
    /this business currently has no owner at all/.test(bravoIntro) &&
      BRAVO_ADMINS.every((n) => bravoBefore.includes(n)) && !ALPHA_ADMINS.some((n) => bravoBefore.includes(n)),
    bravoBefore);

  // Release Alpha's response only now, and wait for it to be DELIVERED.
  const alphaDone = page.waitForEvent("requestfinished", {
    predicate: (r) => isAdminsRpc(r.url()) && (r.postData() ?? "").includes(ALPHA),
    timeout: 15000,
  });
  releaseAlpha();
  const delivered = await alphaDone.then(() => true).catch(() => false);
  check("Alpha's held response was released and delivered to the page, exactly once",
    delivered && alphaHits === 1, `delivered ${delivered} · hits ${alphaHits}`);
  await page.unroute(isAdminsRpc, holdAlpha);
  // The stale response has landed; poll Bravo's modal so a leak that paints a
  // beat late is still caught.
  let leaked = "";
  for (let i = 0; i < 8 && !leaked; i++) {
    const opts = await optionTexts(bravoModal);
    if (ALPHA_ADMINS.some((n) => opts.includes(n)) || !BRAVO_ADMINS.every((n) => opts.includes(n))) leaked = opts;
    else await page.waitForTimeout(200);
  }
  const bravoAfter = await optionTexts(bravoModal);
  check("⚠ Alpha's LATE admin list does not land in Bravo's modal (the ref guard)",
    !leaked && (await bravoModal.count()) === 1, leaked || bravoAfter);

  // ══ 4. Set owner — the write ══════════════════════════════════════════════
  await bravoModal.locator("select").selectOption({ label: "PlatCtl Bravo Lead" });
  await bravoModal.getByRole("button", { name: "Make PlatCtl Bravo Lead the owner" }).click();
  const bravoOwner = await dbUntil(`SELECT coalesce(owner_profile_id::text,'NULL') FROM tenants WHERE id='${BRAVO}'`,
    (v) => v === B_LEAD);
  check("Set owner makes the chosen admin Bravo's owner, and audits it",
    bravoOwner === B_LEAD && sql(auditQ(BRAVO)) === "1", `owner ${bravoOwner} · audit ${sql(auditQ(BRAVO))}`);
  const setMsg = await page.getByText(`${BRAVO_NAME} is now owned by platform-ctl-b-lead@swimsync.test.`)
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  await bizRow(BRAVO_NAME).getByText("platform-ctl-b-lead@swimsync.test").waitFor({ timeout: 8000 }).catch(() => {});
  const bravoRowNow = flat(await bizRow(BRAVO_NAME).innerText());
  check("…says so, and Bravo's row now shows the owner (no more 'no admin')",
    setMsg && bravoRowNow.includes("platform-ctl-b-lead@swimsync.test") && !bravoRowNow.includes("no admin"),
    `message ${setMsg} · ${bravoRowNow.slice(0, 120)}`);

  // ══ 5. Change owner — the write ═══════════════════════════════════════════
  check("PRECONDITION: the cancelled Alpha modal changed nothing", ownerOf(ALPHA) === A_OWNER, ownerOf(ALPHA));
  await bizRow(ALPHA_NAME).getByRole("button", { name: "Change owner" }).click();
  const alphaModal = ownerModal(ALPHA_NAME);
  await alphaModal.locator("option", { hasText: "PlatCtl Alpha Coadmin" }).waitFor({ state: "attached" });
  const ownerOpt = alphaModal.locator("option", { hasText: "PlatCtl Alpha Owner" });
  const ownerOptText = flat(await ownerOpt.innerText());
  const ownerOptDisabled = await ownerOpt.isDisabled();
  const coadminDisabled = await alphaModal.locator("option", { hasText: "PlatCtl Alpha Coadmin" }).isDisabled();
  check("the current owner is listed but NOT selectable; the co-admin is",
    ownerOptText === "PlatCtl Alpha Owner — current owner" && ownerOptDisabled && !coadminDisabled,
    `${ownerOptText} disabled=${ownerOptDisabled} · coadmin disabled=${coadminDisabled}`);
  await alphaModal.locator("select").selectOption({ label: "PlatCtl Alpha Coadmin" });
  await alphaModal.getByRole("button", { name: "Make PlatCtl Alpha Coadmin the owner" }).click();
  const alphaOwner = await dbUntil(`SELECT coalesce(owner_profile_id::text,'NULL') FROM tenants WHERE id='${ALPHA}'`,
    (v) => v === A_COADMIN);
  const auditRow = sql(`SELECT old_value->>'owner_profile_id'||'>'||(new_value->>'owner_profile_id')
                          FROM audit_log WHERE action='owner_reassigned' AND entity_id='${ALPHA}'`);
  check("Change owner moves Alpha to the co-admin, audited old → new",
    alphaOwner === A_COADMIN && auditRow === `${A_OWNER}>${A_COADMIN}`, `owner ${alphaOwner} · audit ${auditRow}`);
  await bizRow(ALPHA_NAME).getByText("platform-ctl-a-coadmin@swimsync.test").waitFor({ timeout: 8000 }).catch(() => {});
  const alphaRowNow = flat(await bizRow(ALPHA_NAME).innerText());
  check("…and Alpha's row now shows the new owner's email",
    alphaRowNow.includes("platform-ctl-a-coadmin@swimsync.test") && !alphaRowNow.includes("platform-ctl-a-owner@"),
    alphaRowNow.slice(0, 120));

  // ══ 6. Credit advisory — checkFailed at the PARENT-LINK read ══════════════
  check("PRECONDITION: Checkkid (no parents) is at Alpha", tenantOf(CHECKKID) === ALPHA, tenantOf(CHECKKID));
  await searchChild("PlatCtl Checkkid");
  let linkHits = 0;
  const isCheckkidLinks = (url) => {
    const u = new URL(url);
    return u.origin === API && u.pathname === "/rest/v1/parent_students" &&
      u.searchParams.get("student_id") === `eq.${CHECKKID}`;
  };
  const failLinks = (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    linkHits++;
    return route.fulfill({ status: 500, contentType: "application/json", body: FORCED });
  };
  await page.route(isCheckkidLinks, failLinks);
  await pickerOf("PlatCtl Checkkid").selectOption({ label: BRAVO_NAME });
  const failedShown = await creditModal.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  const failedText = failedShown ? flat(await creditModal.innerText()) : "(no advisory)";
  check("⚠ a FAILED parent-link read still prompts, with the couldn't-check copy (no bogus S$0.00)",
    /Couldn't check whether PlatCtl Checkkid's family holds credit at PlatCtl Alpha Swim/.test(failedText) &&
      !/S\$/.test(failedText),
    failedText.slice(0, 160));
  await page.unroute(isCheckkidLinks, failLinks);
  check("the route matched exactly the one parent_students GET", linkHits === 1, `hits ${linkHits}`);
  if (failedShown) await creditModal.getByRole("button", { name: "Cancel" }).click();
  await creditModal.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  // Give a (mutated) silent move-through time to land before reading "unmoved".
  await page.waitForTimeout(1000);
  const checkPicker = await pickerOf("PlatCtl Checkkid").inputValue().catch(() => "(no picker)");
  check("Cancel moves nothing and resets the picker to 'Choose…'",
    tenantOf(CHECKKID) === ALPHA && checkPicker === "", `tenant ${tenantOf(CHECKKID)} · picker '${checkPicker}'`);

  // ══ 7. Credit advisory — checkFailed at the BALANCE read ══════════════════
  check("PRECONDITION: Creditkid is at Alpha, its two parents hold S$137.50 there and no Bravo membership",
    tenantOf(CREDITKID) === ALPHA && sql(alphaCreditQ) === "137.50" && sql(bravoMembershipsQ) === "0",
    `tenant ${tenantOf(CREDITKID)} · credit ${sql(alphaCreditQ)} · Bravo memberships ${sql(bravoMembershipsQ)}`);
  await searchChild("PlatCtl Creditkid");
  let balHits = 0;
  const isAlphaBalances = (url) => {
    const u = new URL(url);
    return u.origin === API && u.pathname === "/rest/v1/parent_tenant_balances" &&
      u.searchParams.get("tenant_id") === `eq.${ALPHA}`;
  };
  const failBal = (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    balHits++;
    return route.fulfill({ status: 500, contentType: "application/json", body: FORCED });
  };
  await page.route(isAlphaBalances, failBal);
  await pickerOf("PlatCtl Creditkid").selectOption({ label: BRAVO_NAME });
  const balShown = await creditModal.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  const balText = balShown ? flat(await creditModal.innerText()) : "(no advisory)";
  await page.unroute(isAlphaBalances, failBal);
  check("a FAILED balance read also prompts with the couldn't-check copy (the second site), route hit once",
    /Couldn't check whether PlatCtl Creditkid's family/.test(balText) && !/S\$/.test(balText) && balHits === 1,
    `${balText.slice(0, 100)} · hits ${balHits}`);
  // The OTHER exit: the modal's own close (X) — Modal's onClose path.
  if (balShown) await creditModal.getByRole("button").first().click();
  await creditModal.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  const credPicker1 = await pickerOf("PlatCtl Creditkid").inputValue().catch(() => "(no picker)");
  check("closing the advisory (×) moves nothing and resets the picker",
    (await creditModal.count()) === 0 && tenantOf(CREDITKID) === ALPHA && credPicker1 === "",
    `open ${await creditModal.count()} · tenant ${tenantOf(CREDITKID)} · picker '${credPicker1}'`);

  // ══ 8. Credit advisory — the real balance, both exits ═════════════════════
  await pickerOf("PlatCtl Creditkid").selectOption({ label: BRAVO_NAME });
  await creditModal.waitFor({ timeout: 8000 });
  const creditText = flat(await creditModal.innerText());
  check("⚠ the advisory names the family's credit SUMMED over both parents (S$137.50), the child and the old business",
    /PlatCtl Creditkid's family holds S\$137\.50 in credit at PlatCtl Alpha Swim/.test(creditText) &&
      /unspendable/.test(creditText),
    creditText.slice(0, 160));
  await creditModal.getByRole("button", { name: "Cancel" }).click();
  await creditModal.waitFor({ state: "detached" });
  await page.waitForTimeout(800);
  const credPicker2 = await pickerOf("PlatCtl Creditkid").inputValue();
  check("Cancel → nothing moved: still at Alpha, no Bravo membership, picker reset",
    tenantOf(CREDITKID) === ALPHA && sql(bravoMembershipsQ) === "0" && credPicker2 === "",
    `tenant ${tenantOf(CREDITKID)} · Bravo memberships ${sql(bravoMembershipsQ)} · picker '${credPicker2}'`);

  await pickerOf("PlatCtl Creditkid").selectOption({ label: BRAVO_NAME });
  await creditModal.getByRole("button", { name: "Move anyway" }).click();
  const moved = await dbUntil(`SELECT tenant_id FROM students WHERE id='${CREDITKID}'`, (v) => v === BRAVO);
  const movedMsg = await moveCard.getByText(/^Moved\. Any active class enrolment was closed/)
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("Move anyway → the child IS moved to Bravo, and the page says 'Moved.'",
    moved === BRAVO && movedMsg, `tenant ${moved} · message ${movedMsg}`);
  check("both parents now belong to Bravo, and the credit STAYS at Alpha (PRD §5.6)",
    sql(bravoMembershipsQ) === "2" && sql(alphaCreditQ) === "137.50",
    `Bravo memberships ${sql(bravoMembershipsQ)} · Alpha credit ${sql(alphaCreditQ)}`);
  // The "Currently with" cell only: the row's picker lists business names too.
  const movedCell = flat(await moveCard.locator("tr", { hasText: "PlatCtl Creditkid" }).locator("td").nth(1).innerText());
  check("the refreshed result shows the child with Bravo", movedCell === BRAVO_NAME, movedCell);

  // ══ 9. Family status ══════════════════════════════════════════════════════
  check("PRECONDITION: the two-business parent is active at Alpha, INACTIVE at Bravo, one child at each",
    sql(`SELECT string_agg(t.display_name||':'||pt.is_active, ',' ORDER BY t.display_name)
           FROM parent_tenants pt JOIN parents p ON p.id = pt.parent_id JOIN tenants t ON t.id = pt.tenant_id
          WHERE p.profile_id='${TWOFAM}'`) === `${ALPHA_NAME}:true,${BRAVO_NAME}:false`);
  const famSearch = async (term) => {
    await famCard.getByPlaceholder("Search a parent's name or email").fill(term);
    // Two "Search" buttons on the page (§7.244) — scoped to this card, and it
    // is the LAST one in DOM order.
    await famCard.getByRole("button", { name: "Search", exact: true }).click();
  };
  await famSearch("PlatCtl Twofam");
  const famRow = (tenant) => famCard.locator("tr", { hasText: "PlatCtl Twofam Parent" }).filter({ hasText: tenant });
  await famRow(ALPHA_NAME).waitFor();
  const alphaFam = flat(await famRow(ALPHA_NAME).innerText());
  const bravoFam = (await famRow(BRAVO_NAME).count()) ? flat(await famRow(BRAVO_NAME).innerText()) : "(no row)";
  check("a search returns one row PER BUSINESS for a two-business parent",
    (await famRow(ALPHA_NAME).count()) === 1 && (await famRow(BRAVO_NAME).count()) === 1, `${alphaFam} || ${bravoFam}`);
  check("⚠ each row carries only THAT business's child (the tenant narrowing)",
    alphaFam.includes("PlatCtl Kid Alpha") && !alphaFam.includes("PlatCtl Kid Bravo") &&
      bravoFam.includes("PlatCtl Kid Bravo") && !bravoFam.includes("PlatCtl Kid Alpha"),
    `${alphaFam} || ${bravoFam}`);
  check("…and the family's status per business (Active at Alpha, Inactive at Bravo)",
    /\bActive\b/.test(alphaFam) && !/Inactive/.test(alphaFam) && /Inactive/.test(bravoFam),
    `${alphaFam} || ${bravoFam}`);

  await famSearch("platform-ctl-twofam@");
  await famRow(BRAVO_NAME).waitFor({ timeout: 8000 }).catch(() => {});
  check("the same family is found by EMAIL",
    (await famRow(ALPHA_NAME).count()) === 1 && (await famRow(BRAVO_NAME).count()) === 1);

  await famSearch("PlatCtl Nobody Matches Zq");
  const none = await famCard.getByText("No families matched.").waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("a term that matches nobody says 'No families matched.' and clears the table",
    none && (await famCard.locator("tbody tr").count()) === 0);

  check("every Supabase call went to the local stack", offLocal.length === 0 && localApiCalls > 0,
    `local ${localApiCalls} · off-local ${offLocal.slice(0, 2).join(", ")}`);
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" || ").slice(0, 200));
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/platform-controls-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
