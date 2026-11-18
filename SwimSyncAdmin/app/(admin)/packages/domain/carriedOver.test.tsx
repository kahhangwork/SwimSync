import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, render, screen, fireEvent } from "@testing-library/react";

// Carried-over packages — the admin half (docs/plans/CARRIED_OVER_PACKAGES_PLAN.md, Step 3). Load-bearing:
//   • the toggle swaps the sale form for Original start + Lessons remaining, hides the price, relabels the button;
//   • the bring-in calls record_carried_over_package with the ORIGINAL start (its own state — changing product
//     never overwrites it, ⚠ RISK 8), the lessons, and p_student null for a shared product (RISK 7);
//   • never an insertPurchase and never a package email (D5); the backlog question IS asked — coverage starts
//     today, so it can only list a lesson already marked today (RISK 5);
//   • a 23514 refusal shows its sentence in the modal;
//   • refundCap / refundState: a cancelled carried row (S$0 paid) is refundable up to the value left (RISK 6);
//   • the open-offer warning (RISK 12).
//
// MUTATION PROOFS (§7.25) — each applied, run red, reverted:
//   1. useSale recordCarried: `p_original_start: carriedStart` → `saleStart`       → RED "sends the ORIGINAL start…"
//   2. packageRows refundCap: carried branch → `p.amount_payable`                   → RED "a cancelled carried…"
//   3. useSale recordCarried: remove `onActivated?.(…)`                             → RED "asks the backlog question…"
//   4. SaleModal: drop the `{openOffer && …}` block                                 → RED "warns that an open offer…"

const { repo, rpc } = vi.hoisted(() => ({
  repo: { insertPurchase: vi.fn() },
  rpc: {
    fetchSuggestedStart: vi.fn(async () => "2026-12-20"),
    fetchPreviewPrice: vi.fn(async () => ({ total: 300, discount: 0, payable: 300 })),
    myTenantId: vi.fn(async () => "t1"),
    recordCarriedOverPackage: vi.fn(),
    invokePackageEmail: vi.fn(async () => ({})),
  },
}));
vi.mock("../dao/packages.repo", () => repo);
vi.mock("../dao/packages.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: reached the real supabase client");
});

import { useSale } from "./useSale";
import { refundCap, refundState } from "./packageRows";
import { SaleModal } from "../ui/SaleModal";
import type { ChildOption, Product, Purchase } from "../types";

const product = (id: string, single_child: boolean): Product => ({
  id, name: id, category_id: null, category_name: null, lesson_count: 10, rate_per_lesson: 30,
  validity_weeks: 10, is_active: true, holder_count: 0, single_child,
});
const PRODUCTS = [product("c10", false), product("n5", false)];
const KIDS = new Map<string, ChildOption[]>([["p1", [{ id: "ava", name: "Ava" }]]]);
const onActivated = vi.fn();
const shared = { setBusy: vi.fn(), setError: vi.fn(), reload: vi.fn(), onActivated };

beforeEach(() => {
  vi.clearAllMocks();
  rpc.recordCarriedOverPackage.mockResolvedValue({ data: "pkg-carried", error: null });
});

function setup() {
  return renderHook(() =>
    useSale({ ...shared, products: PRODUCTS, childOptions: KIDS, productName: (id) => id.toUpperCase() })
  );
}

describe("Bring in a package bought before SwimSync", () => {
  it("sends the ORIGINAL start, the lessons, and p_student null — even after the product changes (RISK 8)", async () => {
    const { result } = setup();
    act(() => {
      result.current.setSaleModal(true);
      result.current.setSaleParent("p1");
      result.current.setCarried(true);
      result.current.setSaleProduct("n5");
    });
    act(() => { result.current.setCarriedStart("2026-10-07"); result.current.setCarriedLessons("6"); });
    act(() => result.current.setSaleProduct("c10")); // the suggest effect rewrites saleStart, never carriedStart
    await act(async () => { await result.current.recordCarried(); });
    expect(rpc.recordCarriedOverPackage).toHaveBeenCalledWith({
      p_parent: "p1", p_product: "c10", p_original_start: "2026-10-07", p_lessons_remaining: 6, p_student: null,
    });
    expect(repo.insertPurchase).not.toHaveBeenCalled();
    expect(rpc.invokePackageEmail).not.toHaveBeenCalled();
  });

  it("asks the backlog question afterwards (it can only list a lesson marked today)", async () => {
    const { result } = setup();
    act(() => { result.current.setSaleParent("p1"); result.current.setSaleProduct("c10"); result.current.setCarried(true); });
    act(() => { result.current.setCarriedStart("2026-10-07"); result.current.setCarriedLessons("6"); });
    await act(async () => { await result.current.recordCarried(); });
    expect(onActivated).toHaveBeenCalledWith("pkg-carried", "C10");
  });

  it("refuses out-of-range lessons before sending, and shows the database's sentence on a 23514", async () => {
    const { result } = setup();
    act(() => { result.current.setSaleParent("p1"); result.current.setSaleProduct("c10"); result.current.setCarried(true); });
    act(() => { result.current.setCarriedStart("2026-10-07"); result.current.setCarriedLessons("11"); });
    await act(async () => { await result.current.recordCarried(); });
    expect(rpc.recordCarriedOverPackage).not.toHaveBeenCalled();
    expect(result.current.saleError).toBe("Lessons remaining must be between 1 and 10.");

    rpc.recordCarriedOverPackage.mockResolvedValue({
      data: null, error: { code: "23514", message: "That package expired on 10 Nov 2026 — it can't be brought in." },
    });
    act(() => result.current.setCarriedLessons("3"));
    await act(async () => { await result.current.recordCarried(); });
    expect(result.current.saleError).toBe("That package expired on 10 Nov 2026 — it can't be brought in.");
    expect(shared.setError).not.toHaveBeenCalled();
  });
});

describe("SaleModal with the toggle on", () => {
  function renderModal(pending: Purchase[] = []) {
    const { result } = setup();
    act(() => { result.current.setSaleModal(true); result.current.setSaleParent("p1"); result.current.setSaleProduct("c10"); });
    const view = render(<SaleModal form={result.current} parents={[{ id: "p1", name: "Mum" }]}
      activeProducts={PRODUCTS} busy={false} pending={pending} />);
    return { result, view };
  }

  it("shows Original start + Lessons remaining, hides the price, relabels the button", () => {
    const { result, view } = renderModal();
    fireEvent.click(screen.getByTestId("sale-carried-toggle"));
    view.rerender(<SaleModal form={result.current} parents={[{ id: "p1", name: "Mum" }]}
      activeProducts={PRODUCTS} busy={false} />);
    expect(screen.getByLabelText("Original start date")).toBeTruthy();
    expect(screen.getByLabelText("Lessons remaining (of 10)")).toBeTruthy();
    expect(screen.queryByText(/^Pays/)).toBeNull();
    expect(screen.getByRole("button", { name: "Bring in package" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record sale" })).toBeNull();
  });

  it("warns that an open offer for the family will be cancelled (RISK 12)", () => {
    const offer = { id: "o1", parent_id: "p1", offered_by: "admin", paid_claimed_at: null, superseded_by: null,
                    student_id: null, reference_number: "PKG-2026-0042", status: "pending" } as Purchase;
    const { result, view } = renderModal([offer]);
    act(() => result.current.setCarried(true));
    view.rerender(<SaleModal form={result.current} parents={[{ id: "p1", name: "Mum" }]}
      activeProducts={PRODUCTS} busy={false} pending={[offer]} />);
    expect(screen.getByTestId("carried-offer-warning").textContent).toMatch(/PKG-2026-0042.*cancels it/);
  });
});

describe("Refunding a carried-over package (RISK 6)", () => {
  const base = { status: "cancelled", confirmed_at: "2026-11-18T02:00:00Z", amount_payable: 0,
                 value_remaining: 120, id: "pk" } as Purchase;

  it("a cancelled carried package with value left is refundable up to that value", () => {
    const p = { ...base, carried_over_start: "2026-10-07", carried_over_lessons: 6 } as Purchase;
    expect(refundCap(p)).toBe(120);
    expect(refundState(p, new Map(), true)).toBe("can_record");
  });

  it("an ordinary S$0 package still has nothing to refund", () => {
    const p = { ...base, carried_over_start: null, carried_over_lessons: null } as Purchase;
    expect(refundCap(p)).toBe(0);
    expect(refundState(p, new Map(), true)).toBe("none");
  });
});
