// What the Credit Notes page shows for one note's email delivery.
//
// Plan: docs/plans/CREDIT_NOTE_EMAIL_PLAN.md (⚠ RISK 2, ⚠ RISK 4).
//
// Pure so the two guards that matter are testable away from the page. The SERVER is
// the authority for both — credit-note-emails/index.ts refuses on its own — so this
// exists to stop the admin pressing a button that cannot work, not to enforce
// anything. A UI-only check would be a hole; a server-only check would be a button
// that fails for reasons the admin cannot see.

export type ResendBlockedReason =
  /** Already emailed. Nothing to do — and pressing again must never re-send. */
  | "already-emailed"
  /**
   * ⚠ RISK 4 — the viewer is not a TENANT admin of this note's business.
   * The page's select is UNFILTERED and leans on RLS, which hands a platform admin
   * every tenant's rows. can_admin_tenant() is `is_platform_admin() OR
   * is_tenant_admin(...)`, so using it as the gate would let the operator on
   * admin.swimsync.sg send mail `From: <someone else's business>` to that
   * business's parents. The server requires is_tenant_admin specifically; this
   * mirrors it so the button is simply absent rather than a 403.
   */
  | "not-your-business"
  /**
   * ⚠ RISK 2 — the credit has been spent, in whole or in part, so the email's
   * "applied automatically to your next invoice" line would be false and its
   * balance figure meaningless. Note `status` alone does NOT detect this: the
   * engine leaves status 'available' while a note is PARTLY drawn down
   * (core.ts:1437-1445), which is why hasApplications is a separate input.
   */
  | "already-applied";

export type CreditNoteEmailView = {
  /** Show a "Not emailed" pill? False once it has been sent. */
  showNotEmailed: boolean;
  /** Render the Resend button? */
  canResend: boolean;
  /** Why not. null exactly when canResend is true. */
  blockedReason: ResendBlockedReason | null;
};

export function creditNoteEmailView(
  note: {
    emailSentAt: string | null;
    status: string;
    appliedToInvoiceId: string | null;
    /** True if ANY credit_applications row exists for this note. */
    hasApplications: boolean;
    tenantId: string;
  },
  viewer: {
    /** profiles.role — mirrored from is_tenant_admin, which requires 'tenant_admin'. */
    role: string | null;
    /** The viewer's OWN profile tenant_id — never a value from the row. */
    tenantId: string | null;
    /** profiles.admin_disabled_at !== null — a disabled admin is refused server-side. */
    adminDisabled: boolean;
  },
): CreditNoteEmailView {
  if (note.emailSentAt !== null) {
    return { showNotEmailed: false, canResend: false, blockedReason: "already-emailed" };
  }

  // Order matters: authority is decided before state. A platform admin must not
  // learn "this one is resendable" about a business they do not administer, and the
  // reason they see should be about permission, not about the note.
  //
  // MIRRORS is_tenant_admin() TERM FOR TERM, which is:
  //   p_tenant_id IS NOT NULL
  //     AND NOT tenant_suspended(p_tenant_id)
  //     AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
  //                   AND role = 'tenant_admin' AND tenant_id = p_tenant_id
  //                   AND admin_disabled_at IS NULL)
  // An earlier version compared tenant ids only, so a COACH profile with a matching
  // tenant_id, or a DISABLED admin, got a live button that then 403'd — and because
  // `data` is null on a non-2xx the admin saw "Edge Function returned a non-2xx
  // status code" instead of anything useful. `role = 'tenant_admin'` also excludes
  // the platform admin, whose role is 'platform_admin', so no separate check is
  // needed for them. Tenant suspension is NOT mirrored here (the page does not load
  // it); the server refuses, which is the boundary that matters.
  const isTenantAdminOfNote =
    viewer.role === "tenant_admin" &&
    !viewer.adminDisabled &&
    viewer.tenantId !== null &&
    viewer.tenantId === note.tenantId;
  if (!isTenantAdminOfNote) {
    return { showNotEmailed: true, canResend: false, blockedReason: "not-your-business" };
  }

  if (note.appliedToInvoiceId !== null || note.status !== "available" || note.hasApplications) {
    return { showNotEmailed: true, canResend: false, blockedReason: "already-applied" };
  }

  return { showNotEmailed: true, canResend: true, blockedReason: null };
}

/** Copy for the inline hint beside a blocked note. */
export function resendBlockedLabel(reason: ResendBlockedReason): string {
  switch (reason) {
    case "already-emailed":
      return "Emailed";
    case "not-your-business":
      return "Another business";
    case "already-applied":
      return "Credit already used";
  }
}
