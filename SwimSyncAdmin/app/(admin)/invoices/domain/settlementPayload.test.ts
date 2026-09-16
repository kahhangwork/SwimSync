import { describe, expect, it } from "vitest";
import { settlementPayload } from "./settlementPayload";

// Pins the payload against the DB CHECK `settlement_amount_matches_kind`
// (20260725000100): paid_outside must carry an amount, written_off must not.
// Two screens build this row (the unclaimed modal and the orphan-lesson
// report); this file is what keeps them from drifting apart.

const base = {
  tenantId: "t-1",
  studentId: "s-1",
  settledThrough: "2026-07-15",
  recordedBy: "admin-1",
};

describe("settlementPayload", () => {
  it("paid_outside carries the amount and the method", () => {
    expect(
      settlementPayload({ ...base, kind: "paid_outside", amount: 60 })
    ).toEqual({
      tenant_id: "t-1",
      student_id: "s-1",
      settled_through: "2026-07-15",
      kind: "paid_outside",
      amount: 60,
      method: "Outside SwimSync",
      recorded_by: "admin-1",
    });
  });

  it("written_off strips amount AND method, even when an amount was passed", () => {
    // The CHECK refuses a written_off row with an amount; the kind decides.
    const row = settlementPayload({ ...base, kind: "written_off", amount: 60 });
    expect(row.amount).toBeNull();
    expect(row.method).toBeNull();
    expect(row.kind).toBe("written_off");
  });

  it("settled_through passes through unchanged — the line's latest lesson, never today", () => {
    const row = settlementPayload({ ...base, kind: "written_off", amount: null });
    expect(row.settled_through).toBe("2026-07-15");
  });
});
