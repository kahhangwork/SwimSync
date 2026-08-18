// Whether the admin may VOID a credit note, and what to warn before they do.
//
// Plan: docs/plans/CREDIT_NOTE_AND_MARKABLE_FLOOR_PLAN.md (Item 3).
//
// Pure, so the gating is testable away from the page. The SERVER is the authority
// — void_credit_note() re-checks is_tenant_admin and refuses an already-reversed
// note on its own — so this exists to hide a button that cannot work, not to
// enforce anything. It mirrors creditNoteEmailState's authority rule TERM FOR
// TERM: only a TENANT admin of the note's OWN business may void it. The page's
// select is unfiltered and leans on RLS, which hands a platform admin every
// tenant's rows; can_admin_tenant() would let admin.swimsync.sg void another
// business's note, so the gate is is_tenant_admin specifically.

export type CreditNoteVoidBlockedReason =
  /** Already reversed — there is nothing left to void. */
  | "reversed"
  /** Not a tenant admin of this note's business. */
  | "not-your-business";

export type CreditNoteVoidView = {
  /** Render the Void action? */
  canVoid: boolean;
  /** The note has LIVE draws, so voiding reopens invoice(s) — the confirm must
   *  name the consequence. Meaningful only when canVoid is true. */
  isDrawn: boolean;
  /** Why not. null exactly when canVoid is true. */
  blockedReason: CreditNoteVoidBlockedReason | null;
};

export function creditNoteVoidView(
  note: {
    status: string;
    /** True if the note has at least one LIVE (non-reversed) credit_applications
     *  row — the page computes this from the embed, counting reversed_at IS NULL. */
    hasLiveApplications: boolean;
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
): CreditNoteVoidView {
  // An already-voided note has nothing to void — decide first, before authority,
  // so every viewer sees a consistent "Voided" rather than a permission hint.
  if (note.status === "reversed") {
    return { canVoid: false, isDrawn: false, blockedReason: "reversed" };
  }

  // Authority, mirroring creditNoteEmailState (is_tenant_admin term for term):
  // role === 'tenant_admin' excludes both the platform admin ('platform_admin')
  // and a coach with a matching tenant_id; a disabled admin is refused server-side.
  const isTenantAdminOfNote =
    viewer.role === "tenant_admin" &&
    !viewer.adminDisabled &&
    viewer.tenantId !== null &&
    viewer.tenantId === note.tenantId;
  if (!isTenantAdminOfNote) {
    return { canVoid: false, isDrawn: false, blockedReason: "not-your-business" };
  }

  return { canVoid: true, isDrawn: note.hasLiveApplications, blockedReason: null };
}

/** The confirm-dialog body for a void. A DRAWN note names the money it claws back
 *  (the invoice(s) go outstanding again); an undrawn note just removes the credit. */
export function voidConfirmMessage(
  isDrawn: boolean,
  amount: number,
  reference: string,
): string {
  const amt = `S$${amount.toFixed(2)}`;
  if (isDrawn) {
    return (
      `Void ${reference}? This removes ${amt} of credit that was already applied to ` +
      `an invoice, which becomes OUTSTANDING again — the parent will owe it. This cannot ` +
      `be undone; the parent is not emailed automatically, so tell them yourself.`
    );
  }
  return (
    `Void ${reference}? This removes ${amt} of unused credit from the parent's balance. ` +
    `This cannot be undone.`
  );
}
