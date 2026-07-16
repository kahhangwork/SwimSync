// Transactional invoice email for generate-invoices.
//
// Kept OUT of core.ts (the billing engine, which stays pure + unit-tested):
// index.ts calls sendInvoiceEmail() for each invoice core.ts reports creating.
// There is no other transactional-email path in the project today — password
// reset uses Supabase Auth's built-in SMTP, which only fires on auth events.
// This talks to the Resend HTTP API directly with the same key that backs the
// SMTP sender.
//
// Design notes:
//  • The API key is passed IN (not read from Deno.env here) so the builders and
//    sender are testable without touching the environment.
//  • sendInvoiceEmail NEVER throws — a delivery failure must not disturb invoice
//    generation. It returns { sent, reason } and the caller logs it.
//  • Dates are formatted from the stored YYYY-MM-DD string WITHOUT constructing a
//    Date (no UTC drift — the same discipline the apps use for SG-local dates).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CreatedInvoice } from "./core.ts";

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DEFAULT_FROM = "SwimSync <noreply@swimsync.sg>";
const DEFAULT_APP_URL = "https://swimsync.sg";

export type InvoiceEmailItem = {
  studentName: string;
  sessionDate: string; // YYYY-MM-DD
  classTitle: string;
  amount: number;
};

export type InvoiceEmailData = {
  parentName: string;
  billingMonth: string; // YYYY-MM
  gross: number;
  credit: number;
  net: number;
  items: InvoiceEmailItem[];
  appUrl?: string;
};

export type SendResult = { sent: boolean; reason?: string };

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
  return `Your SwimSync invoice for ${formatBillingMonth(data.billingMonth)}`;
}

// Branded HTML matching supabase/templates/recovery.html (sky header, white
// card, inline CSS, no external assets — email clients strip <style>/remote).
export function buildInvoiceEmailHtml(data: InvoiceEmailData): string {
  const appUrl = data.appUrl ?? DEFAULT_APP_URL;
  const monthLabel = formatBillingMonth(data.billingMonth);
  const fullyCovered = data.net === 0;

  const rows = [...data.items]
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
    .map(
      (i) => `
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;white-space:nowrap;">${escapeHtml(
                  formatSessionDate(i.sessionDate)
                )}</td>
                <td style="padding:8px 12px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;">${escapeHtml(
                  i.classTitle
                )}<span style="color:#94a3b8;"> · ${escapeHtml(
        i.studentName
      )}</span></td>
                <td style="padding:8px 0;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;">${escapeHtml(
                  money(i.amount)
                )}</td>
              </tr>`
    )
    .join("");

  const creditRow =
    data.credit > 0
      ? `
              <tr>
                <td colspan="2" style="padding:6px 0;font-size:13px;color:#475569;text-align:right;">Credit applied</td>
                <td style="padding:6px 0;font-size:13px;color:#2563eb;text-align:right;white-space:nowrap;">−${escapeHtml(
                  money(data.credit)
                )}</td>
              </tr>`
      : "";

  const payBlock = fullyCovered
    ? `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#475569;">
              This invoice is <strong>fully covered by your credit balance</strong> — there's nothing to pay. You can view the details in the app.
            </p>`
    : `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569;">
              Pay via the coach's PayNow QR code shown in the app, then the coach will mark it as paid.
            </p>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:#0ea5e9;padding:24px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.3px;">SwimSync</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Your invoice for ${escapeHtml(
              monthLabel
            )} is ready</h1>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569;">
              Hi ${escapeHtml(
                data.parentName
              )}, here's your SwimSync invoice for <strong>${escapeHtml(
    monthLabel
  )}</strong>.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;">
              ${rows}
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
              <tr>
                <td colspan="2" style="padding:10px 0 6px;font-size:13px;color:#475569;text-align:right;">Subtotal</td>
                <td style="padding:10px 0 6px;font-size:13px;color:#0f172a;text-align:right;white-space:nowrap;">${escapeHtml(
                  money(data.gross)
                )}</td>
              </tr>${creditRow}
              <tr>
                <td colspan="2" style="padding:8px 0;font-size:16px;font-weight:700;color:#0f172a;text-align:right;border-top:2px solid #e2e8f0;">Amount due</td>
                <td style="padding:8px 0;font-size:16px;font-weight:700;color:${
                  fullyCovered ? "#16a34a" : "#dc2626"
                };text-align:right;white-space:nowrap;border-top:2px solid #e2e8f0;">${escapeHtml(
    money(data.net)
  )}</td>
              </tr>
            </table>
            ${payBlock}
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 8px;">
              <tr>
                <td style="border-radius:8px;background:#0ea5e9;">
                  <a href="${escapeHtml(appUrl)}"
                     style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                    View invoice in the app
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #eef2f6;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">SwimSync · Swim attendance &amp; billing</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// Send one invoice email via the Resend HTTP API. NEVER throws. Returns a
// no-op result when no API key is supplied (local dev / tests) so nothing is
// sent and generation is unaffected.
export async function sendInvoiceEmail(
  opts: InvoiceEmailData & {
    apiKey: string | undefined;
    to: string | null | undefined;
    from?: string;
  }
): Promise<SendResult> {
  if (!opts.apiKey) return { sent: false, reason: "no_api_key" };
  if (!opts.to) return { sent: false, reason: "no_recipient" };

  const subject = buildInvoiceEmailSubject(opts);
  const html = buildInvoiceEmailHtml(opts);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: opts.from ?? DEFAULT_FROM,
        to: opts.to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: `resend_${res.status}: ${body.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: `fetch_error: ${(e as Error).message}` };
  }
}

// Orchestrate emails for a batch of just-created invoices. Called by index.ts
// AFTER generation has committed, so nothing here can affect billing. Resolves
// each parent's email/name and student names, then sends one email per invoice.
// NEVER throws — any failure is logged and swallowed; returns how many sent.
// A no-op (returns 0) when there are no invoices or no apiKey.
export async function emailCreatedInvoices(
  supabase: SupabaseClient,
  created: CreatedInvoice[],
  opts: { apiKey?: string; appUrl?: string } = {}
): Promise<{ emailsSent: number }> {
  if (!created.length) return { emailsSent: 0 };
  const appUrl = opts.appUrl ?? DEFAULT_APP_URL;
  let emailsSent = 0;

  try {
    const parentIds = [...new Set(created.map((c) => c.parent_id))];
    const studentIds = [
      ...new Set(created.flatMap((c) => c.items.map((i) => i.student_id))),
    ];

    // parent_id → { email, name } (profiles is a to-one embed)
    const { data: parentRows } = await supabase
      .from("parents")
      .select("id, profiles(email, full_name)")
      .in("id", parentIds);
    const parentInfo: Record<string, { email: string | null; name: string }> = {};
    for (const row of (parentRows ?? []) as any[]) {
      const prof = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      parentInfo[row.id] = {
        email: prof?.email ?? null,
        name: prof?.full_name ?? "there",
      };
    }

    // student_id → full_name (for itemised lines)
    const { data: studentRows } = await supabase
      .from("students")
      .select("id, full_name")
      .in("id", studentIds);
    const studentName: Record<string, string> = {};
    for (const row of (studentRows ?? []) as any[]) {
      studentName[row.id] = row.full_name ?? "";
    }

    for (const inv of created) {
      const info = parentInfo[inv.parent_id];
      const r = await sendInvoiceEmail({
        apiKey: opts.apiKey,
        to: info?.email,
        parentName: info?.name ?? "there",
        billingMonth: inv.billing_month,
        gross: inv.gross,
        credit: inv.credit,
        net: inv.net,
        appUrl,
        items: inv.items.map((i) => ({
          studentName: studentName[i.student_id] ?? "",
          sessionDate: i.session_date,
          classTitle: i.class_title,
          amount: i.amount,
        })),
      });
      if (r.sent) emailsSent++;
      else console.log(`invoice email not sent (${inv.invoice_id}): ${r.reason}`);
    }
  } catch (e) {
    // Never let the email step fail the caller — invoices are already committed.
    console.log(`invoice email step error: ${(e as Error).message}`);
  }

  return { emailsSent };
}
