// Characterisation tests for packageRows.ts — they pin the mapping/filter
// behaviour the Packages page ALREADY had before Stage 4 (docs/refactor/
// PACKAGES_REFACTOR_PLAN.md §8). Not §7.25 prove-red tests: the behaviour
// pre-exists; these lock it so the extraction cannot change it.

import { describe, expect, it } from "vitest";
import {
  mapCategories,
  mapProducts,
  childrenByParent,
  liveBalancesById,
  mapPurchases,
  mapParents,
  pendingPurchases,
  supersededPurchases,
  heldPurchases,
  heldMatching,
  activeProducts,
  refundsByPackage,
  refundState,
} from "./packageRows";
import type { LiveRefund, Purchase } from "../types";

describe("mapCategories", () => {
  it("counts classes from the embedded array and defaults nulls", () => {
    const [c] = mapCategories([
      { id: "c1", name: "Squad", classes: [{ id: "x" }, { id: "y" }] },
    ] as any); // partial row: pins the null defaults
    expect(c).toMatchObject({
      id: "c1",
      name: "Squad",
      class_count: 2,
      default_product_id: null,
      default_capacity: null,
    });
  });
  it("is empty for null", () => {
    expect(mapCategories(null)).toEqual([]);
  });
});

describe("mapProducts", () => {
  it("holder_count excludes cancelled packages and reads category name off the FK", () => {
    const [p] = mapProducts([
      {
        id: "p1",
        name: "10-pack",
        category_id: "c1",
        class_categories: { name: "Squad" },
        lesson_count: 10,
        rate_per_lesson: "35.5",
        validity_weeks: 12,
        is_active: true,
        parent_packages: [
          { id: "a", status: "active" },
          { id: "b", status: "cancelled" },
          { id: "c", status: "pending" },
        ],
      },
    ] as any); // numeric as a string: pins the Number() coercion
    expect(p.category_name).toBe("Squad");
    expect(p.rate_per_lesson).toBe(35.5);
    expect(p.holder_count).toBe(2); // active + pending, NOT cancelled
  });
});

describe("childrenByParent", () => {
  it("keeps only active, named children, grouped by parent", () => {
    const map = childrenByParent([
      { parent_id: "p1", students: { id: "s1", full_name: "Ali", is_active: true } },
      { parent_id: "p1", students: [{ full_name: "Bo", is_active: true }] },
      { parent_id: "p1", students: { full_name: "Cy", is_active: false } },
      { parent_id: "p2", students: { full_name: null, is_active: true } },
    ] as any); // a null name: pins the skip
    expect(map.get("p1")).toEqual(["Ali", "Bo"]);
    expect(map.has("p2")).toBe(false);
  });
});

describe("mapPurchases", () => {
  const base = {
    id: "pp1",
    parent_id: "p1",
    name: "10-pack",
    lesson_count: 10,
    rate_per_lesson: "35",
    total_value: "350",
    amount_payable: "300",
    discount_amount: "50",
    value_remaining: "350",
    status: "active",
    product_id: "prod1",
    requested_at: "2026-09-01",
  } as any; // partial row, numerics as strings: pins the fallbacks and Number()

  it("takes live balances from the RPC map, null when absent, and joins children", () => {
    const live = liveBalancesById([
      { parent_package_id: "pp1", live_value_remaining: "200", live_lessons_remaining: "6" },
    ] as any);
    const kids = childrenByParent([
      { parent_id: "p1", students: { id: "s1", full_name: "Ali", is_active: true } },
    ]);
    const [row] = mapPurchases(
      [{ ...base, parents: { profiles: { full_name: "Mum" } } }],
      live,
      kids
    );
    expect(row.parent_name).toBe("Mum");
    expect(row.live_value_remaining).toBe(200);
    expect(row.live_lessons_remaining).toBe(6);
    expect(row.children).toBe("Ali");
    expect(row.amount_payable).toBe(300);
  });

  it("live_* are null when the package is not in the balances map", () => {
    const [row] = mapPurchases([base], new Map(), new Map());
    expect(row.live_value_remaining).toBeNull();
    expect(row.live_lessons_remaining).toBeNull();
    expect(row.children).toBeNull();
  });

  it("parent_name falls back email → 'Unknown'", () => {
    const [email] = mapPurchases(
      [{ ...base, parents: { profiles: { full_name: null, email: "a@b.co" } } }],
      new Map(),
      new Map()
    );
    expect(email.parent_name).toBe("a@b.co");
    const [unknown] = mapPurchases([{ ...base, parents: null }], new Map(), new Map());
    expect(unknown.parent_name).toBe("Unknown");
  });
});

describe("mapParents", () => {
  it("drops rows with no parent id", () => {
    const out = mapParents([
      { parents: { id: "p1", profiles: { full_name: "Mum" } } },
      { parents: null },
    ] as any);
    expect(out).toEqual([{ id: "p1", name: "Mum" }]);
  });
});

describe("purchase buckets", () => {
  const rows: Purchase[] = [
    { status: "pending", superseded_by: null } as Purchase,
    { status: "active", superseded_by: null } as Purchase,
    { status: "cancelled", superseded_by: "newer" } as Purchase,
    { status: "cancelled", superseded_by: null } as Purchase,
  ];
  it("pending = only pending", () => {
    expect(pendingPurchases(rows)).toHaveLength(1);
  });
  it("superseded = cancelled AND superseded_by set", () => {
    expect(supersededPurchases(rows)).toHaveLength(1);
  });
  it("held = not pending AND not a superseded offer (a plain cancelled stays)", () => {
    const held = heldPurchases(rows);
    expect(held).toHaveLength(2); // active + plain cancelled
    expect(held.some((p) => p.status === "pending")).toBe(false);
    expect(held.some((p) => p.status === "cancelled" && p.superseded_by)).toBe(false);
  });
});

describe("heldMatching", () => {
  const held: Purchase[] = [
    { parent_name: "Alice", name: "10-pack", reference_number: "PKG-1" } as Purchase,
    { parent_name: "Bob", name: "5-pack", reference_number: "PKG-2" } as Purchase,
  ];
  it("blank term matches everyone", () => {
    expect(heldMatching(held, "")).toHaveLength(2);
  });
  it("narrows by parent name, package name, or reference", () => {
    expect(heldMatching(held, "alice")).toHaveLength(1);
    expect(heldMatching(held, "5-pack")).toHaveLength(1);
    expect(heldMatching(held, "PKG-2")).toHaveLength(1);
  });
});

describe("activeProducts", () => {
  it("keeps only is_active", () => {
    const out = activeProducts([
      { id: "a", is_active: true } as any,
      { id: "b", is_active: false } as any,
    ]);
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });
});

// Refunds (PACKAGE_REVENUE_REFUNDS_PLAN.md U2) — NEW behaviour, so §7.25 applies:
// proven red by dropping the `!p.confirmed_at` condition (a declined request
// then offers Record refund) and by `refunds === null` → `false` (a failed read
// then offers it too).
describe("refundState", () => {
  const base = {
    id: "k1",
    status: "cancelled",
    confirmed_at: "2026-09-16T05:46:00Z",
    amount_payable: 350,
  } as Purchase;
  const none = new Map<string, LiveRefund>();
  const withRefund = new Map<string, LiveRefund>([
    ["k1", { id: "r1", parent_package_id: "k1", amount: 100, refunded_on: "2026-09-20", note: null }],
  ]);

  it("a cancelled, paid package with no refund can be refunded — only with packages:edit", () => {
    expect(refundState(base, none, true)).toBe("can_record");
    expect(refundState(base, none, false)).toBe("none");
  });
  it("a recorded refund shows, reversible only with packages:edit", () => {
    expect(refundState(base, withRefund, true)).toBe("recorded");
    expect(refundState(base, withRefund, false)).toBe("recorded_readonly");
  });
  it("an active package, a declined request (never paid) and a S$0 package offer nothing", () => {
    expect(refundState({ ...base, status: "active" }, none, true)).toBe("none");
    expect(refundState({ ...base, confirmed_at: null }, none, true)).toBe("none");
    expect(refundState({ ...base, amount_payable: 0 }, none, true)).toBe("none");
  });
  it("fails CLOSED when refunds could not be loaded — never a Record button", () => {
    expect(refundState(base, null, true)).toBe("none");
  });
  it("refundsByPackage keys live refunds by package, numbers as numbers", () => {
    const m = refundsByPackage([{ id: "r1", parent_package_id: "k1", amount: "100.00", refunded_on: "2026-09-20", note: null }] as any);
    expect(m.get("k1")).toEqual({ id: "r1", parent_package_id: "k1", amount: 100, refunded_on: "2026-09-20", note: null });
  });
});
