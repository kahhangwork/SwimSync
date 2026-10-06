// parentHome.repo — the exact PostgREST chains of the parent Home money reads (Wave 8,
// RISK 4 / §7.314). `totalOutstandingOf(null)` and `totalCredit` of an empty read are
// 0, so a broken chain shows every parent a clean S$0.00 — no hook test can see it.
// `toEqual` on the WHOLE recorded list (select strings compared whitespace-free).
//
// MUTATION PROOFS (applied by hand, restored from HEAD, 2026-10-06):
//   1. delete `.eq("status", "outstanding")` → RED "outstanding invoices …"
//   2. delete `.eq("parent_id", parentId)` → RED "outstanding invoices …"
//   3. drop `parent_tenant_balances(credit_balance),` from the home select → RED "the home read …"
import { fetchOutstandingInvoices, fetchParentHome } from "./parentHome.repo";

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

describe("parentHome.repo money chains", () => {
  it("the home read: this profile's parent row, with balances, children and classes", () => {
    fetchParentHome({ id: "profile-1" });
    expect(recorded()).toEqual([
      ["from", "parents"],
      [
        "select",
        "id,parent_tenant_balances(credit_balance),parent_students(students(id,full_name," +
          "assignment_status,is_active,student_class_enrolments(is_active,classes(day_of_week," +
          "start_time,end_time,locations(name),coaches(profiles(full_name))))))",
      ],
      ["eq", "profile_id", "profile-1"],
      ["single"],
    ]);
  });

  it("outstanding invoices: this parent, outstanding only — the family-wide total", () => {
    fetchOutstandingInvoices("parent-1");
    expect(recorded()).toEqual([
      ["from", "invoices"],
      ["select", "net_amount"],
      ["eq", "parent_id", "parent-1"],
      ["eq", "status", "outstanding"],
    ]);
  });
});
