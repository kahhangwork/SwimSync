// Admin class terms — effective-dated price/coach via set_class_terms
// (migrations 20260719000700–001000).
//
// The property under test is that editing a class's PRICE no longer reaches
// backwards into lessons already taught. That was a live defect: core.ts priced
// each invoice item from the class's CURRENT price at generation time, so a
// rise on the 3rd silently repriced the whole previous month.
//
// Driven rather than asserted in SQL because the correct-vs-change choice only
// exists in the UI — the RPC cannot tell a typo from a price rise, so if the
// form fails to ask, the whole distinction is decorative.
//
// Setup: supabase running + seed ("Saturday Beginners" @ $25);
//        cd SwimSyncAdmin && npm run dev
import os from "node:os";
import path from "node:path";
import { launch, loginAdmin } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (name) => path.join(SHOT, name);
const results = [];
const check = (label, pass, detail = "") => {
  results.push({ pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
import { execSync } from "node:child_process";
const sql = (q) =>
  execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tA -c ${JSON.stringify(q)}`,
    { encoding: "utf8" }
  ).trim();

const { browser, page } = await launch();
await loginAdmin(page, "superadmin@swimsync.test", "password123");
await page.goto("http://localhost:3000/classes");
await page.waitForTimeout(1500);

const openEdit = async () => {
  const row = page.locator("tr", { hasText: "Saturday Beginners" });
  await row.getByRole("button", { name: /Edit/i }).click();
  await page.waitForTimeout(600);
};

// ── 1. A rename must NOT ask about money, and must record no dated row ───────
const ratesBefore = Number(sql("SELECT count(*) FROM class_rates"));
await openEdit();
await page.getByPlaceholder("e.g. Saturday Beginners").fill("Saturday Beginners AM");
let body = await page.innerText("body");
check(
  "renaming does NOT show the correct-vs-change prompt",
  !/Which is this\?/i.test(body)
);
await page.getByRole("button", { name: /Save Changes/i }).click();
await page.waitForTimeout(1500);
check(
  "a rename records no new dated terms row",
  Number(sql("SELECT count(*) FROM class_rates")) === ratesBefore,
  `${ratesBefore} → ${sql("SELECT count(*) FROM class_rates")}`
);

// ── 2. Changing the price MUST ask, and must default to the safe option ──────
await openEdit();
await page.getByPlaceholder("40").fill("55");
await page.waitForTimeout(400);
body = await page.innerText("body");
check("changing the price shows the correct-vs-change prompt", /Which is this\?/i.test(body));
check(
  "the prompt explains that past lessons keep the old rate",
  /Lessons already taught\s+keep the old rate/i.test(body.replace(/\s+/g, " ")) ||
    /keep the old rate/i.test(body)
);
await page.screenshot({ path: shot("class-terms-prompt.png"), fullPage: true });

// "A change from today" is preselected — the option that cannot rewrite history.
const changeRadio = page.locator('input[type="radio"]').first();
check("the non-destructive option is preselected", await changeRadio.isChecked());

await page.getByRole("button", { name: /Save Changes/i }).click();
await page.waitForTimeout(1500);

// ── 3. The change is DATED: history keeps the old price ─────────────────────
const priceThen = sql(
  "SELECT price_per_lesson FROM class_rate_on((SELECT id FROM classes WHERE title LIKE 'Saturday Beginners%'), DATE '2020-01-01')"
);
const priceNow = sql(
  "SELECT price_per_lesson FROM class_rate_on((SELECT id FROM classes WHERE title LIKE 'Saturday Beginners%'), CURRENT_DATE)"
);
check("a lesson from 2020 still prices at the ORIGINAL rate", priceThen === "25.00", `got ${priceThen}`);
check("a lesson today prices at the NEW rate", priceNow === "55.00", `got ${priceNow}`);
check(
  "the displayed price on the class row follows today's rate",
  /55/.test(await page.locator("tr", { hasText: "Saturday Beginners" }).innerText())
);

// ── 4. A correction rewrites history, on purpose ────────────────────────────
await openEdit();
await page.getByPlaceholder("40").fill("60");
await page.waitForTimeout(400);
await page.locator('input[type="radio"]').nth(1).check(); // "Fixing a mistake"
await page.getByRole("button", { name: /Save Changes/i }).click();
await page.waitForTimeout(1500);

const afterFix = sql(
  "SELECT price_per_lesson FROM class_rate_on((SELECT id FROM classes WHERE title LIKE 'Saturday Beginners%'), CURRENT_DATE)"
);
const stillOld = sql(
  "SELECT price_per_lesson FROM class_rate_on((SELECT id FROM classes WHERE title LIKE 'Saturday Beginners%'), DATE '2020-01-01')"
);
check("a correction updates today's rate", afterFix === "60.00", `got ${afterFix}`);
check(
  "a correction rewrites only the period it belongs to, not the earlier one",
  stillOld === "25.00",
  `2020 rate is ${stillOld}`
);

await page.screenshot({ path: shot("class-terms-final.png"), fullPage: true });
await browser.close();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
