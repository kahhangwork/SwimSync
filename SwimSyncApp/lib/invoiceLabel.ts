// What an invoice is CALLED, everywhere the parent can see it.
//
// Since payment collection shipped (PRD §7.21) every invoice carries a
// per-tenant `INV-YYYY-NNNN` reference, minted by a BEFORE INSERT trigger. That
// reference is what the dynamic PayNow QR locks in, what the WhatsApp reminder
// quotes, what the public invoice page prints, and what therefore appears on
// the parent's bank statement.
//
// The parent app was showing `id.slice(0, 8).toUpperCase()` — a fragment of the
// row's UUID — so a parent comparing the app against their own payment saw two
// completely different invoice numbers for the same invoice. This function is
// the single answer to "what is this invoice called", shared by the list and
// the detail screen so the two cannot drift.

/** Just the fields this needs — so any invoice shape can be passed. */
export type InvoiceIdentity = {
  id: string;
  reference_number?: string | null;
};

/**
 * The reference if there is one, otherwise the legacy UUID fragment.
 *
 * ⚠ THE FALLBACK IS NOT DEAD CODE. `reference_number` is NOT NULL going
 * forward, but rows written before the trigger existed have none, and seed and
 * fixture data still do. Rendering an empty string where an invoice number
 * belongs is worse than rendering the old identifier: the parent gets a blank
 * where they expect something to quote. Degrade to the old label instead.
 */
export function invoiceLabel(invoice: InvoiceIdentity): string {
  const ref = invoice.reference_number?.trim();
  if (ref) return ref;
  return `Invoice #${invoice.id.slice(0, 8).toUpperCase()}`;
}
