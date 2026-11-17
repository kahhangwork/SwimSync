// The invoice-email TEMPLATES — formatting, subjects, HTML, the outcome mapping,
// the idempotency key and the blocked-notice builders — moved verbatim out of
// email.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B10). Pure: no client, no network,
// no clock. Template literals are EMAIL CONTENT — never re-indent them.

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sept", "Oct", "Nov", "Dec",
];

export const DEFAULT_FROM = "SwimSync <noreply@swimsync.sg>";
export const DEFAULT_APP_URL = "https://swimsync.sg";

export type InvoiceEmailItem = {
  studentName: string;
  sessionDate: string; // YYYY-MM-DD
  classTitle: string;
  amount: number;
};

export type InvoiceEmailData = {
  parentName: string;
  /** The BUSINESS the invoice is from. A parent pays their coach or school, not
   *  SwimSync — an email headed "SwimSync" reads as a platform bill and is
   *  actively confusing for a family with children at two businesses. */
  businessName?: string;
  logoUrl?: string | null;
  billingMonth: string; // YYYY-MM
  gross: number;
  /** Prepaid package value applied. net = gross − package − credit + balanceAdjustment. */
  packageApplied?: number;
  credit: number;
  /** A prior-period DEBIT (a voided-then-paid credit) folded onto this invoice —
   *  it ADDS to what's owed, so it renders with a + sign. */
  balanceAdjustment?: number;
  net: number;
  /** "YYYY-MM-DD" — the stored invoices.due_date. Printed only when there is
   *  something to pay ("Please pay by …"); never computed here. */
  dueDate: string;
  items: InvoiceEmailItem[];
  appUrl?: string;
};

export type SendOutcome =
  /** Resend answered 2xx. */
  | "ok"
  /** No API key configured (local dev / tests). Nothing left our side. */
  | "no_api_key"
  /** No recipient address. Nothing left our side. */
  | "no_recipient"
  /** Resend answered a 4xx other than the two idempotency 409s — it refused. */
  | "rejected"
  /** 409 invalid_idempotent_request: this key was ALREADY accepted with a
   *  different payload (e.g. a child renamed since — ⚠ RISK 7). It went out. */
  | "key_reused"
  /** 409 concurrent_idempotent_requests: another request with this key is in
   *  flight right now. Its outcome is unknown. */
  | "key_in_flight"
  /** Resend answered 5xx. May or may not have been accepted. */
  | "server_error"
  /** fetch threw (timeout, DNS, socket). May ALREADY have been delivered. */
  | "threw";

export type SendResult = { sent: boolean; outcome: SendOutcome; reason?: string };

/** What to do with a claim once its send has an outcome. */
export type SettleAction =
  /** Stamp sent_at and clear the claim. */
  | "sent"
  /** Clear the claim — provably nothing was delivered; retryable at once. */
  | "release"
  /** Leave the claim. Outcome unknown: the lease expires in 15 minutes and the
   *  retry reuses the SAME Idempotency-Key, so Resend dedups it. */
  | "keep";

// The settle table (plan §3.2). Every outcome decided explicitly — no default.
export function settleActionFor(outcome: SendOutcome): SettleAction {
  switch (outcome) {
    case "ok":
    case "key_reused":
      return "sent";
    case "no_api_key":
    case "no_recipient":
    case "rejected":
      return "release";
    case "key_in_flight":
    case "server_error":
    case "threw":
      return "keep";
  }
}

/** A non-2xx Resend answer → typed outcome. The two 409s are told apart by
 *  the error `name` in the body (resend.com/docs/dashboard/emails/idempotency-keys). */
export function outcomeForStatus(status: number, body: string): SendOutcome {
  if (status >= 500) return "server_error";
  if (status === 409) {
    let name: unknown = null;
    try {
      name = (JSON.parse(body) as { name?: unknown })?.name;
    } catch {
      // not JSON — an ordinary refusal
    }
    if (name === "invalid_idempotent_request") return "key_reused";
    if (name === "concurrent_idempotent_requests") return "key_in_flight";
  }
  return "rejected";
}

/**
 * The Resend Idempotency-Key for one invoice email — ONE key per invoice, for
 * every attempt. Resend delivers at most one email per key within 24 hours, and
 * the automatic retry only ever runs inside that window, so it cannot duplicate.
 *
 * A human resend of a MAY_HAVE_SENT email uses the SAME key, deliberately
 * (decided with the user 2026-09-27, superseding plan §2's "new key"):
 * MAY_HAVE_SENT means the claim is > 24 h old, so the key has already lapsed and
 * Resend sends it fresh — the human gets a real resend. A new key would open a
 * second duplicate path: if that resend's outcome is ALSO unknown, the row turns
 * RETRYABLE and the automatic retry would resend under the normal (lapsed) key.
 * With one key, that retry dedups against the human's send instead.
 */
export function invoiceIdempotencyKey(invoiceId: string): string {
  return `invoice/${invoiceId}`;
}

// "2026-07" → "July 2026". Falls back to the raw string if malformed.
export function formatBillingMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const month = MONTHS_LONG[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : ym;
}

// "2026-07-12" → "12 Jul 2026". No Date object → no timezone drift.
export function formatSessionDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const month = MONTHS_SHORT[Number(m[2]) - 1];
  if (!month) return dateStr;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

export function money(n: number): string {
  return `S$${Number(n).toFixed(2)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInvoiceEmailSubject(data: InvoiceEmailData): string {
  const from = data.businessName?.trim();
  return from
    ? `Your ${from} invoice for ${formatBillingMonth(data.billingMonth)}`
    : `Your SwimSync invoice for ${formatBillingMonth(data.billingMonth)}`;
}

// DESIGN.md, inline: email clients strip <style> and never load Geist, so the
// family always ends in a system fallback. Ground page, flat white card with a
// 1px border, the tenant's name in Ink (never a SwimSync colour band), money in
// Ink with tabular figures, one Lane Blue button.
const FONT = "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const LABEL_TD = "padding:6px 0;font-size:13px;color:#525252;text-align:right;";
const MONEY_TD = "padding:6px 0;font-size:13px;color:#0a0a0a;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;";

export function buildInvoiceEmailHtml(data: InvoiceEmailData): string {
  const appUrl = data.appUrl ?? DEFAULT_APP_URL;
  const monthLabel = formatBillingMonth(data.billingMonth);
  const fullyCovered = data.net === 0;

  const rows = [...data.items]
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
    .map(
      (i) => `
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#525252;border-bottom:1px solid #f0f0f0;white-space:nowrap;">${escapeHtml(
                  formatSessionDate(i.sessionDate)
                )}</td>
                <td style="padding:8px 12px;font-size:13px;color:#0a0a0a;border-bottom:1px solid #f0f0f0;">${escapeHtml(
                  i.classTitle
                )}<span style="color:#6b6b6b;"> · ${escapeHtml(
        i.studentName
      )}</span></td>
                <td style="padding:8px 0;font-size:13px;color:#0a0a0a;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${escapeHtml(
                  money(i.amount)
                )}</td>
              </tr>`
    )
    .join("");

  const packageRow =
    (data.packageApplied ?? 0) > 0
      ? `
              <tr>
                <td colspan="2" style="${LABEL_TD}">Package applied</td>
                <td style="${MONEY_TD}">−${escapeHtml(
                  money(data.packageApplied ?? 0)
                )}</td>
              </tr>`
      : "";

  const creditRow =
    data.credit > 0
      ? `
              <tr>
                <td colspan="2" style="${LABEL_TD}">Credit applied</td>
                <td style="${MONEY_TD}">−${escapeHtml(
                  money(data.credit)
                )}</td>
              </tr>`
      : "";

  // A prior-period DEBIT ADDS to what's owed (voided-then-paid credit, 20260822000100).
  const adjustmentRow =
    (data.balanceAdjustment ?? 0) > 0
      ? `
              <tr>
                <td colspan="2" style="${LABEL_TD}">Adjustment from a prior invoice</td>
                <td style="${MONEY_TD}">+${escapeHtml(
                  money(data.balanceAdjustment ?? 0)
                )}</td>
              </tr>`
      : "";

  const coveredBy =
    (data.packageApplied ?? 0) > 0 && data.credit > 0
      ? "your lesson package and credit balance"
      : (data.packageApplied ?? 0) > 0
        ? "your lesson package"
        : "your credit balance";
  const payBlock = fullyCovered
    ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#525252;">
              This invoice is <strong style="color:#0a0a0a;">fully covered by ${coveredBy}</strong> — there's nothing to pay. You can view the details in the app.
            </p>`
    : `<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#525252;">
              Please pay by <strong style="color:#0a0a0a;">${escapeHtml(
                formatSessionDate(data.dueDate)
              )}</strong>. Pay via the coach's PayNow QR code shown in the app, then the coach will mark it as paid.
            </p>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;padding:32px 0;font-family:${FONT};">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;">
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #f0f0f0;">
            ${
              data.logoUrl
                ? `<img src="${escapeHtml(data.logoUrl)}" alt="${escapeHtml(
                    data.businessName ?? "Logo"
                  )}" height="28" style="height:28px;vertical-align:middle;border:0;" />`
                : `<span style="color:#0a0a0a;font-size:16px;font-weight:600;">${escapeHtml(
                    data.businessName ?? "SwimSync"
                  )}</span>`
            }
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 12px;font-size:24px;font-weight:600;line-height:1.2;letter-spacing:-0.02em;color:#0a0a0a;">Your invoice for ${escapeHtml(
              monthLabel
            )} is ready</h1>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#525252;">
              Hi ${escapeHtml(
                data.parentName
              )}, here's your ${escapeHtml(
                data.businessName ?? "SwimSync"
              )} invoice for <strong style="color:#0a0a0a;">${escapeHtml(
    monthLabel
  )}</strong>.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;">
              ${rows}
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td colspan="2" style="padding:10px 0 6px;font-size:13px;color:#525252;text-align:right;">Subtotal</td>
                <td style="padding:10px 0 6px;font-size:13px;color:#0a0a0a;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${escapeHtml(
                  money(data.gross)
                )}</td>
              </tr>${packageRow}${creditRow}${adjustmentRow}
              <tr>
                <td colspan="2" style="padding:8px 0;font-size:16px;font-weight:600;color:#0a0a0a;text-align:right;border-top:1px solid #e5e5e5;">Amount due</td>
                <td style="padding:8px 0;font-size:16px;font-weight:600;color:#0a0a0a;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;border-top:1px solid #e5e5e5;">${escapeHtml(
    money(data.net)
  )}</td>
              </tr>
            </table>
            ${payBlock}
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 8px;">
              <tr>
                <td style="border-radius:6px;background:#2563eb;">
                  <a href="${escapeHtml(appUrl)}"
                     style="display:inline-block;padding:12px 16px;font-size:14px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:6px;">
                    View invoice in the app
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f0f0f0;">
            <!-- SwimSync stays in the FOOTER only: the platform is the sender
                 of record, but the bill is the business's. -->
            <p style="margin:0;font-size:12px;color:#6b6b6b;">${escapeHtml(
              data.businessName ?? "SwimSync"
            )} · sent via SwimSync</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// ── Blocked-generation alert ───────────────────────────────────────────────
// When an automatic run refuses because attendance is unmarked, nobody finds
// out unless someone opens the admin panel — the run is silent by design. This
// tells the coach (and the superadmin) what to mark.
//
// THROTTLED: the cron runs daily, so a naive send would email every day until
// it is fixed, which trains the recipient to filter it. State lives in
// app_settings under a per-month key, so no schema change is needed.

// BLOCKED_NOTICE_KEY ("invoice_block_notified"): constants.ts (B3).

export type BlockingLessonSummary = {
  class_title: string;
  session_date: string;
  unmarked_student_count: number;
};

export function buildBlockedEmailHtml(
  billingMonth: string,
  blocking: BlockingLessonSummary[]
): string {
  const rows = blocking
    .map(
      (b) =>
        `<li style="margin:0 0 6px"><strong>${escapeHtml(b.class_title)}</strong> — ${escapeHtml(
          formatSessionDate(b.session_date)
        )} <span style="color:#b91c1c">(${b.unmarked_student_count} student${
          b.unmarked_student_count === 1 ? "" : "s"
        })</span></li>`
    )
    .join("");

  return `<!doctype html><html><body style="margin:0;font-family:${FONT};background:#fafafa;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;padding:24px">
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;line-height:1.3;color:#0a0a0a">Invoices for ${escapeHtml(
      formatBillingMonth(billingMonth)
    )} could not be generated</h2>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#525252">
      Some lessons still have no attendance marked. Nothing has been billed.
      Mark these in the app — or mark them <strong style="color:#0a0a0a">cancelled</strong> if the
      lesson did not run — and invoicing will continue automatically.
    </p>
    <ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.5;color:#0a0a0a">${rows}</ul>
    <p style="margin:0;font-size:12px;color:#6b6b6b">
      You will not get this reminder again until the outstanding lessons change.
    </p>
  </div></body></html>`;
}

export type BlockedNoticeCandidate = {
  id: string;
  email: string | null;
  role: string;
  tenant_id: string | null;
  admin_role_id: string | null;
};

/**
 * Who hears that billing is blocked (X4, decided with the user 2026-09-27):
 * coaches (they must mark), the platform admin (the fallback), the business
 * OWNER, and co-admins whose role holds operations:edit — the people who can
 * fix the marking. A co-admin who can do neither drops off. Pure: the caller
 * fetches owners and the operations:edit role ids.
 */
export function blockedNoticeRecipients(
  candidates: BlockedNoticeCandidate[],
  ownerIds: Set<string>,
  opsEditRoleIds: Set<string>,
): BlockedNoticeCandidate[] {
  return candidates.filter((c) => {
    if (!c.email) return false;
    if (c.role === "coach" || c.role === "platform_admin") return true;
    if (c.role !== "tenant_admin") return false;
    return ownerIds.has(c.id) ||
      (c.admin_role_id !== null && opsEditRoleIds.has(c.admin_role_id));
  });
}
