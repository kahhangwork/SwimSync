// CHARACTERISATION test (docs/refactor/BATCH_FGH_PLAN.md, App L-G): pins what the
// Invoice Detail screen's mapping already did when it moved out of the route file.
// §7.25's prove-it-red rule does not apply — there is no fix, only a move.
import { formatBillingMonth, invoiceDetailOf } from "./invoiceDetailFormat";

describe("invoiceDetailFormat (characterisation)", () => {
  it("formatBillingMonth: 'YYYY-MM' -> long month + year", () => {
    expect(formatBillingMonth("2026-07")).toBe("July 2026");
  });

  it("invoiceDetailOf: snapshotted name first, lines sorted by date, funding tags, numbers, defaults", () => {
    const d = invoiceDetailOf(
      {
        id: "i1",
        billing_month: "2026-08",
        gross_amount: "80",
        credit_applied: "0",
        net_amount: "80",
        status: "outstanding",
        generated_at: "2026-09-01T00:00:00+08:00",
        paid_at: null,
        tenants: [{ display_name: "Coastal" }],
        invoice_items: [
          { id: "b", amount: "40", class_title: "Dolphins", session_date: "2026-08-15", attendance_status: "present", student_name: null, students: { full_name: "Live Name" } },
          { id: "a", amount: "40", class_title: "Dolphins", session_date: "2026-08-08", attendance_status: "absent_billable", student_name: "As Invoiced", students: { full_name: "Renamed" } },
          { id: "c", amount: 0, class_title: "X", session_date: "2026-08-22", attendance_status: "present", student_name: null, students: null },
        ],
      },
      [{ id: "cn", reference_number: "CN-1", amount: "12.5", reason: null }],
      new Map([["a", "10-pack"]]),
      "coach-1"
    );
    expect(d.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(d.items[0]).toMatchObject({ student_name: "As Invoiced", funded_by: "10-pack", amount: 40 });
    expect(d.items[1]).toMatchObject({ student_name: "Live Name", funded_by: null });
    expect(d.items[2].student_name).toBe("—");
    expect(d).toMatchObject({ business_name: "Coastal", reference_number: null, package_applied: 0, balance_adjustment: 0, paid_claimed_at: null, coach_id: "coach-1", gross_amount: 80 });
    expect(d.credit_notes).toEqual([{ id: "cn", reference_number: "CN-1", amount: 12.5, reason: null }]);
    expect(invoiceDetailOf({ id: "z", tenants: null, invoice_items: null }, null, new Map(), null).business_name).toBe("Your coach");
  });
});
