// Drives the parent edit-child screen and the two invariants it depends on.
//
// The screen is small; the reason it needed its own verification is that it is
// the FIRST thing in the app that can mutate a student. Two latent defects had
// to be closed before it was safe to ship (migrations 20260719001500/1600), and
// this driver proves both hold through the real UI, not just in pgTAP.
//
//   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
//     < drivers/fixtures-student-identity.sql
//   node drivers/verify-edit-child.mjs
import { launch, loginExpo, tap } from "./lib.mjs";

// NOTE: getByText does SUBSTRING matching, so getByText("Edit") also matches
// "Credit Balance" — "Cr-edit-". Using .last() silently clicked the balance
// label and the driver reported "the form did not open". Always { exact: true }
// for short button labels.

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log("  PASS", label); }
  else { fail++; console.log("  FAIL", label, detail ? `\n        ${detail}` : ""); }
};

const { browser, page } = await launch({ mobile: true, headless: true });
await page.clock.install({ time: new Date("2026-07-19T10:00:00+08:00") });

try {
  console.log("\n[parent] edit a child's profile");
  await loginExpo(page, "identity@test.local");
  await tap(page.getByText("Noah Lim").first(), "Noah Lim");
  await page.waitForTimeout(2500);
  await tap(page.getByText("Edit", { exact: true }), "Edit");
  await page.waitForTimeout(2500);

  const form = await page.evaluate(() => document.body.innerText);
  check(/Edit Child/.test(form), "the edit form opened");

  // The form must arrive PRE-FILLED. An edit screen that opens blank silently
  // wipes whatever the parent doesn't retype.
  const nameVal = await page.getByPlaceholder("Emma Tan").inputValue();
  check(nameVal === "Noah Lim",
    "the form is pre-filled with the current values", `name field = "${nameVal}"`);

  // Noah has no DOB in the fixture — the legacy-row case. Supplying one is
  // exactly the backfill this screen exists for.
  await page.getByPlaceholder("Emma Tan").fill("Noah Lim Wei");
  await page.getByPlaceholder("YYYY-MM-DD").fill("2019-09-09");
  await tap(page.getByText("Save Changes"), "Save Changes");
  await page.waitForTimeout(3000);

  const stillOnForm = await page.getByPlaceholder("Emma Tan").isVisible().catch(() => false);
  check(!stillOnForm, "a valid edit saves and closes the form");

  const after = await page.evaluate(() => document.body.innerText);
  check(/Noah Lim Wei/.test(after), "the new name is shown straight away");
  check(/6 years old/.test(after),
    "age appears now that a DOB exists — derived, not stored",
    after.match(/Age[\s\S]{0,25}/)?.[0]);

  // ── The duplicate guard applies to edits, not just to creation ───────────
  console.log("\n[parent] editing INTO an existing identity is refused");
  await tap(page.getByText("Edit", { exact: true }), "Edit");
  await page.waitForTimeout(2000);
  await page.getByPlaceholder("Emma Tan").fill("Maya Tan");
  await page.getByPlaceholder("YYYY-MM-DD").fill("2020-07-19");
  await tap(page.getByText("Save Changes"), "Save Changes");
  await page.waitForTimeout(2500);

  const dup = await page.evaluate(() => document.body.innerText);
  check(/already registered here/.test(dup),
    "renaming one child into another's identity is refused, in English",
    dup.match(/Another child[^\n]*/)?.[0]);
  check(!/23505|duplicate key/i.test(dup), "no raw Postgres error reaches the parent");

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) process.exitCode = 1;
} catch (err) {
  console.error("DRIVER ERROR:", err.message);
  await page.screenshot({ path: "/tmp/edit-child-error.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
