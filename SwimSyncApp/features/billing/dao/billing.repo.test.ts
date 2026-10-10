// billing.repo — the exact PostgREST chains of the parent Billing tab's money reads
// (Wave 8, RISK 4 / §7.314). A dropped filter here shows a parent someone else's
// invoices, or a voided credit note as "Available", and no hook test can see it.
// `toEqual` on the WHOLE recorded list (select strings compared whitespace-free).
//
// MUTATION PROOFS (applied by hand, restored from HEAD, 2026-10-06):
//   1. delete `.eq("parent_id", parentId)` from fetchInvoices → RED "invoices …"
//   2. delete `.neq("status", "reversed")` from fetchCreditNotes → RED "credit notes …"
//   3. `["pending", "active"]` → `["pending"]` in fetchPackages → RED "packages …"
import {
  fetchCreditNotes,
  fetchInvoices,
  fetchPackages,
  fetchProducts,
} from "./billing.repo";

const mockChain: unknown[][] = [];
jest.mock("@/lib/supabase", () => {
  const proxy: any = new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === "then") return undefined;
        return (...args: unknown[]) => {
          mockChain.push([name, ...args]);
          return proxy;
        };
      },
    }
  );
  return { supabase: proxy };
});

const recorded = () =>
  mockChain.map((c) => (c[0] === "select" ? ["select", String(c[1]).replace(/\s+/g, "")] : c));

beforeEach(() => {
  mockChain.length = 0;
});

describe("billing.repo money chains", () => {
  it("invoices: this parent's, newest month first, with the business", () => {
    fetchInvoices("parent-1");
    expect(recorded()).toEqual([
      ["from", "invoices"],
      [
        "select",
        "id,reference_number,billing_month,gross_amount,package_applied,credit_applied," +
          "net_amount,status,paid_claimed_at,tenant_id,tenants(display_name)",
      ],
      ["eq", "parent_id", "parent-1"],
      ["order", "billing_month", { ascending: false }],
    ]);
  });

  it("credit notes: this parent's, never a reversed (voided) one", () => {
    fetchCreditNotes("parent-1");
    expect(recorded()).toEqual([
      ["from", "credit_notes"],
      [
        "select",
        "id,reference_number,amount,issued_at,original_status,corrected_status,reason,applied_to_invoice_id",
      ],
      ["eq", "parent_id", "parent-1"],
      ["neq", "status", "reversed"],
      ["order", "issued_at", { ascending: false }],
    ]);
  });

  it("packages: pending and active only (RLS scopes them to the parent)", () => {
    fetchPackages();
    expect(recorded()).toEqual([
      ["from", "parent_packages"],
      [
        "select",
        "id,name,lesson_count,rate_per_lesson,total_value,amount_payable,discount_amount,status," +
          "offered_by,expires_on,requested_at,holiday_extension_days,cancel_extension_days,student_id," +
          "class_categories(name),tenants(display_name)",
      ],
      ["in", "status", ["pending", "active"]],
      ["order", "requested_at", { ascending: false }],
    ]);
  });

  it("products: active ones, with FK-hinted category and business", () => {
    fetchProducts();
    expect(recorded()).toEqual([
      ["from", "package_products"],
      [
        "select",
        "id,tenant_id,name,lesson_count,rate_per_lesson,validity_weeks,single_child," +
          "class_categories!package_products_category_id_fkey(name)," +
          "tenants!package_products_tenant_id_fkey(display_name)",
      ],
      ["eq", "is_active", true],
      ["order", "name"],
    ]);
  });
});
