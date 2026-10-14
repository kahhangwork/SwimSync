// Package purchase emails — pure builders + a thin Resend sender.
//
// Same rules as the invoice emails (generate-invoices/email.ts):
//   • Branded as the BUSINESS — a parent pays their coach or school, not
//     SwimSync, which appears only in the footer as the platform.
//   • A logged NO-OP when RESEND_API_KEY is unset, so local dev and tests
//     never send. Delivery is best-effort and never fails the caller.
//   • Builders are pure and unit-tested; all interpolated values are escaped.

import { dateInTimeZone } from "../generate-invoices/dates.ts";

export type PackageEmailData = {
  parentName: string;
  businessName: string;
  logoUrl?: string | null;
  packageName: string;
  lessonCount: number;
  ratePerLesson: number;
  totalValue: number;
  /** The discounted price to PAY (referral). Falls back to totalValue when the
   *  package carries no discount, so a non-referral email is unchanged. */
  amountPayable?: number;
  discountAmount?: number;
  /** confirmed only */
  expiresOn?: string | null;
  /** offered only — the admin-set start date and the tokenised pay link */
  startDate?: string | null;
  payUrl?: string | null;
};

/** What the family pays — the discounted price, or the full value if none. */
export function payable(d: PackageEmailData): number {
  return d.amountPayable ?? d.totalValue;
}

/** A "was S$X · Y off" line, or empty when there is no discount. */
function discountLine(d: PackageEmailData): string {
  if (!d.discountAmount || d.discountAmount <= 0) return "";
  return `<p style="margin:0 0 16px;font-size:13px;color:#525252;">
       Referral discount applied: ${escapeHtml(money(d.discountAmount))} off ${escapeHtml(money(d.totalValue))}.
     </p>`;
}

export type SendResult = { sent: boolean; reason?: string };

// ⚠ RISK 3 — the referral-reward email goes to the REFERRER and must carry NONE
// of the referee's package: no packageName / lessonCount / ratePerLesson /
// totalValue / payUrl. It describes only the discount the referrer has earned.
export type ReferralRewardEmailData = {
  businessName: string;
  logoUrl?: string | null;
  discountType: "percent" | "amount" | null;
  discountValue: number | null;
  expiresOn?: string | null;
};

export type EmailType = "requested" | "confirmed" | "offered" | "referral_reward";

/** The authorization decision, pulled out of the HTTP handler so the RISK 6
 *  matrix is unit-testable (the handler only gathers the inputs).
 *   • requested — the caller must BE the package's parent, pending.
 *   • confirmed — the caller's home tenant IS the package's, active.
 *   • offered   — the caller must ADMIN the package's tenant (can_admin_tenant,
 *     NOT mere membership: a coach shares the tenant_id), the row must be an
 *     admin OFFER (offered_by set) and still pending. RISK 6. */
export function authorizePackageEmail(
  type: EmailType,
  pkg: {
    status: string;
    offeredBy: string | null;
    parentProfileId: string | null;
    tenantId: string;
  },
  caller: {
    id: string;
    isAdminOfTenant: boolean;
    profileTenantId: string | null;
  },
): boolean {
  switch (type) {
    case "requested":
      return caller.id === pkg.parentProfileId && pkg.status === "pending";
    case "offered":
      return caller.isAdminOfTenant && !!pkg.offeredBy && pkg.status === "pending";
    case "confirmed":
      return caller.profileTenantId === pkg.tenantId && pkg.status === "active";
    case "referral_reward":
      // The caller must ADMIN the reward's tenant. No package status to check —
      // the reward is the subject, not a package (RISK 3).
      return caller.isAdminOfTenant;
  }
}

const DEFAULT_APP_URL = "https://swimsync.sg";

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

/**
 * A timestamptz → its Singapore calendar date ("YYYY-MM-DD"), or null if
 * unparseable. For referral_rewards.expires_at (now() + N days, any time of day).
 *
 * ⚠ §7.7: this was `String(expires_at).slice(0, 10)` — the UTC date, which is the
 * PREVIOUS day for an instant between 00:00 and 08:00 SGT (a reward granted in
 * that window). The admin's Referrals page shows the same value via
 * formatSgStamp (the SGT date), so the email said one day and the screen another.
 * Same conversion as the engine (generate-invoices/dates.ts).
 */
export function sgDateOfStamp(ts: string): string | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return dateInTimeZone(d, "Asia/Singapore");
}

// "2027-07-10" → "10 Jul 2027", no Date object → no timezone drift.
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sept", "Oct", "Nov", "Dec",
];
export function formatDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const month = MONTHS_SHORT[Number(m[2]) - 1];
  if (!month) return dateStr;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

function shell(businessName: string, logoUrl: string | null | undefined, body: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;padding:32px 0;font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;">
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #f0f0f0;">
            ${
              logoUrl
                ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(businessName)}" height="28" style="height:28px;vertical-align:middle;border:0;" />`
                : `<span style="color:#0a0a0a;font-size:16px;font-weight:600;">${escapeHtml(businessName)}</span>`
            }
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">${body}</td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #f0f0f0;">
            <p style="margin:0;font-size:12px;color:#6b6b6b;">Sent via SwimSync · <a href="${DEFAULT_APP_URL}" style="color:#6b6b6b;">swimsync.sg</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export function buildRequestedSubject(d: PackageEmailData): string {
  return `Your ${d.businessName} package request — pay ${money(payable(d))} by PayNow`;
}

export function buildRequestedHtml(d: PackageEmailData): string {
  return shell(
    d.businessName,
    d.logoUrl,
    `<h1 style="margin:0 0 12px;font-size:24px;font-weight:600;line-height:1.2;letter-spacing:-0.02em;color:#0a0a0a;">Almost there — pay by PayNow</h1>
     <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#525252;">
       Hi ${escapeHtml(d.parentName)}, you've requested
       <strong>${escapeHtml(d.packageName)}</strong> from
       ${escapeHtml(d.businessName)} — ${d.lessonCount} lessons at
       ${escapeHtml(money(d.ratePerLesson))} each.
     </p>
     <p style="margin:0 0 16px;font-size:24px;font-weight:600;color:#0a0a0a;font-variant-numeric:tabular-nums;">${escapeHtml(money(payable(d)))}</p>
     ${discountLine(d)}
     <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#525252;">
       Transfer the amount using the PayNow QR code shown in the SwimSync app
       (Billing &rarr; Packages). Your package activates once
       ${escapeHtml(d.businessName)} confirms the money has arrived — you'll
       get another email then.
     </p>`
  );
}

export function buildConfirmedSubject(d: PackageEmailData): string {
  return `Your ${d.businessName} package is active — ${d.lessonCount} lessons`;
}

export function buildConfirmedHtml(d: PackageEmailData): string {
  return shell(
    d.businessName,
    d.logoUrl,
    `<h1 style="margin:0 0 12px;font-size:24px;font-weight:600;line-height:1.2;letter-spacing:-0.02em;color:#0a0a0a;">Your package is active</h1>
     <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#525252;">
       Hi ${escapeHtml(d.parentName)}, ${escapeHtml(d.businessName)} has
       confirmed your payment. <strong>${escapeHtml(d.packageName)}</strong>
       is now active:
     </p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
       <tr>
         <td style="padding:6px 0;font-size:13px;color:#525252;">Lessons</td>
         <td style="padding:6px 0;font-size:13px;color:#0a0a0a;text-align:right;font-variant-numeric:tabular-nums;">${d.lessonCount} × ${escapeHtml(money(d.ratePerLesson))}</td>
       </tr>
       <tr>
         <td style="padding:6px 0;font-size:13px;color:#525252;">Value</td>
         <td style="padding:6px 0;font-size:13px;color:#0a0a0a;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(money(d.totalValue))}</td>
       </tr>
       ${
         d.discountAmount && d.discountAmount > 0
           ? `<tr>
         <td style="padding:6px 0;font-size:13px;color:#525252;">Referral discount</td>
         <td style="padding:6px 0;font-size:13px;color:#0a0a0a;text-align:right;font-variant-numeric:tabular-nums;">−${escapeHtml(money(d.discountAmount))}</td>
       </tr>
       <tr>
         <td style="padding:6px 0;font-size:13px;color:#525252;font-weight:600;">You paid</td>
         <td style="padding:6px 0;font-size:13px;color:#0a0a0a;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(money(payable(d)))}</td>
       </tr>`
           : ""
       }
       ${
         d.expiresOn
           ? `<tr>
         <td style="padding:6px 0;font-size:13px;color:#525252;">Valid until</td>
         <td style="padding:6px 0;font-size:13px;color:#0a0a0a;text-align:right;">${escapeHtml(formatDate(d.expiresOn))}</td>
       </tr>`
           : ""
       }
     </table>
     <p style="margin:0;font-size:14px;line-height:1.5;color:#525252;">
       Lessons now come out of your package automatically. You can watch the
       balance any time in the app under Billing &rarr; Packages.
     </p>`
  );
}

export function buildOfferedSubject(d: PackageEmailData): string {
  return `Your next ${d.businessName} swim package is ready to pay`;
}

export function buildOfferedHtml(d: PackageEmailData): string {
  const payUrl = d.payUrl ?? DEFAULT_APP_URL;
  return shell(
    d.businessName,
    d.logoUrl,
    `<h1 style="margin:0 0 12px;font-size:24px;font-weight:600;line-height:1.2;letter-spacing:-0.02em;color:#0a0a0a;">Your next package is ready</h1>
     <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#525252;">
       Hi ${escapeHtml(d.parentName)}, ${escapeHtml(d.businessName)} has
       prepared your next package — <strong>${escapeHtml(d.packageName)}</strong>,
       ${d.lessonCount} lessons at ${escapeHtml(money(d.ratePerLesson))} each.
     </p>
     <p style="margin:0 0 16px;font-size:24px;font-weight:600;color:#0a0a0a;font-variant-numeric:tabular-nums;">${escapeHtml(money(payable(d)))}</p>
     ${discountLine(d)}
     ${
       d.startDate
         ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#525252;">
       Starts <strong>${escapeHtml(formatDate(d.startDate))}</strong>.
     </p>`
         : ""
     }
     <p style="margin:0 0 20px;">
       <a href="${escapeHtml(payUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:600;line-height:20px;text-decoration:none;padding:12px 16px;border-radius:6px;">Pay by PayNow</a>
     </p>
     <p style="margin:0;font-size:13px;line-height:1.5;color:#6b6b6b;">
       The page shows a PayNow QR with the amount and reference filled in. Your
       package activates once ${escapeHtml(d.businessName)} confirms the payment.
     </p>`
  );
}

/** "10% off" / "S$25.00 off" / a generic phrase when the tenant leans on
 *  per-product overrides and has no headline default. */
export function discountPhrase(
  type: "percent" | "amount" | null,
  value: number | null,
): string {
  if (type === "percent" && value != null) return `${value}% off`;
  if (type === "amount" && value != null) return `${money(value)} off`;
  return "a discount off";
}

export function buildReferralRewardSubject(d: ReferralRewardEmailData): string {
  return `You've earned ${discountPhrase(d.discountType, d.discountValue)} your next ${d.businessName} package`;
}

export function buildReferralRewardHtml(d: ReferralRewardEmailData): string {
  const phrase = discountPhrase(d.discountType, d.discountValue);
  return shell(
    d.businessName,
    d.logoUrl,
    `<h1 style="margin:0 0 12px;font-size:24px;font-weight:600;line-height:1.2;letter-spacing:-0.02em;color:#0a0a0a;">Thanks for the referral 🎉</h1>
     <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#525252;">
       Good news — a family you referred to ${escapeHtml(d.businessName)} has
       started their first package. As a thank-you, you've earned
       <strong>${escapeHtml(phrase)}</strong> your next package.
     </p>
     ${
       d.expiresOn
         ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#525252;">
       Use it by <strong>${escapeHtml(formatDate(d.expiresOn))}</strong>.
     </p>`
         : ""
     }
     <p style="margin:0;font-size:14px;line-height:1.5;color:#525252;">
       The discount is applied automatically to your next package —
       ${escapeHtml(d.businessName)} will sort it out when you renew.
     </p>`
  );
}

/** Send via the Resend HTTP API. Logged no-op without a key. */
export async function sendPackageEmail(opts: {
  apiKey: string | undefined;
  to: string | undefined;
  subject: string;
  html: string;
  fromName: string;
}): Promise<SendResult> {
  if (!opts.apiKey) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!opts.to) return { sent: false, reason: "no recipient" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${opts.fromName} <noreply@swimsync.sg>`,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      return { sent: false, reason: `resend ${res.status}: ${await res.text()}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: (e as Error).message };
  }
}
