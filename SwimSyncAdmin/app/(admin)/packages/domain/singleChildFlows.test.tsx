import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, render, screen, waitFor } from "@testing-library/react";

// Single-child packages — the admin flows. Load-bearing:
//   • Record a sale: a one-child product needs a child (refused before sending),
//     sends that child; a shared product sends null (RISK 7); the DB's refusal
//     sentence (23514 — which child, one kind per family) shows in the modal;
//   • Change child: the RPC's refusal renders inline in the dialog (RISK 10);
//   • Generate offers: a family row and a child's row of ONE parent select, price
//     and send independently, each with its own p_student_id (RISK 4).

const { repo, rpc } = vi.hoisted(() => ({
  repo: {
    insertPurchase: vi.fn(),
    loadOfferRow: vi.fn(async () => ({ data: null })),
  },
  rpc: {
    fetchSuggestedStart: vi.fn(async () => "2026-10-17"),
    fetchPreviewPrice: vi.fn(async (_p: string, product: string) => ({
      total: product === "one" ? 150 : 300, discount: 0, payable: product === "one" ? 150 : 300,
    })),
    myTenantId: vi.fn(async () => "t1"),
    reassignPackageChild: vi.fn(),
    renewalCandidates: vi.fn(),
    createPackageOffer: vi.fn(async () => ({ data: "offer-1", error: null })),
    invokePackageEmail: vi.fn(async () => ({})),
  },
}));
vi.mock("../dao/packages.repo", () => repo);
vi.mock("../dao/packages.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: reached the real supabase client");
});

import { useSale } from "./useSale";
import { useChangeChild } from "./useChangeChild";
import { useGenerateOffers } from "./useGenerateOffers";
import { candidateKey } from "./singleChild";
import { ChangeChildModal } from "../ui/ChangeChildModal";
import type { ChildOption, Product, Purchase } from "../types";

const product = (id: string, single_child: boolean): Product => ({
  id, name: id, category_id: null, category_name: null, lesson_count: 5, rate_per_lesson: 30,
  validity_weeks: 20, is_active: true, holder_count: 0, single_child,
});
const PRODUCTS = [product("shared", false), product("one", true)];
const KIDS = new Map<string, ChildOption[]>([
  ["p1", [{ id: "ava", name: "Ava" }, { id: "ben", name: "Ben" }]],
  ["p2", [{ id: "cai", name: "Cai" }]],
]);
const shared = { setBusy: vi.fn(), setError: vi.fn(), reload: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  repo.insertPurchase.mockResolvedValue({ data: { id: "pkg-new" }, error: null });
});

describe("Record a sale", () => {
  function setup() {
    return renderHook(() => useSale({ ...shared, products: PRODUCTS, childOptions: KIDS }));
  }

  it("a one-child product refuses to send without a child, then sends the chosen one", async () => {
    const { result } = setup();
    act(() => { result.current.setSaleModal(true); result.current.setSaleParent("p1"); result.current.setSaleProduct("one"); });
    expect(result.current.needsChild).toBe(true);
    expect(result.current.saleChild).toBe(""); // two children → asked, not guessed
    await act(async () => { await result.current.recordSale(); });
    expect(repo.insertPurchase).not.toHaveBeenCalled();
    expect(result.current.saleError).toBe("Choose which child this package is for.");
    act(() => result.current.setSaleChild("ben"));
    await act(async () => { await result.current.recordSale(); });
    expect(repo.insertPurchase).toHaveBeenCalledWith(expect.objectContaining({ product_id: "one", student_id: "ben" }));
  });

  it("a family with one child here is shown, not asked (D7)", () => {
    const { result } = setup();
    act(() => { result.current.setSaleParent("p2"); result.current.setSaleProduct("one"); });
    expect(result.current.saleChild).toBe("cai");
  });

  it("⚠ RISK 7 — a shared product sends student_id null even with a child selected", async () => {
    const { result } = setup();
    act(() => { result.current.setSaleParent("p1"); result.current.setSaleProduct("shared"); });
    act(() => result.current.setSaleChild("ava"));
    await act(async () => { await result.current.recordSale(); });
    expect(repo.insertPurchase).toHaveBeenCalledWith(expect.objectContaining({ product_id: "shared", student_id: null }));
  });

  it("the database's refusal sentence is shown in the modal", async () => {
    repo.insertPurchase.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "This family already has a shared package that is pending or has lessons left — a one-child package can be bought once it is used up." },
    });
    const { result } = setup();
    act(() => { result.current.setSaleParent("p2"); result.current.setSaleProduct("one"); });
    await act(async () => { await result.current.recordSale(); });
    expect(result.current.saleError).toMatch(/^This family already has a shared package/);
    expect(shared.setError).not.toHaveBeenCalled();
  });
});

describe("Change child (RISK 10)", () => {
  const pkg = { id: "pkg-1", parent_id: "p1", student_id: "ava", student_name: "Ava", name: "OC5",
                reference_number: "PKG-2026-0009", parent_name: "Mum" } as Purchase;

  it("the RPC's refusal renders inline in the dialog", async () => {
    rpc.reassignPackageChild.mockResolvedValue({
      error: { message: "A lesson has already drawn from this package — refund it instead." },
    });
    const { result } = renderHook(() => useChangeChild({ setBusy: vi.fn(), reload: vi.fn(), childOptions: KIDS }));
    act(() => result.current.openChangeChild(pkg));
    expect(result.current.childId).toBe("ben"); // the only OTHER child
    await act(async () => { await result.current.saveChangeChild(); });
    expect(rpc.reassignPackageChild).toHaveBeenCalledWith({ p_package: "pkg-1", p_student: "ben" });
    render(<ChangeChildModal form={result.current} busy={false} />);
    expect(screen.getByRole("alert").textContent).toBe("A lesson has already drawn from this package — refund it instead.");
  });
});

describe("Generate offers (RISK 4)", () => {
  it("a family row and a child's row of one parent select, price and send independently", async () => {
    rpc.renewalCandidates.mockResolvedValue({
      error: null,
      data: [
        { parent_id: "p1", parent_name: "Mum", parent_phone: null, children: "Ava, Ben", student_id: null,
          suggested_product_id: "shared", original_product_id: "shared", has_open_offer: false },
        { parent_id: "p1", parent_name: "Mum", parent_phone: null, children: "Ava", student_id: "ava",
          suggested_product_id: "one", original_product_id: "one", has_open_offer: false },
      ],
    });
    const { result } = renderHook(() =>
      useGenerateOffers({ activeProducts: PRODUCTS, businessName: "B", setQueue: vi.fn(), setError: vi.fn(), reload: vi.fn() })
    );
    await act(async () => { await result.current.openGenerateAll(); });
    const keys = result.current.candidates.map(candidateKey);
    expect(keys).toEqual(["p1:family", "p1:ava"]);
    expect(result.current.candidates.map((c) => c.previewPayable)).toEqual([300, 150]);
    // The child's suggestion sequenced against that child.
    expect(rpc.fetchSuggestedStart).toHaveBeenCalledWith("p1", "one", "ava");
    expect(rpc.fetchSuggestedStart).toHaveBeenCalledWith("p1", "shared", null);

    act(() => result.current.toggleInclude("p1:family", false));
    expect(result.current.candidates.map((c) => c.include)).toEqual([false, true]);
    act(() => result.current.changeCandidateStart("p1:ava", "2026-11-01"));
    expect(result.current.candidates.map((c) => c.chosenStart)).toEqual(["2026-10-17", "2026-11-01"]);

    act(() => result.current.toggleInclude("p1:family", true));
    await act(async () => { await result.current.confirmGenerateAll(); });
    await waitFor(() => expect(rpc.createPackageOffer).toHaveBeenCalledTimes(2));
    expect(rpc.createPackageOffer).toHaveBeenCalledWith(expect.objectContaining({ p_product_id: "shared", p_student_id: null }));
    expect(rpc.createPackageOffer).toHaveBeenCalledWith(
      expect.objectContaining({ p_product_id: "one", p_student_id: "ava", p_start_date: "2026-11-01" })
    );
  });
});
