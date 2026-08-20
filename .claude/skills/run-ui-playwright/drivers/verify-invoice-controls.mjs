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
      track: { w: t.width, h: t.height, l: t.left, r: t.right },
      knob: { w: k.width, h: k.height, l: k.left, r: k.right },
      // Tailwind sizes are rem-based and globals.css shrinks the root font-size
      // below 1536px wide (16 -> 15 -> 14 -> 13px). Pixel pins moved with it
      // (§7.73 family: 3 red nights, 2026-08-17..19); measure in rem instead.
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      pressed: btn.getAttribute("aria-pressed"),
      disabled: btn.disabled,
    };
  });
}

function assertToggleGeometry(label, b) {
  // Sizes in rem: w-11 h-6 = 2.75 x 1.5rem (44x24 at 16px), h-5 w-5 = 1.25rem.
  // Half a pixel of slack covers sub-pixel layout at a 13/15px root.
  const px = (rem) => rem * b.rem;
  const near = (a, rem) => Math.abs(a - px(rem)) <= 0.5;
  const dims = (o) => `${o.w.toFixed(1)}x${o.h.toFixed(1)} @ ${b.rem}px root`;
  check(`${label}: track is its full 2.75x1.5rem, not squashed`,
    near(b.track.w, 2.75) && near(b.track.h, 1.5), dims(b.track));
  check(`${label}: knob is 1.25x1.25rem`,
    near(b.knob.w, 1.25) && near(b.knob.h, 1.25), dims(b.knob));
  // The regression that made this look broken: the knob riding or overhanging
  // the edge. Both ends, so neither position can hide it.
  check(`${label}: knob sits fully INSIDE the track`,
    b.knob.l >= b.track.l - 0.5 && b.knob.r <= b.track.r + 0.5,
    `knob ${b.knob.l.toFixed(1)}..${b.knob.r.toFixed(1)} vs track ${b.track.l.toFixed(1)}..${b.track.r.toFixed(1)}`);
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

  // ── 2. PLATFORM ADMIN — refused, not disabled ───────────────────────────
  // This section used to assert a disabled toggle + "No business selected".
  // RequiresTenant (components/RequiresTenant.tsx) superseded that: tenant
  // pages now UNMOUNT for a platform admin, because a mounted page still
  // queries and paints cross-tenant rows underneath any notice. So the
  // assertion is the refusal screen and the ABSENCE of the page — a rendered
  // toggle here would mean the gate has regressed.
  await page.goto(`${ADMIN}/login`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await loginAdmin(page, "superadmin@swimsync.test", "password123");
  await page.goto(`${ADMIN}/invoices`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const text = await page.evaluate(() => document.body.innerText);
  check("platform admin is REFUSED the tenant invoices page",
    /This page shows a single business/.test(text));
  check("the refusal points at the Platform panel", /Platform/.test(text));
  check("the invoices page did NOT mount (no toggle in the DOM)",
    (await page.locator("button[aria-pressed]").count()) === 0);
  check("no fabricated run day anywhere", !/Runs from day \d+/.test(text));

  await page.screenshot({ path: `${SHOT}/invoice-controls-platform.png`, fullPage: true });
  console.log(`\nscreenshots in ${SHOT}`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
process.exit(failed ? 1 : 0);
