import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// countMetrics() is destructured POSITIONALLY ("ORDER IS THE CONTRACT",
// dao/dashboard.repo.ts). Each position gets a distinct count, so a query
// inserted in the middle — or the overdue count read from the wrong slot —
// moves a number into the wrong metric and fails here
// (OVERDUE_INVOICES_PLAN.md Unit 3, ⚠ RISK 6).
vi.mock("../dao/dashboard.repo", () => ({
  countMetrics: () =>
    Promise.resolve([11, 12, 13, 14, 15, 16, 17, 18].map((count) => ({ count }))),
  loadUnassigned: () => Promise.resolve({ data: [] }),
  loadOutstandingInvoices: () =>
    Promise.resolve({
      data: [
        { id: "a", billing_month: "2026-10", net_amount: 60, status: "outstanding",
          paid_claimed_at: null, due_date: "2026-11-01", is_overdue: true, parents: null },
        { id: "b", billing_month: "2026-10", net_amount: 60, status: "outstanding",
          paid_claimed_at: "2026-11-02T02:00:00Z", due_date: "2026-11-01", is_overdue: true, parents: null },
      ],
    }),
}));
vi.mock("../dao/dashboard.rpc", () => ({
  studentPackageCoverage: () => Promise.resolve({ data: [] }),
}));

import { useDashboard } from "./useDashboard";

describe("useDashboard", () => {
  it("reads every metric from its own position; overdue is the 8th", async () => {
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.metrics).toEqual({
      activeStudents: 11,
      unassignedCount: 12,
      outstandingInvoices: 13,
      totalCreditNotes: 14,
      totalCoaches: 15,
      totalClasses: 16,
      inactiveStudents: 17,
      overdueInvoices: 18,
    });
  });

  it("the mini table tags through invoiceTag — Claimed beats Overdue", async () => {
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.invoices.map((i) => i.tag)).toEqual(["Overdue", "Claimed"]);
  });
});
