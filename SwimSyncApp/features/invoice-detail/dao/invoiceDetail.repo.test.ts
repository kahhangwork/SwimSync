// invoiceDetail.repo — the exact PostgREST chains of the invoice-detail money read
// (Wave 8, RISK 4 / §7.314). The hook test cannot see a filter added or dropped
// INSIDE the dao, and a broken read shows the parent a blank invoice, not an error.
// `toEqual` on the WHOLE recorded list (select strings compared whitespace-free), so
// an added, dropped or reordered call goes red — never a partial match.
//
// MUTATION PROOFS (applied by hand, restored from HEAD, 2026-10-06):
//   1. delete `.eq("id", id)` from fetchInvoiceDetail → RED "the invoice: by id, one row"
//   2. `.eq("applied_to_invoice_id", id)` → `.eq("invoice_id", id)` → RED "credit notes …"
//   3. drop `reversed_at` from the package-applications select → RED "package lines …"
import {
  fetchAppliedCreditNotes,
  fetchInvoiceDetail,
  fetchPackageApplications,
  fetchSessionCoach,
} from "./invoiceDetail.repo";

// A chain RECORDER standing in for the client (the childProfile.repo.test.ts pattern).
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

/** The recorded chain with every select string's whitespace removed. */
const recorded = () =>
  mockChain.map((c) => (c[0] === "select" ? ["select", String(c[1]).replace(/\s+/g, "")] : c));

beforeEach(() => {
  mockChain.length = 0;
});

describe("invoiceDetail.repo money chains", () => {
  it("the invoice: by id, one row, with business, lines and their students", () => {
    fetchInvoiceDetail("inv-1");
    expect(recorded()).toEqual([
      ["from", "invoices"],
      [
        "select",
        "id,reference_number,billing_month,gross_amount,package_applied,credit_applied," +
          "balance_adjustment,net_amount,status,generated_at,paid_at,paid_claimed_at," +
          "tenants(display_name),invoice_items(id,lesson_session_id,amount,class_title," +
          "session_date,attendance_status,student_name,students(full_name))",
      ],
      ["eq", "id", "inv-1"],
      ["single"],
    ]);
  });

  it("credit notes applied to THIS invoice", () => {
    fetchAppliedCreditNotes("inv-1");
    expect(recorded()).toEqual([
      ["from", "credit_notes"],
      ["select", "id,reference_number,amount,reason"],
      ["eq", "applied_to_invoice_id", "inv-1"],
    ]);
  });

  it("package lines: by item id, with reversal and the package name", () => {
    fetchPackageApplications(["a", "b"]);
    expect(recorded()).toEqual([
      ["from", "package_applications"],
      ["select", "invoice_item_id,reversed_at,parent_packages(name)"],
      ["in", "invoice_item_id", ["a", "b"]],
    ]);
  });

  it("the coach, through the first line's lesson session", () => {
    fetchSessionCoach("ls-1");
    expect(recorded()).toEqual([
      ["from", "lesson_sessions"],
      ["select", "classes(coach_id)"],
      ["eq", "id", "ls-1"],
      ["single"],
    ]);
  });
});
