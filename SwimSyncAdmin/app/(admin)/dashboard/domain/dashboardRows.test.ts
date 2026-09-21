// CHARACTERISATION TEST (playbook §0): this pins behaviour that already
// existed on dashboard/page.tsx before Admin L-E moved it here, so §7.25's
// prove-it-red rule cannot apply — there is no fix to prove.
//
// What it is actually guarding: `formatBillingMonth` is the one date render on
// this page, and it is ALLOWED to skip the Asia/Singapore pin
// (sgDisplay.drift.test.ts's first entry) because `new Date(y, m - 1, 1)` is
// local midnight rendered in that same local zone at month+year granularity —
// no instant is involved, so every zone yields the month it was built from.
// The tests below hold that claim to account.

import { describe, expect, it } from "vitest";
import { formatBillingMonth } from "./dashboardRows";

describe("formatBillingMonth", () => {
  it("renders a billing month as short month + year", () => {
    expect(formatBillingMonth("2026-08")).toBe("Aug 2026");
  });

  it("handles both ends of the year", () => {
    expect(formatBillingMonth("2026-01")).toBe("Jan 2026");
    expect(formatBillingMonth("2026-12")).toBe("Dec 2026");
  });

  it("is zone-independent — the reason it may skip the SGT pin", () => {
    // The same assertion the sgDisplay allowance rests on. If this ever fails,
    // the allowance is wrong, not this test.
    const before = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      expect(formatBillingMonth("2026-08")).toBe("Aug 2026");
    } finally {
      process.env.TZ = before;
    }
  });
});
