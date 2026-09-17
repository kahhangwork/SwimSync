// Characterisation tests (Admin L-C, BATCH_C_PLAN.md): pin the row mapping, the
// status label and the resend-reason copy as they were inline on
// credit-notes/page.tsx. They pin existing behaviour, so §7.25's prove-it-red
// rule does not apply (playbook §0).
import { describe, it, expect } from "vitest";
import {
  CREDIT_NOTE_CSV_COLUMNS,
  creditNoteStatusLabel,
  resendReasonLabel,
  toCreditNoteRow,
} from "./creditNoteRows";

describe("creditNoteStatusLabel", () => {
  it("reversed is NOT Available; anything unknown is Available", () => {
    expect(creditNoteStatusLabel("applied")).toBe("Applied");
    expect(creditNoteStatusLabel("reversed")).toBe("Reversed");
    expect(creditNoteStatusLabel("available")).toBe("Available");
    expect(creditNoteStatusLabel("weird")).toBe("Available");
  });
});

describe("toCreditNoteRow", () => {
  const base = {
    id: "cn1", reference_number: "CN-1", amount: "12.50", reason: "absent",
    status: "available", applied_to_invoice_id: null, issued_at: "2026-09-01T03:00:00+00:00",
    student_name: null, email_sent_at: null, tenant_id: "t1",
    credit_applications: [], students: { id: "s1", full_name: "Kid" },
    parents: { profiles: { full_name: "Mum" } },
  };

  it("maps the embeds, the date prefix and the numeric amount", () => {
    expect(toCreditNoteRow(base)).toEqual({
      id: "cn1", reference_number: "CN-1", student_id: "s1", student_name: "Kid",
      parent_name: "Mum", amount: 12.5, reason: "absent", linked_invoice_id: null,
      created_at: "2026-09-01", status: "available", email_sent_at: null, tenant_id: "t1",
      applied_to_invoice_id: null, has_applications: false,
    });
  });

  it("the snapshot student_name wins over the embed; missing embeds read —", () => {
    const r = toCreditNoteRow({ ...base, student_name: "Snap", students: null, parents: null, issued_at: null });
    expect(r.student_name).toBe("Snap");
    expect(r.student_id).toBe("");
    expect(r.parent_name).toBe("—");
    expect(r.created_at).toBe("—");
  });

  it("⚠ RISK 2: only a LIVE application (reversed_at null) counts as applied", () => {
    expect(toCreditNoteRow({ ...base, credit_applications: [{ reversed_at: "2026-09-02" }] }).has_applications).toBe(false);
    expect(toCreditNoteRow({ ...base, credit_applications: [{ reversed_at: "2026-09-02" }, { reversed_at: null }] }).has_applications).toBe(true);
    expect(toCreditNoteRow({ ...base, credit_applications: undefined }).has_applications).toBe(false);
  });
});

describe("resendReasonLabel", () => {
  it("maps the known reasons and passes an unknown one through", () => {
    expect(resendReasonLabel("not allowed")).toBe("You do not administer this business.");
    expect(resendReasonLabel("tenant suspended")).toBe("This business is suspended, so no email was sent.");
    expect(resendReasonLabel("something new")).toBe("something new");
  });
});

describe("CREDIT_NOTE_CSV_COLUMNS", () => {
  it("keeps the header order and exports the status label + emailed flag", () => {
    expect(CREDIT_NOTE_CSV_COLUMNS.map((c) => c.header)).toEqual([
      "Reference", "Student", "Parent", "Amount", "Reason", "Linked Invoice", "Date", "Status", "Emailed",
    ]);
    const row = toCreditNoteRow({ id: "x", status: "reversed", email_sent_at: "2026-09-01", amount: 1 });
    expect(CREDIT_NOTE_CSV_COLUMNS[7].value(row)).toBe("Reversed");
    expect(CREDIT_NOTE_CSV_COLUMNS[8].value(row)).toBe("yes");
  });
});
