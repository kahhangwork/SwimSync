// Invoice emails that "may not have arrived" — the Billing months card's count
// and list (docs/plans/CRASH_SAFE_EMAIL_CLAIM_PLAN.md §2, §3.3).
//
// An invoice lands here when its email was claimed more than 24 hours ago with
// no known outcome (MAY_HAVE_SENT — the sender crashed, timed out or got a 5xx).
// The automatic retry never touches it: Resend's 24-hour idempotency window has
// lapsed, so a retry could send a parent a second copy. A human decides instead,
// and the resend goes out under a new key. The state is computed in SQL; this
// file only shapes and labels it.

export type UndeliveredEmail = {
  invoiceId: string;
  billingMonth: string;
  reference: string | null;
  parentName: string;
  /** timestamptz — display only, via formatSgStamp. Never compared to a clock. */
  claimedAt: string;
};

/** One fetchMayNotHaveArrived row → the list's entry. */
export function toUndeliveredEmail(row: any): UndeliveredEmail {
  const parent = Array.isArray(row.parents) ? row.parents[0] : row.parents;
  const profile = Array.isArray(parent?.profiles) ? parent.profiles[0] : parent?.profiles;
  return {
    invoiceId: row.id,
    billingMonth: row.billing_month,
    reference: row.reference_number ?? null,
    parentName: profile?.full_name ?? "—",
    claimedAt: row.invoice_email_claimed_at,
  };
}

/** Entries keyed by billing month, input order kept within a month. */
export function groupByMonth(list: UndeliveredEmail[]): Map<string, UndeliveredEmail[]> {
  const out = new Map<string, UndeliveredEmail[]>();
  for (const e of list) {
    const bucket = out.get(e.billingMonth);
    if (bucket) bucket.push(e);
    else out.set(e.billingMonth, [e]);
  }
  return out;
}

/** "1 invoice email may not have arrived" / "3 invoice emails may not have arrived". */
export function mayNotHaveArrivedLabel(n: number): string {
  return `${n} invoice email${n === 1 ? "" : "s"} may not have arrived`;
}

/** Human copy for the reasons a resend can come back unsent. */
export function resendInvoiceReasonLabel(reason: string): string {
  switch (reason) {
    case "sending":
      return "Already being sent — check again in a few minutes.";
    case "tenant suspended":
      return "This business is suspended, so no email was sent.";
    case "no_recipient":
      return "This parent has no email address.";
    case "no_api_key":
      return "Email is not configured on the server.";
    case "rejected":
      return "The email service refused it.";
    case "server_error":
    case "threw":
    case "key_in_flight":
      return "The email service did not confirm it. It may still arrive — check again later.";
    default:
      return `Not sent (${reason}).`;
  }
}
