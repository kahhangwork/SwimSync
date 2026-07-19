// Active/inactive for families and children (backlog #1, phases 1–3).
//
// The parts that only exist in the UI and cannot be asserted in SQL: the
// sibling CHOICE, the family CONSEQUENCE statement, and the fact that a
// departed child does not reappear in the Unassigned queue.
//
// Setup: supabase running + seed; cd SwimSyncAdmin && npm run dev
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { launch, loginAdmin } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();
const shot = (n) => path.join(SHOT, n);
const results = [];
const check = (label, pass, detail = "") => {
  results.push({ pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
// Collapsed to one line: psql -c reads embedded newlines as backslash commands.
const sql = (q) =>
  execSync(
    `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tA -c ${JSON.stringify(
      q.replace(/\s+/g, " ").trim()
    )}`,
    { encoding: "utf8" }
  ).trim();

// ── Fixture ─────────────────────────────────────────────────────────────────
// Piped from a file rather than psql -c: a multi-line DO block passed with -c
// has its newlines read as backslash commands.
execSync(
  `docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -q < ${path.join(import.meta.dirname, "fixtures-active-inactive.sql")}`,
  { shell: "/bin/bash", stdio: "inherit" }
);

const { browser, page } = await launch();
await loginAdmin(page, "superadmin@swimsync.test", "password123");

// ── 1. The Parents page exists and lists the family ─────────────────────────
await page.goto("http://localhost:3000/parents");
await page.waitForTimeout(1800);
let body = await page.innerText("body");
check("the new Parents page renders", /Parents/.test(body) && !/404/.test(body));
check("the family is listed with its active-child count", /Tan Family/.test(body) && /2 of 2 active/.test(body), );
await page.screenshot({ path: shot("ai-parents.png"), fullPage: true });

// ── 2. Both children appear in the Unassigned queue while active ────────────
await page.goto("http://localhost:3000/unassigned");
await page.waitForTimeout(1500);
body = await page.innerText("body");
check("both children are in the Unassigned queue while active",
  /Ethan Tan/.test(body) && /Maya Tan/.test(body));

// ── 3. Setting one child inactive OFFERS the sibling, and says what follows ─
await page.goto("http://localhost:3000/students");
await page.waitForTimeout(1500);
await page.locator("tr", { hasText: "Ethan Tan" }).getByRole("button", { name: /Set inactive/i }).click();
await page.waitForTimeout(1200);
body = await page.innerText("body");
check("the sibling is named in the prompt", /Maya Tan is also in this family/.test(body));
check("'just this child' is the default (non-destructive)",
  await page.locator('input[type="radio"]').first().isChecked());
check("no family-consequence line yet — a sibling is still attending",
  !/will be marked\s+inactive at this business/.test(body.replace(/\s+/g, " ")));
await page.screenshot({ path: shot("ai-sibling-prompt.png"), fullPage: true });

// Choosing ALL children must surface the family consequence.
await page.locator('input[type="radio"]').nth(1).check();
await page.waitForTimeout(400);
body = await page.innerText("body");
check("choosing all children states the family consequence",
  /leaves no active children/.test(body) && /inactive at this business/.test(body.replace(/\s+/g, " ")));
await page.screenshot({ path: shot("ai-family-consequence.png"), fullPage: true });

// Back to just-this-child, and apply.
await page.locator('input[type="radio"]').first().check();
await page.getByRole("button", { name: /^Set inactive$/ }).last().click();
await page.waitForTimeout(1800);

check("only the chosen child was deactivated",
  sql("SELECT is_active FROM students WHERE id='5d000000-0000-0000-0000-000000000001'") === "f" &&
  sql("SELECT is_active FROM students WHERE id='5d000000-0000-0000-0000-000000000002'") === "t");
check("the family stays active while a sibling attends",
  sql(`SELECT pt.is_active FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
       WHERE p.profile_id='a0000000-0000-0000-0000-00000000dddd'`) === "t");

// ── 4. THE REGRESSION: a departed child must not look like a new signup ─────
await page.goto("http://localhost:3000/unassigned");
await page.waitForTimeout(1500);
body = await page.innerText("body");
check("an INACTIVE child is gone from the Unassigned queue",
  !/Ethan Tan/.test(body), "they are 'unassigned' now, so this needs the is_active guard");
check("their active sibling is still in it", /Maya Tan/.test(body));

// ── 5. Deactivating the last child takes the family with it ─────────────────
await page.goto("http://localhost:3000/students");
await page.waitForTimeout(1500);
await page.locator("tr", { hasText: "Maya Tan" }).getByRole("button", { name: /Set inactive/i }).click();
await page.waitForTimeout(1200);
body = await page.innerText("body");
check("with no siblings left, the consequence is stated immediately",
  /leaves no active children/.test(body));
await page.getByRole("button", { name: /^Set inactive$/ }).last().click();
await page.waitForTimeout(1800);

check("the family is now inactive at this business",
  sql(`SELECT pt.is_active FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
       WHERE p.profile_id='a0000000-0000-0000-0000-00000000dddd'`) === "f");

// ── 6. The Parents page shows it, and can reactivate ────────────────────────
await page.goto("http://localhost:3000/parents");
await page.waitForTimeout(1800);
body = await page.innerText("body");
check("the Parents page shows the family as Inactive", /Tan Family/.test(body) && /Inactive/.test(body));
await page.locator("tr", { hasText: "Tan Family" }).getByRole("button", { name: /Reactivate/i }).click();
await page.waitForTimeout(1000);
body = await page.innerText("body");
check("reactivating warns that children stay inactive", /children stay inactive/i.test(body));
await page.getByRole("button", { name: /^Reactivate$/ }).last().click();
await page.waitForTimeout(1800);

check("the family is active again",
  sql(`SELECT pt.is_active FROM parent_tenants pt JOIN parents p ON p.id=pt.parent_id
       WHERE p.profile_id='a0000000-0000-0000-0000-00000000dddd'`) === "t");
check("and the children are STILL inactive — status only, no guessed roster",
  sql("SELECT count(*) FROM students WHERE id IN ('5d000000-0000-0000-0000-000000000001','5d000000-0000-0000-0000-000000000002') AND is_active") === "0");
await page.screenshot({ path: shot("ai-parents-final.png"), fullPage: true });

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
