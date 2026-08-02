// The WhatsApp payment-reminder message and its wa.me link.
//
// wa.me click-to-chat is the WHOLE delivery mechanism, deliberately: it is
// free, ToS-clean, and opens a pre-filled chat that the ADMIN sends by
// pressing Send — that press is WhatsApp's anti-spam boundary and nothing
// here tries to remove it (unofficial automation gets the coach's own number
// banned; one-click bulk is the Cloud API backlog item).
//
// The stored phone form is whatever the parent typed at registration —
// normalizeSgPhone reduces it to 8 bare digits when it can, and anything it
// can't becomes null, which the UI must surface as "no number", never a
// broken link (design RISK: visible degradation).

import { normalizeSgPhone } from "./sgPhone";

/** "6591234567" for wa.me, or null when the number can't carry a chat. */
export function toWaNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  const bare = normalizeSgPhone(input);
  return /^\d{8}$/.test(bare) ? `65${bare}` : null;
}

export interface ReminderMessageOpts {
  businessName: string;
  studentNames: string[];
  /** "YYYY-MM" as stored on the invoice. */
  billingMonth: string;
  amount: number;
  /** The tokenized public invoice page URL (carries the QR). */
  link: string;
  reference: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "July 2026" from "2026-07"; falls back to the raw string. */
export function monthLabel(billingMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(billingMonth);
  if (!m) return billingMonth;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : billingMonth;
}

/** The fixed template (user-approved 2026-08-02). Per-tenant editable
 *  templates are a deliberate non-feature until a tenant asks. */
export function buildReminderMessage(opts: ReminderMessageOpts): string {
  const children =
    opts.studentNames.length > 0 ? opts.studentNames.join(", ") : "your child";
  return (
    `Hi! This is a payment reminder from ${opts.businessName}.\n\n` +
    `Invoice for ${children} — ${monthLabel(opts.billingMonth)}: ` +
    `$${opts.amount.toFixed(2)} (ref ${opts.reference}).\n\n` +
    `You can view the invoice and pay by PayNow here:\n${opts.link}\n\n` +
    `Thank you!`
  );
}

/** https://wa.me/<number>?text=<encoded>. Caller guarantees number came from
 *  toWaNumber — this never builds a link to an unvetted number. */
export function buildWaLink(waNumber: string, message: string): string {
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
}
