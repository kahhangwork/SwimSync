// CHARACTERISATION test (docs/refactor/BATCH_FGH_PLAN.md, App L-G): pins what the
// Billing tab's mappings already did when they moved out of the route file.
// §7.25's prove-it-red rule does not apply — there is no fix, only a move. Each
// guarded line was mutated once and a named case went red (playbook §5).
import {
  formatBillingMonth,
  formatDate,
  capitalize,
  invoicesOf,
  packagesOf,
  productsOf,
} from "./billingFormat";

describe("billingFormat (characterisation)", () => {
  it("formatBillingMonth: 'YYYY-MM' -> long month + year", () => {
    expect(formatBillingMonth("2026-08")).toBe("August 2026");
  });

  it("formatDate: short SGT date; capitalize: first letter up, underscores to spaces", () => {
    expect(formatDate("2026-09-01")).toBe("1 Sept 2026");
    expect(capitalize("not_billable")).toBe("Not billable");
  });

  it("invoicesOf: amounts to numbers, package_applied defaults 0, business from the embed (array or object), fallback 'Your coach'", () => {
    const [a, b, c] = invoicesOf([
      { id: "i1", gross_amount: "100", package_applied: null, credit_applied: "5", net_amount: "95", tenants: { display_name: "Coastal" } },
      { id: "i2", gross_amount: 1, package_applied: "2", credit_applied: 0, net_amount: 0, tenants: [{ display_name: "Harbour" }] },
      { id: "i3", gross_amount: 1, credit_applied: 0, net_amount: 1, tenants: null },
    ]);
    expect(a).toMatchObject({ id: "i1", gross_amount: 100, package_applied: 0, credit_applied: 5, net_amount: 95, business_name: "Coastal" });
    expect(b.package_applied).toBe(2);
    expect(b.business_name).toBe("Harbour");
    expect(c.business_name).toBe("Your coach");
    expect(c.package_applied).toBe(0); // absent (pre-package rows), not NaN
    expect(invoicesOf(null)).toEqual([]);
  });

  it("packagesOf: joins LIVE balances by id (null when absent), numbers, category + extension defaults", () => {
    const [live, noLive] = packagesOf(
      [
        { id: "p1", name: "10-pack", lesson_count: 10, rate_per_lesson: "25", total_value: "250", amount_payable: "225", discount_amount: "25", status: "active", offered_by: "u1", expires_on: "2026-12-01", holiday_extension_days: 7, cancel_extension_days: null, class_categories: [{ name: "Group" }], tenants: { display_name: "Coastal" } },
        { id: "p2", name: "5-pack", lesson_count: 5, rate_per_lesson: 30, total_value: 150, amount_payable: 150, discount_amount: 0, status: "pending", expires_on: null, class_categories: null, tenants: null },
      ],
      [{ parent_package_id: "p1", live_lessons_remaining: "9", live_value_remaining: "225" }]
    );
    expect(live).toMatchObject({ category_name: "Group", business_name: "Coastal", total_value: 250, amount_payable: 225, discount_amount: 25, live_lessons_remaining: 9, live_value_remaining: 225, holiday_extension_days: 7, cancel_extension_days: 0, offered_by: "u1" });
    expect(noLive).toMatchObject({ category_name: null, business_name: "Your coach", live_lessons_remaining: null, live_value_remaining: null, holiday_extension_days: 0, offered_by: null });
    expect(packagesOf(null, null)).toEqual([]);
  });

  it("productsOf: the product card's fields, rate as a number", () => {
    expect(
      productsOf([{ id: "x", name: "10-pack", lesson_count: 10, rate_per_lesson: "25.5", validity_weeks: 12, class_categories: { name: "Private" }, tenants: [{ display_name: "Coastal" }] }])
    ).toEqual([{ id: "x", name: "10-pack", business_name: "Coastal", category_name: "Private", lesson_count: 10, rate_per_lesson: 25.5, validity_weeks: 12 }]);
  });
});
