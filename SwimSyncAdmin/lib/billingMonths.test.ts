import { describe, expect, it } from "vitest";
import {
  CLOSED_CAP,
  attentionSummary,
  deriveBillingMonths,
  formatRunStamp,
  monthLabel,
  monthsBefore,
  runDayOf,
  reasonFor,
  stillUnclaimed,
  visibleMonths,
  type BillingPeriod,
  type BillingRun,
  type DeriveInput,
} from "./billingMonths";

// docs/plans/BILLING_MONTHS_PLAN.md §3 + the ⚠ RISK 6/7/8/10 assertions.

const period = (m: string, n = 10): BillingPeriod => ({
  billing_month: m,
  completed_at: `${m}-28T02:00:00Z`,
  invoices_issued: n,
});

let seq = 0;
const run = (m: string, over: Partial<BillingRun> = {}): BillingRun => ({
  id: `r${++seq}`,
  billing_month: m,
  ran_at: `2026-09-14T01:${String(seq).padStart(2, "0")}:00Z`,
  ran_by_name: "Owner",
  mode: "manual",
  status: "nothing_to_bill",
  sealed: false,
  invoices_created: 0,
  unclaimed_billable: 0,
  earlier_unbilled_month: null,
  blocking: null,
  unclaimed_students: null,
  error: null,
  ...over,
});

const base = (over: Partial<DeriveInput> = {}): DeriveInput => ({
  periods: [],
  runs: [],
  invoiceMonths: [],
  latestBillableMonth: "2026-08",
  todaySg: "2026-09-22",
  runDay: 7,
  ...over,
});

const unclaimedOpen = (m: string) =>
  run(m, {
    status: "open — 1 billable lesson(s) have no parent account to bill",
    invoices_created: 9,
    unclaimed_billable: 1,
    unclaimed_students: [{
      student_id: "s1", student_name: "Walk In", lessons: 1,
      earliest_session_date: `${m}-02`, latest_session_date: `${m}-02`,
    }],
  });

describe("month states", () => {
  it("a sealed month is Closed, whatever runs say", () => {
    const rows = deriveBillingMonths(base({
      periods: [period("2026-07")],
      runs: [run("2026-07", { status: "error", error: "later crash" })],
    }));
    expect(rows.find((r) => r.month === "2026-07")?.state).toBe("closed");
  });

  it("an unclaimed-open month is Open with the reason from its latest run", () => {
    const [aug] = deriveBillingMonths(base({ runs: [unclaimedOpen("2026-08")] }));
    expect(aug).toMatchObject({
      month: "2026-08", state: "open", needsAttention: true,
      reason: "1 lesson has no parent to bill",
    });
  });

  it("the LATEST run decides the reason, not the first", () => {
    const older = run("2026-08", { status: "incomplete_attendance", ran_at: "2026-09-01T00:00:00Z",
      blocking: [{ class_id: "c", class_title: "Sat", session_date: "2026-08-02", unmarked_student_count: 1 }] });
    const newer = { ...unclaimedOpen("2026-08"), ran_at: "2026-09-14T00:00:00Z" };
    const [aug] = deriveBillingMonths(base({ runs: [newer, older] }));
    expect(aug.reason).toBe("1 lesson has no parent to bill");
    expect(aug.recentRuns.map((r) => r.id)).toEqual([newer.id, older.id]);
  });

  it("pre-feature: invoices but no run row → Open, reason not recorded (August 2026 today)", () => {
    const [aug] = deriveBillingMonths(base({ invoiceMonths: ["2026-08"] }));
    expect(aug.state).toBe("open");
    expect(aug.reason).toMatch(/not recorded/);
  });

  it("D6: the latest billable month, never run, is neutral BEFORE the run day", () => {
    const [aug] = deriveBillingMonths(base({ todaySg: "2026-09-06", runDay: 7 }));
    expect(aug).toMatchObject({ state: "not_run", needsAttention: false });
  });

  it("D6: …and amber ON the run day", () => {
    const [aug] = deriveBillingMonths(base({ todaySg: "2026-09-07", runDay: 7 }));
    expect(aug).toMatchObject({ state: "not_billed", needsAttention: true, reason: null });
    // null: the state label already says "Not billed yet" — no second copy.
  });

  it("an ordinary gap (no run, no seal, no invoice, not latest) is not shown", () => {
    const rows = deriveBillingMonths(base({ periods: [period("2026-05"), period("2026-07")] }));
    expect(rows.map((r) => r.month)).toEqual(["2026-08", "2026-07", "2026-05"]);
  });

  it("nothing after the latest billable month is shown (the current month cannot be billed)", () => {
    const rows = deriveBillingMonths(base({ runs: [run("2026-09")], invoiceMonths: ["2026-10"] }));
    expect(rows.map((r) => r.month)).toEqual(["2026-08"]);
  });
});

describe("⚠ RISK 7 — an earlier unbilled month is promoted into view", () => {
  it("a run blocked by July makes July a visible needs-attention row", () => {
    const rows = deriveBillingMonths(base({
      runs: [run("2026-08", { status: "earlier_month_unbilled", earlier_unbilled_month: "2026-07" })],
    }));
    expect(rows.map((r) => [r.month, r.state])).toEqual([
      ["2026-08", "open"],
      ["2026-07", "not_billed"],
    ]);
    expect(rows[0].reason).toBe("Bill Jul 2026 first");
    expect(visibleMonths(rows).visible).toHaveLength(2);
  });
});

describe("⚠ RISK 8 — a month reopened by hand", () => {
  it("a sealed run with no period row says so, not 'complete — sealed'", () => {
    const [aug] = deriveBillingMonths(base({
      runs: [run("2026-08", { status: "complete — billing month sealed", sealed: true, invoices_created: 9 })],
    }));
    expect(aug.state).toBe("open");
    expect(aug.reason).toBe("Reopened after sealing — generate again");
  });
});

describe("reasonFor — first match wins, unknown fails safe", () => {
  it("unmarked attendance is named before unclaimed", () => {
    const r = run("2026-08", {
      status: "incomplete_attendance", unclaimed_billable: 2,
      blocking: [
        { class_id: "a", class_title: "A", session_date: "2026-08-02", unmarked_student_count: 1 },
        { class_id: "b", class_title: "B", session_date: "2026-08-09", unmarked_student_count: 3 },
      ],
    });
    expect(reasonFor(r)).toBe("2 lessons have unmarked attendance");
  });
  it("an error names its message", () => {
    expect(reasonFor(run("2026-08", { status: "error", error: "timeout" }))).toBe("Last run failed: timeout");
  });
  it("an unrecognised status is shown raw — never a green tick", () => {
    const s = "partial — 2 parent(s) deferred, will retry tomorrow";
    expect(reasonFor(run("2026-08", { status: s }))).toBe(s);
  });
});

describe("D2 — the row cap", () => {
  const manyClosed = Array.from({ length: 20 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 6 - i, 1));
    return period(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  });

  it(`shows every open month + only the newest ${CLOSED_CAP} closed`, () => {
    const rows = deriveBillingMonths(base({ periods: manyClosed, runs: [unclaimedOpen("2026-08")] }));
    const { visible, hiddenCount } = visibleMonths(rows);
    expect(visible.map((r) => r.month)).toEqual(["2026-08", "2026-07", "2026-06", "2026-05"]);
    expect(hiddenCount).toBe(17);
  });

  it("an OPEN month older than 20 closed months is never capped (RISK 10's shape too)", () => {
    const rows = deriveBillingMonths(base({
      periods: manyClosed.filter((p) => p.billing_month !== "2025-01"),
      invoiceMonths: ["2025-01"], // invoices, no run, no seal
    }));
    const { visible } = visibleMonths(rows);
    expect(visible.map((r) => r.month)).toContain("2025-01");
  });

  it("Show all shows everything", () => {
    const rows = deriveBillingMonths(base({ periods: manyClosed }));
    expect(visibleMonths(rows, true)).toEqual({ visible: rows, hiddenCount: 0 });
  });

  it("recentRuns is capped at 5 (D7)", () => {
    const runs = Array.from({ length: 8 }, () => run("2026-08"));
    const [aug] = deriveBillingMonths(base({ runs }));
    expect(aug.recentRuns).toHaveLength(5);
  });
});

describe("⚠ RISK 6 — a stale snapshot must not drive a settlement", () => {
  const stored = unclaimedOpen("2026-08").unclaimed_students;
  it("a student claimed since the run is excluded", () => {
    expect(stillUnclaimed(stored, new Set(["s1"]))).toEqual([]);
  });
  it("an unclaimed student stays", () => {
    expect(stillUnclaimed(stored, new Set())).toHaveLength(1);
  });
  it("a student SETTLED through their latest lesson is excluded (no double settlement)", () => {
    expect(stillUnclaimed(stored, new Set(), new Map([["s1", "2026-08-02"]]))).toEqual([]);
  });
  it("a settlement that stops SHORT of the latest lesson does not hide them", () => {
    expect(stillUnclaimed(stored, new Set(), new Map([["s1", "2026-08-01"]]))).toHaveLength(1);
  });
});

describe("attentionSummary — the Dashboard line", () => {
  it("null when nothing needs attention", () => {
    expect(attentionSummary(deriveBillingMonths(base({ periods: [period("2026-08")] })))).toBeNull();
  });
  it("names the OLDEST month needing attention, and counts the rest", () => {
    const rows = deriveBillingMonths(base({
      runs: [unclaimedOpen("2026-07")],
      todaySg: "2026-09-22",
    }));
    expect(attentionSummary(rows)).toBe(
      "Jul 2026 is still open — 1 lesson has no parent to bill (+1 more)",
    );
  });
});

it("monthLabel is timezone-proof", () => {
  expect(monthLabel("2026-01")).toBe("Jan 2026");
  expect(monthLabel("garbage")).toBe("garbage");
});

it("formatRunStamp shows SINGAPORE time, not the viewer's", () => {
  // 01:49Z = 09:49 SGT on 14 Sep.
  const s = formatRunStamp("2026-09-14T01:49:00Z");
  expect(s).toContain("14 Sep");
  expect(s).toContain("09:49");
  expect(formatRunStamp("nonsense")).toBe("nonsense");
});

it("monthsBefore wraps the year by string arithmetic", () => {
  expect(monthsBefore("2026-08", 24)).toBe("2024-08");
  expect(monthsBefore("2026-01", 1)).toBe("2025-12");
  expect(monthsBefore("2026-12", 12)).toBe("2025-12");
});

it("runDayOf defaults to 7 and clamps to 28, as the Invoices page shows it", () => {
  expect(runDayOf(null)).toBe(7);
  expect(runDayOf(31)).toBe(28);
  expect(runDayOf(3)).toBe(3);
});
