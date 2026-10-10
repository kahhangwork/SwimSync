import { childrenForProduct, requestStudentFor, packagesOf, childrenOf } from "./billingFormat";
import type { ChildOption } from "../types";

// Single-child packages — the parent's request. Load-bearing (⚠ RISK 7): a shared
// product sends null even with a child chosen; the picker lists only ACTIVE
// children at the PRODUCT's business; one eligible child is used without asking.

const kid = (id: string, tenant_id = "tA", active = true): ChildOption => ({ id, name: id.toUpperCase(), tenant_id, active });
const ONE = { single_child: true, tenant_id: "tA" };
const SHARED = { single_child: false, tenant_id: "tA" };

it("childrenForProduct: active children at the product's business only", () => {
  const kids = [kid("ava"), kid("ben", "tB"), kid("cai", "tA", false)];
  expect(childrenForProduct(kids, ONE).map((k) => k.id)).toEqual(["ava"]);
});

it("requestStudentFor: shared → null even with a choice; one eligible → that child; several → the choice", () => {
  expect(requestStudentFor(SHARED, [kid("ava")], "ava")).toBeNull();
  expect(requestStudentFor(ONE, [kid("ava")], undefined)).toBe("ava");
  expect(requestStudentFor(ONE, [kid("ava"), kid("ben")], undefined)).toBeNull();
  expect(requestStudentFor(ONE, [kid("ava"), kid("ben")], "ben")).toBe("ben");
  expect(requestStudentFor(ONE, [kid("ava"), kid("ben")], "zed")).toBeNull(); // not eligible
  expect(requestStudentFor(ONE, [], undefined)).toBeNull();
});

it("packagesOf names a one-child package's child from the family list, never an embed", () => {
  const base = { id: "pp", name: "OC5", lesson_count: 5, rate_per_lesson: 30, total_value: 150, amount_payable: 150,
    discount_amount: 0, status: "active", offered_by: null, expires_on: "2027-01-01", requested_at: "x",
    holiday_extension_days: 0, cancel_extension_days: 0, class_categories: null, tenants: null };
  const [own, shared, unknown] = packagesOf(
    [{ ...base, student_id: "ava" }, { ...base, id: "pp2", student_id: null }, { ...base, id: "pp3", student_id: "zed" }] as never,
    [],
    [kid("ava")]
  );
  expect(own.child_name).toBe("AVA");
  expect(shared.child_name).toBeNull();
  expect(unknown.child_name).toBe("your child");
});

it("childrenOf drops rows RLS hid", () => {
  expect(childrenOf([{ students: { id: "ava", full_name: "Ava", is_active: true, tenant_id: "tA" } }, { students: null }] as never))
    .toEqual([{ id: "ava", name: "Ava", tenant_id: "tA", active: true }]);
});
