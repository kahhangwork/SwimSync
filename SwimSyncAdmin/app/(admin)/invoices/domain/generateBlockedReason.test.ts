import { describe, it, expect } from "vitest";
import type { BillingMonthRow, BillingRun } from "@/lib/billingMonths";
import { generateBlockedReason } from "./generateBlockedReason";

// The reason shown beside Generate (BACKLOG S4) reads the picked month's LAST
// run, and only while that month is still open — a closed month's old refusal
// is history, not a reason.
//
// MUTATION PROOFS (§7.25) — each applied to generateBlockedReason.ts, run, reverted:
//   1. `row.state !== "open"` → `false`            → RED: "a closed month says nothing…"
//   2. `row.recentRuns[0]` → `row.recentRuns.at(-1)` → RED: "reads the newest run only"

const lesson = (d: string) => ({ class_id: "c1", class_title: "Squad", session_date: d, unmarked_student_count: 2 });
const run = (blocking: BillingRun["blocking"]): BillingRun => ({
  id: Math.random().toString(),
  billing_month: "2026-08-01",
  ran_at: "2026-09-02T01:00:00Z",
  ran_by_name: "Owner",
  mode: "manual",
  status: "blocked",
  sealed: false,
  invoices_created: 0,
  unclaimed_billable: null,
  earlier_unbilled_month: null,
  blocking,
  unclaimed_students: null,
  error: null,
});
const row = (over: Partial<BillingMonthRow>): BillingMonthRow => ({
  month: "2026-08",
  state: "open",
  needsAttention: true,
  reason: null,
  period: null,
  recentRuns: [],
  ...over,
});

describe("generateBlockedReason", () => {
  it("names the picked month and counts its last run's unmarked lessons", () => {
    const r = generateBlockedReason([row({ recentRuns: [run([lesson("2026-08-05"), lesson("2026-08-12")])] })], "2026-08");
    expect(r?.monthLabel).toMatch(/Aug 2026/);
    expect(r?.blocking).toHaveLength(2);
  });

  it("reads the newest run only", () => {
    const r = generateBlockedReason([row({ recentRuns: [run([]), run([lesson("2026-08-05")])] })], "2026-08");
    expect(r).toBeNull();
  });

  it("a closed month says nothing, whatever its old runs said", () => {
    expect(generateBlockedReason([row({ state: "closed", recentRuns: [run([lesson("2026-08-05")])] })], "2026-08")).toBeNull();
  });

  it("another month's refusal is not the picked month's", () => {
    expect(generateBlockedReason([row({ recentRuns: [run([lesson("2026-08-05")])] })], "2026-07")).toBeNull();
  });
});
