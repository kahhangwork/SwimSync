// Unit tests for the timezone-aware billing-month helper. Pure — no stack
// needed. Run by test.sh via `deno test`.
//
// The SGT-boundary case is the regression pin: it FAILS on the old
// new Date().getMonth() derivation (which reads the UTC month) and passes with
// previousBillingMonth(). Same shape as verify-tz-saturday.mjs pinning the
// earlier UTC-vs-SGT double-billing bug.

import { assertEquals } from "jsr:@std/assert@1";
import { dateInTimeZone, previousBillingMonth } from "./dates.ts";

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
