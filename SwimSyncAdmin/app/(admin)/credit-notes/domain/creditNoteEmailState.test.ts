import { describe, expect, it } from "vitest";
import {
  creditNoteEmailView,
  resendBlockedLabel,
} from "./creditNoteEmailState";

// Plan: docs/plans/CREDIT_NOTE_EMAIL_PLAN.md — ⚠ RISK 2 and ⚠ RISK 4.
// PROVEN RED: dropping the hasApplications term makes the partly-applied test fail;
// swapping isTenantAdminOfNote for a can_admin_tenant-shaped check (platform admin
// allowed) makes the platform-admin test fail.

const TENANT_A = "99999999-0000-0000-0000-00000000000a";
const TENANT_B = "99999999-0000-0000-0000-00000000000b";

const virgin = {
  emailSentAt: null,
  status: "available",
  appliedToInvoiceId: null,
  hasApplications: false,
  tenantId: TENANT_A,
};

const adminOfA = { role: "tenant_admin", tenantId: TENANT_A, adminDisabled: false };

describe("creditNoteEmailView", () => {
  it("a virgin unsent note owned by the viewer's business is resendable", () => {
    expect(creditNoteEmailView(virgin, adminOfA)).toEqual({
      showNotEmailed: true,
      canResend: true,
      blockedReason: null,
    });
  });

  it("an already-emailed note shows no pill and no button", () => {
    expect(
      creditNoteEmailView({ ...virgin, emailSentAt: "2026-08-17T02:00:00Z" }, adminOfA),
    ).toEqual({
      showNotEmailed: false,
      canResend: false,
      blockedReason: "already-emailed",
    });
  });

  // ── ⚠ RISK 4 ──────────────────────────────────────────────────────────────

  it("⚠ RISK 4: a PLATFORM admin gets no Resend button, on any tenant's note", () => {
    const platform = { role: "platform_admin", tenantId: null, adminDisabled: false };
    const view = creditNoteEmailView(virgin, platform);
    expect(view.canResend).toBe(false);
    expect(view.blockedReason).toBe("not-your-business");
    // They still see that it was never emailed — visibility is not the problem.
    expect(view.showNotEmailed).toBe(true);
  });

  it("⚠ RISK 4: a platform admin who also carries a tenant_id is still refused", () => {
    // Defensive: the role is what decides, not the presence of a tenant.
    const view = creditNoteEmailView(virgin, {
      role: "platform_admin",
      tenantId: TENANT_A,
      adminDisabled: false,
    });
    expect(view.canResend).toBe(false);
    expect(view.blockedReason).toBe("not-your-business");
  });

  it("⚠ RISK 4: a tenant admin of ANOTHER business is refused", () => {
    const view = creditNoteEmailView(virgin, {
      role: "tenant_admin",
      tenantId: TENANT_B,
      adminDisabled: false,
    });
    expect(view.canResend).toBe(false);
    expect(view.blockedReason).toBe("not-your-business");
  });

  it("⚠ RISK 4: a viewer with no tenant at all is refused", () => {
    const view = creditNoteEmailView(virgin, {
      role: "tenant_admin",
      tenantId: null,
      adminDisabled: false,
    });
    expect(view.canResend).toBe(false);
    expect(view.blockedReason).toBe("not-your-business");
  });

  // The two the old tenant-id-only check let through. is_tenant_admin() requires
  // role='tenant_admin' AND admin_disabled_at IS NULL, so both of these 403 server
  // side — and a 403 renders as "Edge Function returned a non-2xx status code",
  // which is why the button must be absent instead.
  it("⚠ RISK 4: a COACH whose tenant_id matches is refused", () => {
    const view = creditNoteEmailView(virgin, {
      role: "coach",
      tenantId: TENANT_A,
      adminDisabled: false,
    });
    expect(view.canResend).toBe(false);
    expect(view.blockedReason).toBe("not-your-business");
  });

  it("⚠ RISK 4: a DISABLED tenant admin of the right business is refused", () => {
    const view = creditNoteEmailView(virgin, {
      role: "tenant_admin",
      tenantId: TENANT_A,
      adminDisabled: true,
    });
    expect(view.canResend).toBe(false);
    expect(view.blockedReason).toBe("not-your-business");
  });

  // ── ⚠ RISK 2 ──────────────────────────────────────────────────────────────

  it("⚠ RISK 2: an applied note is not resendable", () => {
    const view = creditNoteEmailView(
      { ...virgin, status: "applied", appliedToInvoiceId: "e0000000-0000-0000-0000-000000000001", hasApplications: true },
      adminOfA,
    );
    expect(view.canResend).toBe(false);
    expect(view.blockedReason).toBe("already-applied");
  });

  // The case `status` alone would miss. This is the test that goes red if the
  // hasApplications term is ever dropped as redundant.
  it("⚠ RISK 2: a PARTLY applied note is refused though status is 'available'", () => {
    const view = creditNoteEmailView(
      { ...virgin, status: "available", appliedToInvoiceId: null, hasApplications: true },
      adminOfA,
    );
    expect(view.canResend).toBe(false);
    expect(view.blockedReason).toBe("already-applied");
  });

  it("⚠ RISK 2: applied_to_invoice_id alone is enough to refuse", () => {
    const view = creditNoteEmailView(
      { ...virgin, appliedToInvoiceId: "e0000000-0000-0000-0000-000000000001" },
      adminOfA,
    );
    expect(view.canResend).toBe(false);
    expect(view.blockedReason).toBe("already-applied");
  });

  it("a reversed (voided) note reports 'reversed', never the 'already used' copy", () => {
    const view = creditNoteEmailView({ ...virgin, status: "reversed" }, adminOfA);
    expect(view.canResend).toBe(false);
    expect(view.showNotEmailed).toBe(false);
    expect(view.blockedReason).toBe("reversed");
  });

  it("a reversed note reads as voided even if it was emailed before the void", () => {
    const view = creditNoteEmailView(
      { ...virgin, status: "reversed", emailSentAt: "2026-08-18T00:00:00Z" },
      adminOfA,
    );
    expect(view.blockedReason).toBe("reversed");
  });

  // Authority is decided BEFORE note state, so a platform admin never learns
  // whether someone else's note happens to be resendable.
  it("permission outranks note state in the reported reason", () => {
    const view = creditNoteEmailView(
      { ...virgin, hasApplications: true },
      { role: "platform_admin", tenantId: null, adminDisabled: false },
    );
    expect(view.blockedReason).toBe("not-your-business");
  });

  it("blockedReason is null exactly when canResend is true", () => {
    const cases = [
      creditNoteEmailView(virgin, adminOfA),
      creditNoteEmailView({ ...virgin, emailSentAt: "x" }, adminOfA),
      creditNoteEmailView(virgin, { role: "platform_admin", tenantId: null, adminDisabled: false }),
      creditNoteEmailView({ ...virgin, hasApplications: true }, adminOfA),
    ];
    for (const v of cases) {
      expect(v.canResend).toBe(v.blockedReason === null);
    }
  });
});

describe("resendBlockedLabel", () => {
  it("gives copy for every reason", () => {
    expect(resendBlockedLabel("already-emailed")).toBe("Emailed");
    expect(resendBlockedLabel("not-your-business")).toBe("Another business");
    expect(resendBlockedLabel("already-applied")).toBe("Credit already used");
    expect(resendBlockedLabel("reversed")).toBe("Credit voided");
  });
});
