// verify-packages-admin.mjs — the ten Packages admin actions no other driver
// presses: Show superseded (and Hide), Record a sale, the held search, Extend
// (with its refusal), Cancel of an ACTIVE package (Keep it, then Cancel
// package), Decline of a PENDING request (Keep it, then Decline), Retire /
// Reoffer, Add package (with its refusal), Add category (with the duplicate
// refusal), and a category's Default and Max (with the Max refusal).
//
// Fixture: fixtures-packages-admin.sql   Teardown: fixtures-packages-admin-teardown.sql
// Plan: docs/plans/DRIVER_BACKLOG_PLAN.md U5. BACKLOG item: "A verify-packages-admin driver…".
//
// Logs in as packages-admin-owner@swimsync.test — the owner-admin of the
// fixture's OWN business. Categories, their Default / Max and the product
// catalogue are tenant-level; editing the seed tenant's would move what
// verify-packages and verify-package-renewal read (plan rule 12).
//
// WHY THESE. Record a sale must write an ACTIVE package: the admin recording an
// offline sale IS the confirmation, and a sale saved pending sits in the
// Awaiting queue while the family's lessons bill ad hoc. Cancel and Decline are
// the SAME handler on two buttons, and the update is filtered by status — so
// every one is asserted on the row's DB status, not the modal closing (a
// filter that stops matching 'active' closes the modal and changes nothing).
// Extend is asserted as extend_package's effect: manual_extension_days, the
// recomputed expires_on, and the audit event (body read from the DB, §7.40).
// Held search and Show superseded are client-side, so what renders is asserted
// by reference number, and the DB is asserted unchanged.
//
// The Keep-it paths are Modal buttons, not window dialogs (launch()'s
// auto-accept is irrelevant here, §7.279) — each is still paired with a
// DB-unchanged assert. Every Supabase call is held to http://127.0.0.1:54321;
// anything else is ABORTED and fails the run (rule 14). No screen here buckets
// by time of day, so no clock pin (rule 13); "today" comes from the DB (§7.7).
//
// RE-RUN: re-load the fixture first (it RESETS every write this driver makes).
// A re-run on a dirty DB fails on its first PRECONDITION, by design (rule 5).
//
// MUTATION PROOFS (§7.25) — each made on app code, run, seen red, reverted
// (`git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean after):
//
//   | # | mutation                                                              | result | red checks |
//   |---|-----------------------------------------------------------------------|--------|------------|
//   | 1 | packages/dao/packages.repo.ts:142 → `.in("status", ["pending"])` (Cancel of an ACTIVE package matches 0 rows, no error) | 44/47 | "⚠ Cancel package moves the ACTIVE package to cancelled" (DB still active — the modal closed as if it worked), "the row now reads Cancelled…", "every package's status is where the driver put it…" |
//   | 2 | packages/domain/useSale.ts:54 → `status: "pending"` (a recorded sale is saved as a request) | 40/47 | "⚠ Record sale writes ONE ACTIVE package…" (pending, confirmed_by NULL), "the sale lands in Who-holds-one as Active…" (it sat in Awaiting), the held-search pair, "…Cedar's sale is untouched", "every package's status…", "Awaiting now reads (0)…" |
//
// (2026-09-26, both reverted; `git diff --exit-code -- SwimSyncAdmin SwimSyncApp` clean, and the served
// chunk re-grepped for the reverted code. SWC strips a `// MUTATION-PROOF` comment inside an object
// literal, so proof 2's arrival was grepped as `status: "pending"` in the served chunk instead.)

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

const EXPECTED_CHECKS = 47;

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

const TENANT = "c8000000-0000-0000-0000-000000000001";
const OWNER = "c8000000-0000-0000-0000-0000000000a1";
const PKG_ALDER = "c8000000-0000-0000-0000-0000000003a1";   // active
const PKG_OFFER = "c8000000-0000-0000-0000-0000000003a2";   // superseded offer
const PKG_REQUEST = "c8000000-0000-0000-0000-0000000003a3"; // pending request
const PROD_GROUP = "c8000000-0000-0000-0000-0000000002a1";
const PROD_RETIREE = "c8000000-0000-0000-0000-0000000002a3";
const CAT_GROUP = "c8000000-0000-0000-0000-00000000cc01";
const CAT_PRIVATE = "c8000000-0000-0000-0000-00000000cc02";
const CEDAR = sql(`SELECT id FROM parents WHERE profile_id='c8000000-0000-0000-0000-0000000000f3'`);
if (!CEDAR) throw new Error("fixture not loaded — load fixtures-packages-admin.sql first");
const ref = (id) => sql(`SELECT reference_number FROM parent_packages WHERE id='${id}'`);
const REF_ALDER = ref(PKG_ALDER);
const REF_OFFER = ref(PKG_OFFER);
const REF_REQUEST = ref(PKG_REQUEST);
const statusQ = (id) => `SELECT status FROM parent_packages WHERE id='${id}'`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
// The Modal primitive has no role; its overlay is the fixed z-50 layer.
const modal = (page) => page.locator("div.fixed.inset-0.z-50").last();
const flat = (s) => s.replace(/\s+/g, " ").trim();

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

// The page's sections, each scoped by its heading.
const section = (heading) =>
  page.locator("div.mb-8", { has: page.getByRole("heading", { name: heading, exact: true }) }).last();
const awaiting = () =>
  page.locator("div.mb-8", { has: page.getByRole("heading", { name: /^Awaiting confirmation/ }) });
const held = () => section("Who holds one");
const refsIn = async (loc) =>
  [...new Set(((await loc.innerText().catch(() => "")).match(/PKG-\d{4}-\d{4,}/g) ?? []))].sort().join(",");
async function refsUntil(loc, want, ms = 8000) {
  const end = Date.now() + ms;
  let v = await refsIn(loc);
  while (v !== want && Date.now() < end) { await page.waitForTimeout(250); v = await refsIn(loc); }
  return v;
}
const sorted = (...r) => [...r].sort().join(",");
const errorBanner = page.locator("div.border-red-200.bg-red-50");

try {
  await loginAdmin(page, "packages-admin-owner@swimsync.test");
  await page.goto(`${ADMIN}/packages`, { waitUntil: "networkidle" });

  // ══ 0. The starting state ══════════════════════════════════════════════════
  const pkgStateQ = `SELECT string_agg(right(id::text,3)||':'||status||':'||coalesce(right(superseded_by::text,3),'-'),
                       ',' ORDER BY id) FROM parent_packages WHERE tenant_id='${TENANT}'`;
  check("PRECONDITION: Alder active, Birch's offer superseded by her pending request, nothing else",
    sql(pkgStateQ) === "3a1:active:-,3a2:cancelled:3a3,3a3:pending:-", sql(pkgStateQ));
  const heldStart = await refsUntil(held(), REF_ALDER);
  check("Who-holds-one lists ONLY Alder's active package — not the pending request, not the superseded offer",
    heldStart === REF_ALDER && /PkgAdm Kid Alder/.test(await held().innerText()), heldStart);

  // ══ 1. Show superseded — client-side ═══════════════════════════════════════
  const awaitingStart = await refsUntil(awaiting(), REF_REQUEST);
  check("Awaiting shows the pending request only; the superseded offer is hidden by default",
    awaitingStart === REF_REQUEST && /Awaiting confirmation \(1\)/.test(await awaiting().innerText()), awaitingStart);
  await page.getByRole("button", { name: "Show superseded (1)" }).click();
  const shown = await refsUntil(awaiting(), sorted(REF_REQUEST, REF_OFFER));
  const offerRow = awaiting().locator("tr", { hasText: REF_OFFER });
  const offerText = flat(await offerRow.innerText().catch(() => ""));
  check("Show superseded reveals the offer, badged Superseded, with why",
    shown === sorted(REF_REQUEST, REF_OFFER) && /PkgAdm Parent Birch\s*Superseded/.test(offerText) &&
      /cancelled — a newer request replaced it/.test(offerText) &&
      (await offerRow.getByRole("button").count()) === 0, offerText.slice(0, 200));
  await page.getByRole("button", { name: "Hide superseded (1)" }).click();
  const hidden = await refsUntil(awaiting(), REF_REQUEST);
  check("Hide superseded hides it again (and the toggle wrote nothing)",
    hidden === REF_REQUEST && sql(pkgStateQ) === "3a1:active:-,3a2:cancelled:3a3,3a3:pending:-", hidden);

  // ══ 2. Record a sale ═══════════════════════════════════════════════════════
  const cedarQ = `SELECT status||'|'||name||'|'||total_value||'|'||start_date||'|'||coalesce(confirmed_by::text,'-')
                    FROM parent_packages WHERE parent_id='${CEDAR}' AND tenant_id='${TENANT}'`;
  check("PRECONDITION: Cedar holds no package", sql(cedarQ) === "", sql(cedarQ));
  await held().getByRole("button", { name: "Record a sale" }).click();
  const saleModal = modal(page);
  await saleModal.getByRole("heading", { name: "Record a sale" }).waitFor();
  await saleModal.locator("select").nth(0).selectOption({ label: "PkgAdm Parent Cedar" });
  await saleModal.locator("select").nth(1).selectOption({ label: "PkgAdm 10 Group — S$300.00" });
  const preview = await saleModal.getByText("Pays S$300.00").waitFor({ timeout: 8000 })
    .then(() => true).catch(() => false);
  const startField = saleModal.locator('input[type="date"]');
  const endStart = Date.now() + 8000;
  while (!(await startField.inputValue()) && Date.now() < endStart) await page.waitForTimeout(200);
  const saleStart = await startField.inputValue();
  check("choosing parent + package previews the price and suggests a start date",
    preview && /^\d{4}-\d{2}-\d{2}$/.test(saleStart), `preview ${preview} · start ${saleStart || "(empty)"}`);
  await saleModal.getByRole("button", { name: "Record sale" }).click();
  const sold = await dbUntil(cedarQ, (v) => v !== "");
  check("⚠ Record sale writes ONE ACTIVE package — the product's terms, the chosen start, confirmed by this admin",
    sold === `active|PkgAdm 10 Group|300.00|${saleStart}|${OWNER}`, sold || "(no row)");
  const REF_CEDAR = sql(`SELECT reference_number FROM parent_packages WHERE parent_id='${CEDAR}' AND tenant_id='${TENANT}'`);
  const heldAfterSale = await refsUntil(held(), sorted(REF_ALDER, REF_CEDAR));
  check("the sale lands in Who-holds-one as Active, not in the Awaiting queue",
    heldAfterSale === sorted(REF_ALDER, REF_CEDAR) &&
      /Active/.test(await held().locator("tr", { hasText: REF_CEDAR }).innerText()) &&
      (await refsIn(awaiting())) === REF_REQUEST, `held ${heldAfterSale} · awaiting ${await refsIn(awaiting())}`);

  // ══ 3. Held search — client-side ═══════════════════════════════════════════
  const search = held().getByPlaceholder("Search parent, package or ref…");
  await search.fill("Cedar");
  const byParent = await refsUntil(held(), REF_CEDAR);
  check("search by PARENT name narrows to that family's package", byParent === REF_CEDAR, byParent);
  await search.fill(REF_ALDER);
  const byRef = await refsUntil(held(), REF_ALDER);
  check("search by REFERENCE narrows to that package", byRef === REF_ALDER, byRef);
  await search.fill("zz-no-such-family");
  const none = await held().getByText("No held package matches “zz-no-such-family”.")
    .waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  check("a search matching nothing says so (and shows no rows)", none && (await refsIn(held())) === "",
    `message ${none} · ${await refsIn(held())}`);
  await search.fill("");
  const cleared = await refsUntil(held(), sorted(REF_ALDER, REF_CEDAR));
  check("clearing the search shows both held packages again", cleared === sorted(REF_ALDER, REF_CEDAR), cleared);

  // ══ 4. Extend (Alder) ══════════════════════════════════════════════════════
  const extQ = `SELECT manual_extension_days||'|'||(expires_on - start_date)||'|'||
                  (SELECT count(*) FROM package_extension_events WHERE parent_package_id='${PKG_ALDER}')
                  FROM parent_packages WHERE id='${PKG_ALDER}'`;
  check("PRECONDITION: Alder's package has no manual extension, expires start + 84 days, no events",
    sql(extQ) === "0|84|0", sql(extQ));
  const alderRow = held().locator("tr", { hasText: REF_ALDER });
  await alderRow.getByRole("button", { name: "Extend", exact: true }).click();
  const extModal = modal(page);
  await extModal.getByRole("heading", { name: "Extend PkgAdm 10 Group" }).waitFor();
  const weeks = extModal.locator("input").nth(0);
  await weeks.fill("0");
  await extModal.getByRole("button", { name: "Extend package" }).click();
  const refusedExt = await extModal.getByText("Enter a whole number of weeks above zero.")
    .waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(500);
  check("0 weeks is refused (\"Enter a whole number of weeks above zero.\"), DB unchanged",
    refusedExt && sql(extQ) === "0|84|0", `refusal ${refusedExt} · ${sql(extQ)}`);
  await weeks.fill("2");
  await extModal.getByPlaceholder("Goodwill").fill("PkgAdm goodwill");
  await extModal.getByRole("button", { name: "Extend package" }).click();
  const extended = await dbUntil(extQ, (v) => v.startsWith("14|"));
  check("⚠ Extend 2 weeks → extend_package adds 14 manual days and moves expires_on to start + 98",
    extended === "14|98|1", extended);
  const ev = sql(`SELECT kind||'|'||delta_days||'|'||reason||'|'||created_by FROM package_extension_events
                   WHERE parent_package_id='${PKG_ALDER}'`);
  check("…and records the extension event with the reason, by this admin",
    ev === `manual|14|PkgAdm goodwill|${OWNER}`, ev);
  const manualNote = await alderRow.getByText("+14 days · manual").waitFor({ timeout: 8000 })
    .then(() => true).catch(() => false);
  check("the held row shows the new expiry and \"+14 days · manual\"",
    manualNote && (await alderRow.innerText()).includes(sql(`SELECT expires_on FROM parent_packages WHERE id='${PKG_ALDER}'`)),
    flat(await alderRow.innerText().catch(() => "")).slice(0, 200));

  // ══ 5. Cancel an ACTIVE package (Alder) ════════════════════════════════════
  check("PRECONDITION: Alder's package is active", sql(statusQ(PKG_ALDER)) === "active", sql(statusQ(PKG_ALDER)));
  await alderRow.getByRole("button", { name: "Cancel", exact: true }).click();
  const cxModal = modal(page);
  const cxText = flat(await cxModal.innerText({ timeout: 8000 }).catch(() => "(no modal)"));
  check("Cancel on an ACTIVE package asks \"Cancel this package?\" and names what remains (S$300.00)",
    /Cancel this package\?/.test(cxText) && /S\$300\.00 remains on this package/.test(cxText), cxText.slice(0, 200));
  await cxModal.getByRole("button", { name: "Keep it" }).click();
  const keptClosed = await page.getByRole("heading", { name: "Cancel this package?" })
    .waitFor({ state: "detached", timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  check("Keep it closes the dialog and cancels nothing (DB still active)",
    keptClosed && sql(statusQ(PKG_ALDER)) === "active", `closed ${keptClosed} · ${sql(statusQ(PKG_ALDER))}`);
  await alderRow.getByRole("button", { name: "Cancel", exact: true }).click();
  await modal(page).getByRole("button", { name: "Cancel package" }).click();
  const cancelled = await dbUntil(statusQ(PKG_ALDER), (v) => v === "cancelled");
  check("⚠ Cancel package moves the ACTIVE package to cancelled (with cancelled_at)",
    cancelled === "cancelled" &&
      sql(`SELECT (cancelled_at IS NOT NULL)::text FROM parent_packages WHERE id='${PKG_ALDER}'`) === "true", cancelled);
  const alderGone = await alderRow.getByRole("button", { name: "Extend", exact: true })
    .waitFor({ state: "detached", timeout: 8000 }).then(() => true).catch(() => false);
  check("the row now reads Cancelled with no Extend / Cancel",
    alderGone && /Cancelled/.test(await alderRow.innerText()), flat(await alderRow.innerText().catch(() => "")).slice(0, 160));
  check("…and Cedar's sale is untouched (still active)", sql(cedarQ).startsWith("active|"), sql(cedarQ));

  // ══ 6. Decline a PENDING request (Birch) ═══════════════════════════════════
  check("PRECONDITION: Birch's request is pending", sql(statusQ(PKG_REQUEST)) === "pending", sql(statusQ(PKG_REQUEST)));
  const reqRow = awaiting().locator("tr", { hasText: REF_REQUEST });
  await reqRow.getByRole("button", { name: "Decline", exact: true }).click();
  const dcText = flat(await modal(page).innerText({ timeout: 8000 }).catch(() => "(no modal)"));
  check("Decline on a PENDING request asks \"Decline this request?\" — nothing was charged",
    /Decline this request\?/.test(dcText) && /The request is withdrawn\. Nothing was charged\./.test(dcText),
    dcText.slice(0, 200));
  await modal(page).getByRole("button", { name: "Keep it" }).click();
  const dcClosed = await page.getByRole("heading", { name: "Decline this request?" })
    .waitFor({ state: "detached", timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  check("Keep it declines nothing (DB still pending)",
    dcClosed && sql(statusQ(PKG_REQUEST)) === "pending", `closed ${dcClosed} · ${sql(statusQ(PKG_REQUEST))}`);
  await reqRow.getByRole("button", { name: "Decline", exact: true }).click();
  await modal(page).getByRole("button", { name: "Decline", exact: true }).click();
  const declined = await dbUntil(statusQ(PKG_REQUEST), (v) => v === "cancelled");
  check("Decline moves the PENDING request to cancelled", declined === "cancelled", declined);
  // Oldest first: Alder (−20 d), Birch's offer (−3 d), her request (−1 d), Cedar's sale (now).
  const allQ = `SELECT string_agg(status||':'||coalesce(right(superseded_by::text,3),'-'), ',' ORDER BY requested_at)
                  FROM parent_packages WHERE tenant_id='${TENANT}'`;
  check("every package's status is where the driver put it (Alder cancelled, offer still superseded, request cancelled, Cedar active)",
    sql(allQ) === "cancelled:-,cancelled:3a3,cancelled:-,active:-", sql(allQ));
  await page.getByRole("heading", { name: "Awaiting confirmation (0)" }).waitFor({ timeout: 8000 }).catch(() => {});
  const awaitingAfter = await awaiting().innerText().catch(() => "");
  check("Awaiting now reads (0) and the declined request moved to Who-holds-one as Cancelled",
    /Awaiting confirmation \(0\)/.test(awaitingAfter) &&
      /Cancelled/.test(await held().locator("tr", { hasText: REF_REQUEST }).innerText().catch(() => "")),
    flat(awaitingAfter).slice(0, 120));

  // ══ 7. Retire / Reoffer ════════════════════════════════════════════════════
  const retQ = `SELECT is_active::text FROM package_products WHERE id='${PROD_RETIREE}'`;
  check("PRECONDITION: PkgAdm Retiree is on offer", sql(retQ) === "true", sql(retQ));
  const products = section("What you sell");
  const retRow = products.locator("tr", { hasText: "PkgAdm Retiree" });
  const privDefault = page.locator(`li:has(#cap-${CAT_PRIVATE}) select`);
  await retRow.getByRole("button", { name: "Retire", exact: true }).click();
  const retired = await dbUntil(retQ, (v) => v === "false");
  const reofferBtn = await retRow.getByRole("button", { name: "Reoffer", exact: true })
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("Retire takes it off offer (DB), marks the row retired and offers Reoffer",
    retired === "false" && reofferBtn && /retired/.test(await retRow.innerText()), `${retired} · reoffer ${reofferBtn}`);
  const privOpts = await privDefault.locator("option").allInnerTexts();
  check("…and a retired package can no longer be picked as a category default",
    !privOpts.includes("PkgAdm Retiree") && privOpts.includes("PkgAdm 5 Any"), privOpts.join(" / "));
  await retRow.getByRole("button", { name: "Reoffer", exact: true }).click();
  const reoffered = await dbUntil(retQ, (v) => v === "true");
  const retireBack = await retRow.getByRole("button", { name: "Retire", exact: true })
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("Reoffer puts it back on offer", reoffered === "true" && retireBack, `${reoffered} · retire ${retireBack}`);

  // ══ 8. Add package ═════════════════════════════════════════════════════════
  const prodCountQ = `SELECT count(*) FROM package_products WHERE tenant_id='${TENANT}'`;
  check("PRECONDITION: the business sells exactly the fixture's three products", sql(prodCountQ) === "3", sql(prodCountQ));
  await products.getByRole("button", { name: "Add package" }).click();
  const pm = modal(page);
  await pm.getByRole("heading", { name: "Add package" }).waitFor();
  await pm.getByRole("button", { name: "Create package" }).click();
  const noName = await pm.getByText("The package needs a name.").waitFor({ timeout: 5000 })
    .then(() => true).catch(() => false);
  await page.waitForTimeout(500);
  check("Create with no name is refused (\"The package needs a name.\"), nothing written",
    noName && sql(prodCountQ) === "3", `refusal ${noName} · count ${sql(prodCountQ)}`);
  await pm.getByPlaceholder("10 Group Lessons").fill("PkgAdm Created 8");
  await pm.locator("select").first().selectOption({ label: "PkgAdm Private classes only" });
  await pm.getByPlaceholder("10", { exact: true }).fill("8");
  await pm.getByPlaceholder("40", { exact: true }).fill("45");
  await pm.locator("input").nth(3).fill("10");
  const sells = await pm.getByText("Sells for S$360.00").waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  await pm.getByRole("button", { name: "Create package" }).click();
  const newProdQ = `SELECT coalesce(category_id::text,'-')||'|'||lesson_count||'|'||rate_per_lesson||'|'||validity_weeks||'|'||
                      is_active||'|'||coalesce(referral_discount_type,'-')
                      FROM package_products WHERE tenant_id='${TENANT}' AND name='PkgAdm Created 8'`;
  const created = await dbUntil(newProdQ, (v) => v !== "");
  check("Create package writes the product: Private only, 8 x S$45, 10 weeks, active, inheriting referrals",
    sells && created === `${CAT_PRIVATE}|8|45.00|10|true|-`, `preview ${sells} · ${created || "(no row)"}`);
  const newRow = await products.locator("tr", { hasText: "PkgAdm Created 8" }).innerText({ timeout: 8000 }).catch(() => "");
  check("…and it appears in What-you-sell (S$360.00, 10 weeks)",
    /S\$360\.00/.test(newRow) && /10 weeks/.test(newRow), flat(newRow));

  // ══ 9. Add category ════════════════════════════════════════════════════════
  const cats = section("Class categories");
  const catsQ = `SELECT string_agg(name, ',' ORDER BY name) FROM class_categories WHERE tenant_id='${TENANT}'`;
  check("PRECONDITION: two categories", sql(catsQ) === "PkgAdm Group,PkgAdm Private", sql(catsQ));
  const catInput = cats.getByPlaceholder("Group", { exact: true });
  await catInput.fill("PkgAdm Squad");
  await cats.getByRole("button", { name: "Add category" }).click();
  const added = await dbUntil(catsQ, (v) => v.includes("PkgAdm Squad"));
  const squadShown = await cats.locator("li span.font-medium", { hasText: /^PkgAdm Squad$/ })
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("Add category creates it (DB) and lists it", added === "PkgAdm Group,PkgAdm Private,PkgAdm Squad" && squadShown,
    `${added} · listed ${squadShown}`);
  await catInput.fill("pkgadm group");
  await cats.getByRole("button", { name: "Add category" }).click();
  const dupMsg = await errorBanner.innerText({ timeout: 5000 }).catch(() => "(no banner)");
  check("a same-name category (any case) is refused by name, nothing written",
    dupMsg.trim() === 'You already have a category called "pkgadm group".' &&
      sql(catsQ) === "PkgAdm Group,PkgAdm Private,PkgAdm Squad", `${dupMsg} · ${sql(catsQ)}`);

  // ══ 10. Category Default and Max ═══════════════════════════════════════════
  const grpQ = `SELECT coalesce(default_product_id::text,'-')||'|'||coalesce(default_capacity::text,'-')
                  FROM class_categories WHERE id='${CAT_GROUP}'`;
  check("PRECONDITION: PkgAdm Group has no default and no max", sql(grpQ) === "-|-", sql(grpQ));
  const grpDefault = page.locator(`li:has(#cap-${CAT_GROUP}) select`);
  await grpDefault.selectOption({ label: "PkgAdm 10 Group" });
  const withDefault = await dbUntil(grpQ, (v) => v.startsWith(PROD_GROUP));
  check("Default: choosing PkgAdm 10 Group saves it as the category's renewal default",
    withDefault === `${PROD_GROUP}|-`, withDefault);
  const cap = page.locator(`#cap-${CAT_GROUP}`);
  await cap.fill("6");
  await cap.blur();
  const withCap = await dbUntil(grpQ, (v) => v.endsWith("|6"));
  check("Max: 6, on blur, saves default_capacity 6", withCap === `${PROD_GROUP}|6`, withCap);
  await page.locator(`#cap-${CAT_GROUP}`).fill("0");
  await page.locator(`#cap-${CAT_GROUP}`).blur();
  const capMsg = await errorBanner.innerText({ timeout: 5000 }).catch(() => "(no banner)");
  await page.waitForTimeout(500);
  check("Max 0 is refused by name (\"…a whole number of 1 or more…\"), DB still 6",
    capMsg.trim() === "Max students must be a whole number of 1 or more, or blank for no limit." &&
      sql(grpQ) === `${PROD_GROUP}|6`, `${capMsg} · ${sql(grpQ)}`);

  // ══ 11. Run-wide guards ════════════════════════════════════════════════════
  check("every Supabase call went to the local stack", offLocal.length === 0 && localApiCalls > 0,
    `local ${localApiCalls} · off-local ${offLocal.slice(0, 2).join(", ")}`);
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" || ").slice(0, 200));
} catch (err) {
  check("driver ran to completion", false, String(err).split("\n")[0]);
} finally {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/packages-admin-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  if (results.length !== EXPECTED_CHECKS) {
    console.log(`\n✗ ran ${results.length} checks, expected ${EXPECTED_CHECKS} — a check was skipped or added`);
    process.exitCode = 1;
  }
  if (passed !== results.length) process.exitCode = 1;
  console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
}
