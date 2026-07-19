// Drives the admin Invoices page controls: the billing-month picker and the
// automatic-generation toggle.
//
// WHY THIS EXISTS
//   1. The billing month defaulted to the CURRENT month with no `max`, so the
//      obvious action on 19 July was to generate July — which billed the
//      lessons so far and SEALED the month, stranding the rest permanently.
//   2. The toggle rendered wrong, and a screenshot could not say why. This
//      MEASURES the track and knob from the DOM, the same technique
//      verify-parent-attendance.mjs uses for the chip-height regression (§7.9)
//      — geometry read from getBoundingClientRect, not eyeballed from a PNG.
//   3. `autoEnabled === null` (a platform admin, who has no tenant) used to
//      render as "off, day 7" — invented values presented as configuration.
//
// SETUP
//   supabase start
//   cd SwimSyncAdmin && npm run dev
//   node .claude/skills/run-ui-playwright/drivers/verify-invoice-controls.mjs
//
// The seeded coach@swimsync.test is BOTH tenant admin and coach (the shape
// production has); superadmin@swimsync.test is the platform admin with no
// tenant. Both are exercised — the null-state only appears for the latter.

import os from "node:os";
import { launch, loginAdmin, ADMIN } from "./lib.mjs";

const SHOT = process.env.SHOT_DIR ?? os.tmpdir();

const results = [];
const check = (label, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/** Track + knob geometry, read from the live DOM. */
async function toggleBox(page) {
  return await page.locator("button[aria-pressed]").first().evaluate((btn) => {
    const t = btn.getBoundingClientRect();
    const k = btn.querySelector("span").getBoundingClientRect();
    return {
      track: { w: Math.round(t.width), h: Math.round(t.height), l: Math.round(t.left), r: Math.round(t.right) },
      knob: { w: Math.round(k.width), h: Math.round(k.height), l: Math.round(k.left), r: Math.round(k.right) },
      pressed: btn.getAttribute("aria-pressed"),
      disabled: btn.disabled,
    };
  });
}

function assertToggleGeometry(label, b) {
  // The track must not be squashed by its flex row. w-11 h-6 = 44x24.
  check(`${label}: track is its full 44x24, not squashed`,
    b.track.w === 44 && b.track.h === 24, `${b.track.w}x${b.track.h}`);
  // h-5 w-5 = 20x20.
  check(`${label}: knob is 20x20`,
    b.knob.w === 20 && b.knob.h === 20, `${b.knob.w}x${b.knob.h}`);
  // The regression that made this look broken: the knob riding or overhanging
  // the edge. Both ends, so neither position can hide it.
  check(`${label}: knob sits fully INSIDE the track`,
    b.knob.l >= b.track.l && b.knob.r <= b.track.r,
    `knob ${b.knob.l}..${b.knob.r} vs track ${b.track.l}..${b.track.r}`);
}

const { browser, page } = await launch();
try {
  // ── 1. TENANT ADMIN — the real, configured case ─────────────────────────
  await loginAdmin(page, "coach@swimsync.test", "password123");
  await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  // Billing month: default and cap. Invoices cover a COMPLETE month, so the
  // latest billable month is always the one before today in SGT.
  const sgToday = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" })
  );
  const expected = `${sgToday.getFullYear()}-${String(sgToday.getMonth()).padStart(2, "0")}`;
  const expectedMonth =
    sgToday.getMonth() === 0
      ? `${sgToday.getFullYear() - 1}-12`
      : expected;

  const monthInput = page.locator('input[type="month"]').first();
  const value = await monthInput.inputValue();
  const max = await monthInput.getAttribute("max");
  check("billing month DEFAULTS to the last completed month",
    value === expectedMonth, `value=${value} expected=${expectedMonth}`);
  check("billing month is CAPPED at the last completed month",
    max === expectedMonth, `max=${max}`);
  check("the current month cannot be selected",
    !!max && max < `${sgToday.getFullYear()}-${String(sgToday.getMonth() + 1).padStart(2, "0")}`,
    `max=${max}`);

  const before = await toggleBox(page);
  console.log("tenant-admin toggle:", JSON.stringify(before));
  assertToggleGeometry("tenant admin", before);
  check("toggle is ENABLED for a tenant admin", before.disabled === false);

  // The round trip is what matters — a toggle that animates but does not save
  // is the failure that counts, and geometry alone would not catch it.
  const wasPressed = before.pressed;
  await page.locator("button[aria-pressed]").first().click();
  await page.waitForTimeout(1500);
  const flipped = await toggleBox(page);
  check("clicking FLIPS the toggle", flipped.pressed !== wasPressed,
    `${wasPressed} -> ${flipped.pressed}`);
  assertToggleGeometry("after flip", flipped);
  check("knob MOVES between states", flipped.knob.l !== before.knob.l,
    `${before.knob.l} -> ${flipped.knob.l}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const persisted = await toggleBox(page);
  check("the new state PERSISTS across a reload (it really saved)",
    persisted.pressed === flipped.pressed,
    `${flipped.pressed} -> ${persisted.pressed}`);

  // Put it back so the driver leaves no trace.
  await page.locator("button[aria-pressed]").first().click();
  await page.waitForTimeout(1500);
  const restored = await toggleBox(page);
  check("restored to the original state", restored.pressed === wasPressed);

  await page.screenshot({ path: `${SHOT}/invoice-controls-tenant.png`, fullPage: true });

  // ── 2. PLATFORM ADMIN — the unknown case ────────────────────────────────
  await page.goto(`${ADMIN}/login`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, "superadmin@swimsync.test", "password123");
  await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const pa = await toggleBox(page);
  console.log("platform-admin toggle:", JSON.stringify(pa));
  assertToggleGeometry("platform admin", pa);
  check("toggle is DISABLED for a platform admin (no business)", pa.disabled === true);

  const text = await page.evaluate(() => document.body.innerText);
  check("says no business is selected, rather than inventing 'day 7'",
    /No business selected/.test(text));
  check("does NOT present a fabricated run day",
    !/Runs from day \d+ for the previous month/.test(text));

  const runDay = await page.locator("#run-day").inputValue();
  check("run-day field is blank, not a made-up 7", runDay === "", `value="${runDay}"`);

  await page.screenshot({ path: `${SHOT}/invoice-controls-platform.png`, fullPage: true });
  console.log(`\nscreenshots in ${SHOT}`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
process.exit(failed ? 1 : 0);
