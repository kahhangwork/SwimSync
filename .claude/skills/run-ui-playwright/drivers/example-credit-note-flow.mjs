// Worked example / template: drive the credit-note flow across all 3 roles.
//
// Prereq: seed a scenario first — a parent+student enrolled in a class with an
// already-INVOICED past session (so editing it fires the credit-note trigger).
// Set the env vars below to match your seed, then:
//   node example-credit-note-flow.mjs
//
// This is a TEMPLATE showing the mechanics (UI navigation, force-tap, assert
// against the DB out-of-band). Copy + adapt for other flows.

import { launch, tap, loginExpo, loginAdmin, dumpText, EXPO } from "./lib.mjs";

const COACH = process.env.COACH_EMAIL || "coach@swimsync.test";
const PARENT = process.env.PARENT_EMAIL || "cn-test-parent@swimsync.test";
const CLASS_NAME = process.env.CLASS_NAME || "CN Test Class";
const SESSION_DATE = process.env.SESSION_DATE || "3 Jan 2026"; // substring shown in roster
const SHOT_DIR = process.env.SHOT_DIR || "/tmp";

// ── 1. Coach: edit a past invoiced session present -> absent (issues the note)
{
  const { browser, page } = await launch({ mobile: true });
  try {
    await loginExpo(page, COACH); // -> /today
    await tap(page.locator('a[href="/classes"]'), "Classes tab");
    await page.waitForTimeout(2500);
    await tap(page.getByText(CLASS_NAME, { exact: true }), `${CLASS_NAME} card`);
    await page.waitForTimeout(3000); // roster
    await tap(page.getByText(new RegExp(SESSION_DATE)), "past session row");
    await page.waitForTimeout(3500); // attendance screen
    await tap(page.getByText("Absent", { exact: true }), "Absent");
    await page.waitForTimeout(1000);
    await tap(page.getByText("Save Attendance", { exact: true }), "Save");
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SHOT_DIR}/cn-coach-saved.png`, fullPage: true });
    console.log("coach edit done — assert a credit_notes row now exists in the DB");
  } finally { await browser.close(); }
}

// ── 2. Parent: the note shows under Billing -> Credit Notes
{
  const { browser, page } = await launch({ mobile: true });
  try {
    await loginExpo(page, PARENT); // -> /home
    await tap(page.locator('a[href="/billing"]'), "Billing tab");
    await page.waitForTimeout(2500);
    await tap(page.getByText("Credit Notes", { exact: true }), "Credit Notes tab");
    await page.waitForTimeout(2000);
    await dumpText(page); // expect CN-YYYY-NNNN · Available · "Present → Absent"
    await page.screenshot({ path: `${SHOT_DIR}/cn-parent.png`, fullPage: true });
  } finally { await browser.close(); }
}

// ── 3. Superadmin: the note shows on the admin Credit Notes page
{
  const { browser, page } = await launch({ mobile: false });
  try {
    await loginAdmin(page);
    await page.goto("http://localhost:3000/credit-notes", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await dumpText(page, 1500); // expect the ref + student + parent + amount
    await page.screenshot({ path: `${SHOT_DIR}/cn-admin.png`, fullPage: true });
  } finally { await browser.close(); }
}

// ── 4. Generate the next month's invoice out-of-band (curl the edge function),
//      then re-drive the parent Invoices tab to assert "Credit Applied −S$…".
console.log("now: POST generate-invoices for the next month, then re-check parent Invoices tab");
