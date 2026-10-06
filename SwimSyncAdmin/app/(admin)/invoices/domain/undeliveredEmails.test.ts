import { describe, expect, it } from "vitest";
import {
  groupByMonth,
  mayNotHaveArrivedLabel,
  resendInvoiceReasonLabel,
  toUndeliveredEmail,
} from "./undeliveredEmails";

// docs/plans/CRASH_SAFE_EMAIL_CLAIM_PLAN.md §3.3 — the "may not have arrived" list.

describe("toUndeliveredEmail", () => {
  it("maps the row and its parent embed (object or 1-element array)", () => {
    const row = {
      id: "i1",
      billing_month: "2026-08",
      reference_number: "INV-7",
      invoice_email_claimed_at: "2026-09-01T02:00:00+00:00",
      parents: { profiles: { full_name: "Mrs Tan" } },
    };
    expect(toUndeliveredEmail(row)).toEqual({
      invoiceId: "i1",
      billingMonth: "2026-08",
      reference: "INV-7",
      parentName: "Mrs Tan",
      claimedAt: "2026-09-01T02:00:00+00:00",
    });
    expect(toUndeliveredEmail({ ...row, parents: [{ profiles: [{ full_name: "A" }] }] }).parentName).toBe("A");
  });

  it("a missing parent reads —, a missing reference is null", () => {
    const u = toUndeliveredEmail({ id: "i", billing_month: "2026-08", invoice_email_claimed_at: "x", parents: null } as any); // no reference_number: pins `?? null`
    expect(u.parentName).toBe("—");
    expect(u.reference).toBeNull();
  });
});

describe("groupByMonth", () => {
  it("buckets by billing month, keeping order", () => {
    const e = (invoiceId: string, billingMonth: string) =>
      ({ invoiceId, billingMonth, reference: null, parentName: "p", claimedAt: "t" });
    const g = groupByMonth([e("a", "2026-08"), e("b", "2026-07"), e("c", "2026-08")]);
    expect(g.get("2026-08")?.map((x) => x.invoiceId)).toEqual(["a", "c"]);
    expect(g.get("2026-07")?.map((x) => x.invoiceId)).toEqual(["b"]);
    expect(g.get("2026-06")).toBeUndefined();
  });
});

describe("mayNotHaveArrivedLabel", () => {
  it("singular and plural", () => {
    expect(mayNotHaveArrivedLabel(1)).toBe("1 invoice email may not have arrived");
    expect(mayNotHaveArrivedLabel(3)).toBe("3 invoice emails may not have arrived");
  });
});

describe("resendInvoiceReasonLabel", () => {
  it("an unknown send outcome says it may still arrive — never 'failed'", () => {
    for (const r of ["server_error", "threw", "key_in_flight"]) {
      expect(resendInvoiceReasonLabel(r)).toMatch(/may still arrive/);
    }
  });
  it("names the refusals, passes an unknown reason through", () => {
    expect(resendInvoiceReasonLabel("sending")).toMatch(/Already being sent/);
    expect(resendInvoiceReasonLabel("tenant suspended")).toMatch(/suspended/);
    expect(resendInvoiceReasonLabel("brand_new")).toBe("Not sent (brand_new).");
  });
});
