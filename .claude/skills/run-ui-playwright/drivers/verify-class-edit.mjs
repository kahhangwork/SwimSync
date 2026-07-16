// Admin class create/edit — day is now a required explicit choice (no silent
// Saturday default), and existing classes can be edited in-app (no dashboard SQL).
//
// Setup: supabase running + seed ("Saturday Beginners"); cd SwimSyncAdmin && npm run dev
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

const { browser, page } = await launch();
await loginAdmin(page, "superadmin@swimsync.test", "password123");
await page.goto("http://localhost:3000/classes");
await page.waitForTimeout(1500);

// ── 1. New-class form no longer defaults the day to Saturday ──────────────────
await page.getByRole("button", { name: /New Class/i }).click();
await page.waitForTimeout(500);
// The two selects are Coach then Day; Day is the second.
const daySelect = page.locator("select").nth(1);
const dayValue = await daySelect.inputValue();
check("New-class day defaults to empty (no silent Saturday)", dayValue === "", `value="${dayValue}"`);
await page.screenshot({ path: shot("class-new-day-empty.png"), fullPage: true });

// Filling everything except the day must be rejected.
await page.getByPlaceholder("e.g. Saturday Beginners").fill("Temp Class");
await page.locator("select").first().selectOption({ index: 1 }); // pick the coach
await page.locator('input[type="time"]').first().fill("10:00");
await page.locator('input[type="time"]').last().fill("11:00");
await page.getByPlaceholder("e.g. Buona Vista SC").fill("Somewhere");
await page.getByPlaceholder("40").fill("40");
await page.getByRole("button", { name: /Create Class/i }).click();
await page.waitForTimeout(800);
check("Create with no day chosen is blocked", /Please fill in all fields/i.test(await page.innerText("body")));
// close modal
await page.getByRole("button", { name: /^Cancel$/ }).click();
await page.waitForTimeout(500);

// ── 2. Edit an existing class: Saturday → Sunday, persisted ───────────────────
const row = page.locator("tr", { hasText: "Saturday Beginners" });
await row.getByRole("button", { name: /Edit/i }).click();
await page.waitForTimeout(600);
let body = await page.innerText("body");
check("Edit modal opens titled 'Edit Class'", /Edit Class/.test(body));
check("Edit modal pre-fills the current day (Saturday)",
  (await page.locator("select").nth(1).inputValue()) === "saturday");

await page.locator("select").nth(1).selectOption("sunday");
await page.getByRole("button", { name: /Save Changes/i }).click();
await page.waitForTimeout(1500);

body = await page.innerText("body");
const beginnerRow = await page.locator("tr", { hasText: "Saturday Beginners" }).innerText();
check("Class row now shows Sunday after edit", /Sunday/.test(beginnerRow), beginnerRow.replace(/\s+/g, " "));
await page.screenshot({ path: shot("class-edited-sunday.png"), fullPage: true });

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
console.log(`screenshots: ${SHOT}`);
process.exit(failed ? 1 : 0);
