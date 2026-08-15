// The parent's contact details, from the admin Students page.
//
// WHY THIS EXISTS. `provisional_contact_phone` and `_email` are the top two
// ranked signals in find_student_candidates(), and until now nothing could
// change them: a child added with a wrong number could never be matched to
// their parent, and the only remedy was SQL. Production carries `964` on a real
// child for exactly that reason.
//
// THE LOAD-BEARING ASSERTIONS, in the order they'd hurt if they broke:
//   • a child with a PENDING claim is LOCKED. student_claims.match_reason is a
//     snapshot, so editing the phone underneath a pending claim leaves the
//     Claims queue asserting a reason that is no longer true — and the admin
//     approves a parent–child link on it. Nothing but that flow's own undo can
//     unlink them afterwards (§7.47).
//   • the claimed branch shows the parent's REAL details, asserted as exact
//     strings. The join runs through an `any`-typed select where the wrong
//     nesting level typechecks and renders blank (§7.28), and two sessions
//     running shipped exactly that class of invisible read-path bug (§7.48).
//   • Yolanda has a parent of her own and NO enrolment. If tenant_serves_parent()
//     keyed off enrolment rather than students.tenant_id, her details would be
//     invisible to her own business — and routing the check through Xavier
//     instead would pass vacuously.
//   • the `964` warning renders AND the save still succeeds. A validator that
//     blocks is a regression, not a feature.
//   • the Students table still lists every row it listed before. The contact
//     data is fetched when the modal opens, NOT added to the page's one big
//     select, precisely so a mistake here cannot empty the admin's main screen.
//
// Setup:
//   psql -f drivers/fixtures-contact-details.sql
//   cd SwimSyncAdmin && npm run dev
//   node drivers/verify-contact-details.mjs
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => path.join(SHOT, n);
const results = [];
const check = (l, p, d = "") => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`);
};

const sql = (q) =>
  execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -tAc ${JSON.stringify(
      q.replace(/\s+/g, " ").trim()
    )}`,
    { encoding: "utf8" }
  ).trim();

const WANDA = "cd000000-0000-0000-0000-000000000011";

// ⚠ THE DRIVER RESETS WHAT THE DRIVER EDITS. This run rewrites Wanda's three
// fields, so a second run without re-applying the fixture would assert against
// whatever the first run typed and fail on checks 2 and 3 — a failure that
// looks exactly like a real regression. Structural, so nobody has to remember.
sql(`UPDATE students SET provisional_contact_name  = 'Old Contact Name',
                        provisional_contact_phone = '964',
                        provisional_contact_email = 'old@example.com'
      WHERE id = '${WANDA}'`);

// The row whose "Contact details" button we want. Scoping by row keeps this
// honest on a page that lists every child in the business.
const rowFor = (page, name) =>
  page.locator("tbody tr").filter({ hasText: name });

// Contact details now lives in the per-row Actions drawer (Decision 10): open
// the drawer for the row, then click its Contact details button.
const openContact = async (page, name) => {
  await rowFor(page, name).getByRole("button", { name: /^Actions$/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Contact details" }).click();
  await page.waitForTimeout(1200);
};

// The Modal has no Escape handler, and its backdrop sits ABOVE the panel in
// paint order, so a backdrop click is intercepted by the backdrop itself. The X
// in the panel header is the reliable way out.
const closeModal = async (page) => {
  await page.locator("div.relative.z-10").getByRole("button").first().click();
  await page.waitForTimeout(600);
};

// The tenant ADMIN, not the platform admin: superadmin@ is refused on the
// eleven single-business pages by design, so driving this as them would
// measure nothing.
const { browser, page } = await launch();
await loginAdmin(page, "coach@swimsync.test", "password123");
await page.goto(`${ADMIN}/students`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

// ══ Risk 3: the page still lists what it listed before ════════════════════
const rowCount = await page.locator("tbody tr").count();
const dbCount = Number(
  sql(`SELECT count(*) FROM students
        WHERE tenant_id = '70000000-0000-0000-0000-000000000001' AND is_active`)
);
check(
  "the Students table lists every active child in the business",
  rowCount === dbCount,
  `table ${rowCount} vs db ${dbCount} — a mismatch means the page's one big select broke`
);

// ══ 1. UNCLAIMED — editable, and the production number is called out ══════
await openContact(page, "Wanda Unclaimed");
await page.screenshot({ path: shot("cd-01-unclaimed.png"), fullPage: true });
let text = await page.evaluate(() => document.body.innerText);

const nameInput = page.locator('input[placeholder="Sarah Lim"]');
const phoneInput = page.locator('input[placeholder="9123 4567"]');
const emailInput = page.locator('input[placeholder="sarah@example.com"]');

check(
  "an unclaimed child opens EDITABLE, pre-filled with what was taken at signup",
  (await nameInput.inputValue()) === "Old Contact Name" &&
    (await phoneInput.inputValue()) === "964" &&
    (await emailInput.inputValue()) === "old@example.com"
);

check(
  "`964` is called out as unable to match — the production case",
  /Too short to be a phone number/i.test(text) && /match/i.test(text),
  "this is the whole reason the number was worth checking"
);

// ══ 2. The warning does not block the save ════════════════════════════════
const saveBtn = page.getByRole("button", { name: /Save contact details/i });
check(
  "Save is OFFERED while the warning is showing",
  await saveBtn.isEnabled(),
  "a validator that blocks would be a regression — the admin may only have that number"
);

// ══ 3. Edit all three and persist ═════════════════════════════════════════
await nameInput.fill("Sarah Lim");
await phoneInput.fill("+65 9123 4567");
await emailInput.fill("sarah.lim@example.com");
await page.waitForTimeout(300);
text = await page.evaluate(() => document.body.innerText);
check(
  "a well-formed mobile clears the warning",
  !/Too short to be a phone number/i.test(text)
);

await saveBtn.click();
await page.waitForTimeout(1500);

const saved = sql(`SELECT provisional_contact_name || '|' ||
                          provisional_contact_phone || '|' ||
                          provisional_contact_email
                     FROM students WHERE id = '${WANDA}'`);
check(
  "all three fields persisted",
  saved === "Sarah Lim|+65 9123 4567|sarah.lim@example.com",
  saved
);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await openContact(page, "Wanda Unclaimed");
check(
  "and they are still there when the modal is reopened",
  (await page.locator('input[placeholder="Sarah Lim"]').inputValue()) === "Sarah Lim"
);

// ══ 4. A cleared field becomes NULL, not '' ═══════════════════════════════
await page.locator('input[placeholder="sarah@example.com"]').fill("");
await page.getByRole("button", { name: /Save contact details/i }).click();
await page.waitForTimeout(1500);

const isNull = sql(
  `SELECT provisional_contact_email IS NULL FROM students WHERE id = '${WANDA}'`
);
check(
  "a cleared field is written as NULL, matching the creation path",
  isNull === "t",
  `IS NULL returned '${isNull}' — '' here would differ from every row add_unclaimed_student made`
);

// ══ 5. CLAIMED + ENROLLED — read-only, showing the parent's own row ═══════
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await openContact(page, "Xavier Claimedkid");
await page.screenshot({ path: shot("cd-02-claimed.png"), fullPage: true });
text = await page.evaluate(() => document.body.innerText);

check(
  "a claimed child shows the parent's REAL details, exactly as stored",
  text.includes("Priya Raman") &&
    text.includes("cdparenta@swimsync.test") &&
    text.includes("+65 8123 4567"),
  "asserted as exact strings: a blank field is what the any-typed join fails to"
);
check(
  "…and offers no way to edit them",
  (await page.locator('input[placeholder="9123 4567"]').count()) === 0 &&
    (await page.getByRole("button", { name: /Save contact details/i }).count()) === 0
);
check(
  "…and says where the parent changes them",
  /Profile\s*→\s*Contact Details/i.test(text),
  "otherwise the admin has a read-only screen and no idea what to do about it"
);
check(
  "BOTH of a child's parents are shown, not whichever row came back first",
  text.includes("Priya Raman") &&
    text.includes("Devi Raman") &&
    text.includes("8222 3333") &&
    /Parent 1 of 2/.test(text),
  "'the mother's number rather than the father's' is the reason this screen exists"
);

// ══ 6. CLAIMED, NO ENROLMENT — the RLS case ═══════════════════════════════
await closeModal(page);
await openContact(page, "Yolanda Noclass");
text = await page.evaluate(() => document.body.innerText);
check(
  "a claimed child with NO enrolment still shows her parent's details",
  text.includes("Marcus Chen") && text.includes("9876 5432"),
  "her parent has no other children, so nothing else could make them readable"
);

// ══ 7. PENDING CLAIM — locked ═════════════════════════════════════════════
await closeModal(page);
await openContact(page, "Zane Pendingclaim");
await page.screenshot({ path: shot("cd-03-pending.png"), fullPage: true });
text = await page.evaluate(() => document.body.innerText);

check(
  "a child with a pending claim is LOCKED, and says why",
  /currently claiming this child/i.test(text) && /no longer true/i.test(text)
);
check(
  "…with no Save offered at all",
  (await page.getByRole("button", { name: /Save contact details/i }).count()) === 0,
  "editing here would strand the Claims queue on a snapshotted match_reason"
);
check(
  "…while still showing what the details ARE",
  text.includes("Locked Contact") && text.includes("91110000"),
  "locked is not the same as hidden — the admin still needs to reach the family"
);
check(
  "…and points at the queue that unblocks it",
  (await page.getByRole("link", { name: /Parent claims/i }).count()) > 0
);

// ══ 8. The create forms warn WITHOUT blocking ═════════════════════════════
// Risk 4: these are live paths that already worked. The phone stays REQUIRED —
// that guard is untouched — but its SHAPE must never gate submit, or an admin
// holding an unusual number can no longer add the child at all.
await closeModal(page);

// Enrolments are FK-RESTRICTed on purpose (history must survive, PRD §11.5),
// so the child cannot be removed without their enrolment going first.
const purgeQuentin = () => {
  sql(`DELETE FROM student_class_enrolments WHERE student_id IN
         (SELECT id FROM students WHERE full_name = 'Quentin Newkid')`);
  sql(`DELETE FROM students WHERE full_name = 'Quentin Newkid'`);
};
purgeQuentin();

await page.getByRole("button", { name: /^Add student$/ }).first().click();
await page.waitForTimeout(800);

const modal = page.locator("div.relative.z-10");
await modal.locator("label").filter({ hasText: "Child's full name" })
  .locator("input").fill("Quentin Newkid");
await modal.locator("select").selectOption({ label: "Saturday Beginners" });
await modal.locator("label").filter({ hasText: "Parent's phone" })
  .locator("input").fill("964");
await page.waitForTimeout(400);

text = await page.evaluate(() => document.body.innerText);
check(
  "Add-a-student warns about a number that cannot match",
  /Too short to be a phone number/i.test(text)
);

const addBtn = modal.getByRole("button", { name: /^Add student$/ });
check(
  "…but the Add button stays enabled — the shape never gates submit",
  await addBtn.isEnabled(),
  "the phone is required; its FORMAT is advice"
);

await addBtn.click();
await page.waitForTimeout(2000);
check(
  "…and the child is actually created",
  sql(`SELECT count(*) FROM students WHERE full_name = 'Quentin Newkid'`) === "1",
  "a create that fails here would be a regression, not a validation win"
);
purgeQuentin();

// ══ 9. The same warning on the Trials booking form ════════════════════════
await page.goto(`${ADMIN}/trials`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /Book a trial/i }).first().click();
await page.waitForTimeout(800);
await page.locator('input[placeholder="Parent\'s phone *"]').fill("964");
await page.waitForTimeout(400);
text = await page.evaluate(() => document.body.innerText);
check(
  "Book-a-trial warns on the same number",
  /Too short to be a phone number/i.test(text),
  "the other door bad contact data comes in through"
);
await page.screenshot({ path: shot("cd-04-trials.png"), fullPage: true });

await browser.close();

const failed = results.filter((r) => !r).length;
console.log(
  `\n${results.length - failed}/${results.length} checks passed${
    failed ? ` — ${failed} FAILED` : ""
  }`
);
process.exit(failed ? 1 : 0);
