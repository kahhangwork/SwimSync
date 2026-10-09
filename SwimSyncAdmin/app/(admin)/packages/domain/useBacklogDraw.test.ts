import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Backdated activation (Wave 6 D5). Load-bearing:
//   • BOTH activation paths in the census (Confirm payment, Record a sale) ask
//     — and only AFTER their write succeeded, with the activated package's id;
//     a failed activation asks nothing;
//   • the dialog opens only when the preview returned rows;
//   • Draw calls draw_package_backlog with the package id ALONE (⚠ RISK 8: it
//     re-derives; the preview rows are never sent back), once, and shows the
//     DRAW's count; a refusal shows the DB's words;
//   • Keep as ad-hoc writes nothing;
//   • a failed preview is SAID on the page, never swallowed.

const { repo, rpc } = vi.hoisted(() => ({
  repo: {
    activatePendingPurchase: vi.fn(),
    insertPurchase: vi.fn(),
    findConvertedReferral: vi.fn(async () => ({ data: null })),
    findReferrerReward: vi.fn(async () => ({ data: null })),
    cancelPurchase: vi.fn(),
  },
  rpc: {
    packageBacklogPreview: vi.fn(),
    drawPackageBacklog: vi.fn(),
    invokePackageEmail: vi.fn(async () => ({})),
    fetchSuggestedStart: vi.fn(async () => "2026-09-01"),
    fetchPreviewPrice: vi.fn(async () => null),
    myTenantId: vi.fn(async () => "t1"),
  },
}));

vi.mock("../dao/packages.repo", () => repo);
vi.mock("../dao/packages.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: backlog test reached the real supabase client");
});

import { useBacklogDraw } from "./useBacklogDraw";
import { usePurchaseActions } from "./usePurchaseActions";
import { useSale } from "./useSale";
import { summariseBacklog, drawResultText, type BacklogRow } from "./backlogDraw";
import type { Purchase } from "../types";

const ROW = (over: Partial<BacklogRow> = {}): BacklogRow => ({
  session_date: "2026-09-04",
  student_id: "s1",
  student_name: "Ava",
  class_title: "Dolphins Fri 4pm",
  funding_package_id: "pkg-1",
  funding_package_name: "10 lessons",
  funds_this: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("summariseBacklog / drawResultText", () => {
  it("splits rows into this package / another package / stays ad-hoc", () => {
    expect(
      summariseBacklog([
        ROW(),
        ROW({ student_id: "s2" }),
        ROW({ student_id: "s3", funds_this: false, funding_package_id: "pkg-0" }),
        ROW({ student_id: "s4", funds_this: false, funding_package_id: null, funding_package_name: null }),
      ])
    ).toEqual({ total: 4, thisPackage: 2, otherPackage: 1, adhoc: 1 });
  });

  it("a 0 from the draw says nothing was left to draw", () => {
    expect(drawResultText(0)).toMatch(/Nothing to draw/);
    expect(drawResultText(1)).toBe("Drew 1 lesson from the family's packages.");
    expect(drawResultText(3)).toBe("Drew 3 lessons from the family's packages.");
  });
});

describe("useBacklogDraw", () => {
  const setup = () => {
    const setError = vi.fn();
    const reload = vi.fn();
    const hook = renderHook(() => useBacklogDraw({ setError, reload }));
    return { ...hook, setError, reload };
  };

  it("no rows → no dialog, nothing drawn", async () => {
    rpc.packageBacklogPreview.mockResolvedValue({ data: [], error: null });
    const { result } = setup();
    await act(() => result.current.offer("pkg-1", "10 lessons"));
    expect(rpc.packageBacklogPreview).toHaveBeenCalledWith("pkg-1");
    expect(result.current.backlog).toBeNull();
    expect(rpc.drawPackageBacklog).not.toHaveBeenCalled();
  });

  it("rows → the dialog opens with them", async () => {
    rpc.packageBacklogPreview.mockResolvedValue({ data: [ROW()], error: null });
    const { result } = setup();
    await act(() => result.current.offer("pkg-1", "10 lessons"));
    expect(result.current.backlog).toMatchObject({ packageId: "pkg-1", packageName: "10 lessons", drawn: null });
    expect(result.current.backlog!.rows).toHaveLength(1);
  });

  it("a failed preview is said on the page, and opens nothing", async () => {
    rpc.packageBacklogPreview.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result, setError } = setup();
    await act(() => result.current.offer("pkg-1", "10 lessons"));
    expect(result.current.backlog).toBeNull();
    expect(setError).toHaveBeenCalledWith(expect.stringMatching(/10 lessons is active.*boom.*ad-hoc/));
  });

  it("Draw sends the package id ALONE, once, and shows the draw's own count", async () => {
    rpc.packageBacklogPreview.mockResolvedValue({ data: [ROW(), ROW({ student_id: "s2" })], error: null });
    rpc.drawPackageBacklog.mockResolvedValue({ data: 1, error: null });
    const { result, reload } = setup();
    await act(() => result.current.offer("pkg-1", "10 lessons"));
    await act(() => result.current.draw());
    await act(() => result.current.draw()); // a second press after the result
    expect(rpc.drawPackageBacklog).toHaveBeenCalledTimes(1);
    expect(rpc.drawPackageBacklog).toHaveBeenCalledWith("pkg-1");
    expect(result.current.backlog!.drawn).toBe(1); // the draw's 1, not the preview's 2
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a refused draw shows the DB's words and stays open", async () => {
    rpc.packageBacklogPreview.mockResolvedValue({ data: [ROW()], error: null });
    rpc.drawPackageBacklog.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "this business does not draw packages at marking yet" },
    });
    const { result, reload } = setup();
    await act(() => result.current.offer("pkg-1", "10 lessons"));
    await act(() => result.current.draw());
    expect(result.current.backlog).toMatchObject({
      drawn: null,
      error: "this business does not draw packages at marking yet",
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("offer() marks its dialog as an activation", async () => {
    rpc.packageBacklogPreview.mockResolvedValue({ data: [ROW()], error: null });
    const { result } = setup();
    await act(() => result.current.offer("pkg-1", "10 lessons"));
    expect(result.current.backlog!.source).toBe("activation");
  });

  it("Keep as ad-hoc closes and writes nothing", async () => {
    rpc.packageBacklogPreview.mockResolvedValue({ data: [ROW()], error: null });
    const { result } = setup();
    await act(() => result.current.offer("pkg-1", "10 lessons"));
    act(() => result.current.dismiss());
    expect(result.current.backlog).toBeNull();
    expect(rpc.drawPackageBacklog).not.toHaveBeenCalled();
  });
});

// PRD §7.16: the Held table's "Check marked lessons".
// The same preview and the same Draw; an empty answer opens the dialog to SAY so
// (the admin asked), a failed read says so on the page, and nothing is drawn
// until the admin presses Draw.
describe("useBacklogDraw.check — the question asked again", () => {
  const setup = () => {
    const setError = vi.fn();
    const reload = vi.fn();
    const hook = renderHook(() => useBacklogDraw({ setError, reload }));
    return { ...hook, setError, reload };
  };

  it("rows → the dialog opens as a check; nothing drawn until Draw", async () => {
    rpc.packageBacklogPreview.mockResolvedValue({ data: [ROW()], error: null });
    const { result } = setup();
    await act(() => result.current.check("pkg-1", "10 lessons"));
    expect(rpc.packageBacklogPreview).toHaveBeenCalledWith("pkg-1");
    expect(result.current.backlog).toMatchObject({ packageId: "pkg-1", source: "check", drawn: null });
    expect(rpc.drawPackageBacklog).not.toHaveBeenCalled();
    rpc.drawPackageBacklog.mockResolvedValue({ data: 1, error: null });
    await act(() => result.current.draw());
    expect(rpc.drawPackageBacklog).toHaveBeenCalledWith("pkg-1");
    expect(result.current.backlog!.drawn).toBe(1);
  });

  it("no rows → the dialog still opens, empty, so the answer is said", async () => {
    rpc.packageBacklogPreview.mockResolvedValue({ data: [], error: null });
    const { result } = setup();
    await act(() => result.current.check("pkg-1", "10 lessons"));
    expect(result.current.backlog).toMatchObject({ rows: [], source: "check" });
  });

  it("a failed read is said on the page and opens nothing", async () => {
    rpc.packageBacklogPreview.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result, setError } = setup();
    await act(() => result.current.check("pkg-1", "10 lessons"));
    expect(result.current.backlog).toBeNull();
    expect(setError).toHaveBeenLastCalledWith(expect.stringMatching(/Checking 10 lessons.*boom.*Nothing was drawn/));
  });

  it("checking names the package while the read is in flight, then clears", async () => {
    let resolve!: (v: unknown) => void;
    rpc.packageBacklogPreview.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = setup();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.check("pkg-1", "10 lessons");
    });
    expect(result.current.checking).toBe("pkg-1");
    await act(async () => {
      resolve({ data: [], error: null });
      await pending;
    });
    expect(result.current.checking).toBeNull();
  });
});

describe("the activation census — both paths ask, after the write", () => {
  const shared = () => ({ setBusy: vi.fn(), setError: vi.fn(), reload: vi.fn(), onActivated: vi.fn() });
  const PENDING = { id: "pkg-9", name: "10 lessons", parent_id: "p1", product_id: "prod1", start_date: null } as unknown as Purchase;

  it("Confirm payment: activates, THEN asks about the activated package", async () => {
    const order: string[] = [];
    repo.activatePendingPurchase.mockImplementation(async () => { order.push("activate"); return { error: null }; });
    const s = shared();
    s.onActivated.mockImplementation(() => order.push("ask"));
    const { result } = renderHook(() => usePurchaseActions(s));
    await act(() => result.current.confirmPurchase(PENDING));
    expect(s.onActivated).toHaveBeenCalledWith("pkg-9", "10 lessons");
    expect(order).toEqual(["activate", "ask"]);
  });

  it("Confirm payment that fails asks nothing", async () => {
    repo.activatePendingPurchase.mockResolvedValue({ error: { message: "no" } });
    const s = shared();
    const { result } = renderHook(() => usePurchaseActions(s));
    await act(() => result.current.confirmPurchase(PENDING));
    expect(s.onActivated).not.toHaveBeenCalled();
  });

  it("Record a sale: inserts active, THEN asks about the new package by its returned id", async () => {
    repo.insertPurchase.mockResolvedValue({ data: { id: "pkg-new" }, error: null });
    const s = shared();
    const { result } = renderHook(() => useSale({ ...s, productName: () => "10 lessons" }));
    act(() => {
      result.current.setSaleModal(true);
      result.current.setSaleParent("p1");
      result.current.setSaleProduct("prod1");
    });
    await act(() => result.current.recordSale());
    expect(repo.insertPurchase).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));
    expect(s.onActivated).toHaveBeenCalledWith("pkg-new", "10 lessons");
  });

  it("a failed sale asks nothing", async () => {
    repo.insertPurchase.mockResolvedValue({ data: null, error: { message: "no" } });
    const s = shared();
    const { result } = renderHook(() => useSale({ ...s, productName: () => "10 lessons" }));
    act(() => {
      result.current.setSaleParent("p1");
      result.current.setSaleProduct("prod1");
    });
    await act(() => result.current.recordSale());
    expect(s.onActivated).not.toHaveBeenCalled();
  });
});
