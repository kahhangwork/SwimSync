// Unit tests for the timezone-aware billing-month helper. Pure — no stack
// needed. Run by test.sh via `deno test`.
//
// The SGT-boundary case is the regression pin: it FAILS on the old
// new Date().getMonth() derivation (which reads the UTC month) and passes with
// previousBillingMonth(). Same shape as verify-tz-saturday.mjs pinning the
// earlier UTC-vs-SGT double-billing bug.

import { assertEquals } from "jsr:@std/assert@1";
import {
  clampRunDay,
  dateInTimeZone,
  dayOfMonthInTimeZone,
  DEFAULT_INVOICE_RUN_DAY,
  previousBillingMonth,
} from "./dates.ts";

Deno.test("previousBillingMonth: 1 Aug 00:30 SGT bills July, not June (the bug)", () => {
  // 2026-08-01T00:30:00+08:00 === 2026-07-31T16:30:00Z. The old UTC derivation
  // sees July here and computes June; the fix sees 1 Aug in SGT → July.
  const now = new Date("2026-07-31T16:30:00Z");
  assertEquals(previousBillingMonth(now, "Asia/Singapore"), "2026-07");
});

Deno.test("previousBillingMonth: mid-month sanity", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  assertEquals(previousBillingMonth(now, "Asia/Singapore"), "2026-07");
});

Deno.test("previousBillingMonth: year rollover — 1 Jan 00:30 SGT bills previous Dec", () => {
  // 2026-01-01T00:30:00+08:00 === 2025-12-31T16:30:00Z.
  const now = new Date("2025-12-31T16:30:00Z");
  assertEquals(previousBillingMonth(now, "Asia/Singapore"), "2025-12");
});

Deno.test("previousBillingMonth: timezone seam — UTC differs from SGT at the boundary", () => {
  const now = new Date("2026-07-31T16:30:00Z");
  // Proves the timeZone parameter is honoured: in UTC this instant is still
  // July, so the previous month is June — the exact pre-fix behaviour.
  assertEquals(previousBillingMonth(now, "UTC"), "2026-06");
});

Deno.test("dateInTimeZone: resolves the SGT calendar date across the boundary", () => {
  const now = new Date("2026-07-31T16:30:00Z");
  assertEquals(dateInTimeZone(now, "Asia/Singapore"), "2026-08-01");
  assertEquals(dateInTimeZone(now, "UTC"), "2026-07-31");
});

// ── invoice_run_day normalisation ──────────────────────────────────────────
// The automatic path waits until this day of the month. A bad value must
// degrade to "runs a bit later than intended", never to "never runs".

Deno.test("clampRunDay: keeps sensible values, coerces numeric strings", () => {
  assertEquals(clampRunDay(7), 7);
  assertEquals(clampRunDay(1), 1);
  assertEquals(clampRunDay(28), 28);
  assertEquals(clampRunDay("12"), 12);
  assertEquals(clampRunDay(7.9), 7); // truncated, not rounded up
});

Deno.test("clampRunDay: 29-31 clamp to 28 — they would never fire in February", () => {
  assertEquals(clampRunDay(29), 28);
  assertEquals(clampRunDay(31), 28);
  assertEquals(clampRunDay(99), 28);
});

Deno.test("clampRunDay: junk or missing falls back to the default, never blocks", () => {
  assertEquals(clampRunDay(undefined), DEFAULT_INVOICE_RUN_DAY);
  assertEquals(clampRunDay(null), DEFAULT_INVOICE_RUN_DAY);
  assertEquals(clampRunDay("not-a-day"), DEFAULT_INVOICE_RUN_DAY);
  assertEquals(clampRunDay({}), DEFAULT_INVOICE_RUN_DAY);
  assertEquals(clampRunDay(""), DEFAULT_INVOICE_RUN_DAY);
  // Below range falls back to the default rather than day 1: Number(null) is
  // 0, so clamping upward would turn "unset" into "bill on the 1st" — the
  // earliest possible run, which is what this setting exists to prevent.
  assertEquals(clampRunDay(0), DEFAULT_INVOICE_RUN_DAY);
  assertEquals(clampRunDay(-5), DEFAULT_INVOICE_RUN_DAY);
});

Deno.test("dayOfMonthInTimeZone: SGT day, not the UTC day, at the boundary", () => {
  // 31 Jul 2026 17:30 UTC is already 1 Aug in Singapore (UTC+8).
  const t = new Date("2026-07-31T17:30:00Z");
  assertEquals(dayOfMonthInTimeZone(t, "Asia/Singapore"), 1);
  assertEquals(dayOfMonthInTimeZone(t, "UTC"), 31);
});
