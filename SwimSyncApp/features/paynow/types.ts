// The parent PayNow screen's entity types (docs/refactor/BATCH_FGH_PLAN.md, App L-G) —
// moved verbatim from app/(parent)/billing/paynow.tsx.

/** The business being paid. Named for what it IS: the QR belongs to the
 *  BUSINESS, not the coach who taught the lesson (PRD §7.10). It used to be
 *  called coach_name, which then had to be apologised for in the UI copy. */
export type Payee = {
  business_name: string | null;
  paynow_qr_url: string | null;
};

export type PayeeTenant = {
  display_name: string | null;
  paynow_qr_url: string | null;
  paynow_uen: string | null;
  paynow_mobile: string | null;
};
