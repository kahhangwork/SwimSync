// Transactional invoice email for generate-invoices.
//
// Kept OUT of core.ts (the billing engine, which stays pure + unit-tested):
// index.ts sends via emailCreatedInvoices() for each invoice core.ts reports
// creating, then runs retryUnsentInvoiceEmails() to re-send any earlier miss
// (both go through the private emailInvoices() helper + sendInvoiceEmail()).
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
import type { CreatedInvoice, CreatedInvoiceItem } from "./core.ts";

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
  /** The BUSINESS the invoice is from. A parent pays their coach or school, not
   *  SwimSync — an email headed "SwimSync" reads as a platform bill and is
   *  actively confusing for a family with children at two businesses. */
  businessName?: string;
  logoUrl?: string | null;
  billingMonth: string; // YYYY-MM
  gross: number;
  /** Prepaid package value applied. net = gross − package − credit. */
  packageApplied?: number;
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
  const from = data.businessName?.trim();
  return from
    ? `Your ${from} invoice for ${formatBillingMonth(data.billingMonth)}`
    : `Your SwimSync invoice for ${formatBillingMonth(data.billingMonth)}`;
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

  const packageRow =
    (data.packageApplied ?? 0) > 0
      ? `
              <tr>
                <td colspan="2" style="padding:6px 0;font-size:13px;color:#475569;text-align:right;">Package applied</td>
                <td style="padding:6px 0;font-size:13px;color:#2563eb;text-align:right;white-space:nowrap;">−${escapeHtml(
                  money(data.packageApplied ?? 0)
                )}</td>
              </tr>`
      : "";

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

  const coveredBy =
    (data.packageApplied ?? 0) > 0 && data.credit > 0
      ? "your lesson package and credit balance"
      : (data.packageApplied ?? 0) > 0
        ? "your lesson package"
        : "your credit balance";
  const payBlock = fullyCovered
    ? `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#475569;">
              This invoice is <strong>fully covered by ${coveredBy}</strong> — there's nothing to pay. You can view the details in the app.
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
            ${
              data.logoUrl
                ? `<img src="${escapeHtml(data.logoUrl)}" alt="${escapeHtml(
                    data.businessName ?? "Logo"
                  )}" height="28" style="height:28px;vertical-align:middle;border:0;" />`
                : `<span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.3px;">${escapeHtml(
                    data.businessName ?? "SwimSync"
                  )}</span>`
            }
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
              )}, here's your ${escapeHtml(
                data.businessName ?? "SwimSync"
              )} invoice for <strong>${escapeHtml(
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
              </tr>${packageRow}${creditRow}
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
            <!-- SwimSync stays in the FOOTER only: the platform is the sender
                 of record, but the bill is the business's. -->
            <p style="margin:0;font-size:12px;color:#94a3b8;">${escapeHtml(
              data.businessName ?? "SwimSync"
            )} · sent via SwimSync</p>
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

// Per-invoice send outcome, so the caller can stamp (happy path) or reset
// (retry path) invoice_email_sent_at accordingly.
export type InvoiceSendResult = { invoiceId: string; sent: boolean };

// Send one email per invoice in the batch. PURE SEND — resolves recipients and
// branding, sends, and reports which invoices went out. Does NOT touch
// invoice_email_sent_at; stamping/claiming is the caller's concern (the happy
// path stamps on success, the retry path claims up-front and resets misses).
// NEVER throws — any failure is logged and swallowed. A no-op (0 sent, empty
// results) when there are no invoices; a no-op send when no apiKey.
//
// Student NAMES are resolved LIVE from students.full_name — NOT from the
// invoice_items.student_name snapshot — so first-send and retried emails render
// identically (⚠ RISK 7, INVOICE_EMAIL_RETRY_PLAN.md).
async function emailInvoices(
  supabase: SupabaseClient,
  invoices: CreatedInvoice[],
  opts: { apiKey?: string; appUrl?: string } = {}
): Promise<{ emailsSent: number; results: InvoiceSendResult[] }> {
  if (!invoices.length) return { emailsSent: 0, results: [] };
  const appUrl = opts.appUrl ?? DEFAULT_APP_URL;
  let emailsSent = 0;
  const results: InvoiceSendResult[] = [];

  try {
    const parentIds = [...new Set(invoices.map((c) => c.parent_id))];
    const studentIds = [
      ...new Set(invoices.flatMap((c) => c.items.map((i) => i.student_id))),
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

    // tenant_id → branding. One query for the whole run, not one per invoice.
    const tenantIds = [...new Set(invoices.map((c) => c.tenant_id).filter(Boolean))];
    const { data: tenantRows } = tenantIds.length
      ? await supabase
          .from("tenants")
          .select("id, display_name, logo_url")
          .in("id", tenantIds)
      : { data: [] as { id: string; display_name: string; logo_url: string | null }[] };
    const tenantInfo: Record<string, { name: string; logo: string | null }> = {};
    for (const row of (tenantRows ?? []) as any[]) {
      tenantInfo[row.id] = { name: row.display_name, logo: row.logo_url ?? null };
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

    for (const inv of invoices) {
      const info = parentInfo[inv.parent_id];
      const brand = tenantInfo[inv.tenant_id];
      const r = await sendInvoiceEmail({
        apiKey: opts.apiKey,
        to: info?.email,
        parentName: info?.name ?? "there",
        businessName: brand?.name,
        logoUrl: brand?.logo ?? null,
        billingMonth: inv.billing_month,
        gross: inv.gross,
        packageApplied: inv.package,
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
      results.push({ invoiceId: inv.invoice_id, sent: r.sent });
      if (r.sent) emailsSent++;
      else console.log(`invoice email not sent (${inv.invoice_id}): ${r.reason}`);
    }
  } catch (e) {
    // Never let the email step fail the caller — invoices are already committed.
    console.log(`invoice email step error: ${(e as Error).message}`);
  }

  return { emailsSent, results };
}

// Orchestrate emails for a batch of just-created invoices. Called by index.ts
// AFTER generation has committed, so nothing here can affect billing. Sends one
// email per invoice, then STAMPS invoice_email_sent_at on each success so a
// dropped send can be retried later without re-emailing the ones that worked.
// NEVER throws — any failure is logged and swallowed; returns how many sent.
export async function emailCreatedInvoices(
  supabase: SupabaseClient,
  created: CreatedInvoice[],
  opts: { apiKey?: string; appUrl?: string } = {}
): Promise<{ emailsSent: number }> {
  if (!created.length) return { emailsSent: 0 };
  const { emailsSent, results } = await emailInvoices(supabase, created, opts);

  const sentAt = new Date().toISOString();
  for (const r of results) {
    if (!r.sent) continue;
    // ⚠ RISK 4: a stamp failure must NOT drop the rest of the batch. Each stamp
    // is isolated — the sends already happened, so a stamp miss only means that
    // one invoice may be re-sent by a later retry (harmless), never a lost send.
    try {
      const { error } = await supabase
        .from("invoices")
        .update({ invoice_email_sent_at: sentAt })
        .eq("id", r.invoiceId);
      if (error) console.log(`invoice email stamp failed (${r.invoiceId}): ${error.message}`);
    } catch (e) {
      console.log(`invoice email stamp threw (${r.invoiceId}): ${(e as Error).message}`);
    }
  }

  return { emailsSent };
}

// Whether the retry pass should run for a per-tenant generation result.
// ⚠ RISK 3 (INVOICE_EMAIL_RETRY_PLAN.md): never email on behalf of a SUSPENDED
// tenant, and skip an AUTO-DISABLED tenant on an AUTOMATIC run (a manual run for
// that tenant is an explicit instruction and may proceed). Pure so it is unit-
// tested directly, away from the Deno.serve handler.
export function shouldRetryTenantEmails(
  status: string | undefined,
  isManual: boolean
): boolean {
  if (status === "tenant_suspended") return false;
  if (status === "auto_disabled" && !isManual) return false;
  return true;
}

// Retry unsent invoice emails for ONE (tenant, month) — the self-heal path.
// Runs on every generate-invoices invocation, INCLUDING a sealed-month
// short-circuit, so a send Resend rejected on an earlier run is re-sent on the
// next run with no duplicate to parents who already got theirs.
//
// ⚠ RISK 1 — CLAIM ONE INVOICE AT A TIME, then send it, then reset it on
// failure. Each claim is an atomic conditional UPDATE (`WHERE id = ? AND
// invoice_email_sent_at IS NULL RETURNING id`): a concurrent run (double-clicked
// button, or cron overlapping a manual run) racing for the same row gets zero
// rows back and skips it, so no duplicate is ever sent. Claiming per-invoice
// rather than the whole batch up-front BOUNDS a mid-run crash/timeout to a
// SINGLE in-flight invoice — a batch claim would strand the entire unsent tail
// stamped-as-sent (a silent, permanent drop). The residual one-invoice window
// is the cost of a boolean claim column; eliminating it entirely needs a
// separate claimed_at column or an advisory lock (BACKLOG).
//
// ⚠ RISK 2/#2 — the itemised lines are rebuilt from invoice_items. If that fetch
// errors we send NOTHING (a line-item-less email would still stamp sent and
// never retry); an invoice that resolves zero items is a partial fetch and is
// left unclaimed for a later run.
//
// ⚠ RISK 5 — excludeIds (this run's freshly-created invoice ids) are held out of
// the candidate set, so a happy-path send whose stamp failed is not re-sent in
// the SAME invocation.
export async function retryUnsentInvoiceEmails(
  supabase: SupabaseClient,
  tenantId: string,
  billingMonth: string,
  opts: { apiKey?: string; appUrl?: string; excludeIds?: string[] } = {}
): Promise<{ emailsRetried: number }> {
  try {
    // 1. Discover unsent candidates — a READ, not a claim; the claim is per-row
    //    below so a crash cannot strand a batch.
    let discover = supabase
      .from("invoices")
      .select("id, parent_id, tenant_id, billing_month, gross_amount, package_applied, credit_applied, net_amount")
      .eq("tenant_id", tenantId)
      .eq("billing_month", billingMonth)
      .is("invoice_email_sent_at", null);
    if (opts.excludeIds && opts.excludeIds.length) {
      discover = discover.not("id", "in", `(${opts.excludeIds.join(",")})`);
    }
    const { data: candidates, error: discoverErr } = await discover;
    if (discoverErr) {
      console.log(`invoice email retry discovery failed (${tenantId}/${billingMonth}): ${discoverErr.message}`);
      return { emailsRetried: 0 };
    }
    const rows = (candidates ?? []) as any[];
    if (!rows.length) return { emailsRetried: 0 };

    // 2. Rebuild itemised lines. On a fetch error, send nothing (⚠ #2).
    const invoiceIds = rows.map((r) => r.id as string);
    const { data: itemRows, error: itemErr } = await supabase
      .from("invoice_items")
      .select("invoice_id, student_id, session_date, class_title, amount")
      .in("invoice_id", invoiceIds);
    if (itemErr) {
      console.log(`invoice email retry items fetch failed (${tenantId}/${billingMonth}): ${itemErr.message}`);
      return { emailsRetried: 0 };
    }
    const itemsByInvoice: Record<string, CreatedInvoiceItem[]> = {};
    for (const it of (itemRows ?? []) as any[]) {
      (itemsByInvoice[it.invoice_id] ??= []).push({
        student_id: it.student_id,
        session_date: it.session_date,
        class_title: it.class_title,
        amount: Number(it.amount),
      });
    }

    // 3. Per-invoice: claim → send → reset on failure.
    const claimedAt = new Date().toISOString();
    let emailsRetried = 0;
    for (const r of rows) {
      const items = itemsByInvoice[r.id] ?? [];
      if (!items.length) {
        // A generated invoice always has >=1 item; none means the item fetch was
        // partial. Leave it unclaimed (NULL) so a later run rebuilds it (⚠ #2).
        console.log(`invoice email retry skipped (${r.id}): no items resolved`);
        continue;
      }

      // Atomic claim of THIS row only. A concurrent run gets 0 rows back here.
      let claimed: { id: string }[] | null = null;
      try {
        const { data, error } = await supabase
          .from("invoices")
          .update({ invoice_email_sent_at: claimedAt })
          .eq("id", r.id)
          .is("invoice_email_sent_at", null)
          .select("id");
        if (error) {
          console.log(`invoice email retry claim failed (${r.id}): ${error.message}`);
          continue;
        }
        claimed = data as { id: string }[];
      } catch (e) {
        console.log(`invoice email retry claim threw (${r.id}): ${(e as Error).message}`);
        continue;
      }
      if (!claimed || !claimed.length) continue; // another run already claimed it

      const invoice: CreatedInvoice = {
        invoice_id: r.id,
        parent_id: r.parent_id,
        tenant_id: r.tenant_id,
        billing_month: r.billing_month,
        gross: Number(r.gross_amount),
        package: Number(r.package_applied),
        credit: Number(r.credit_applied),
        net: Number(r.net_amount),
        items,
      };
      const { results } = await emailInvoices(supabase, [invoice], opts);
      if (results[0]?.sent) {
        emailsRetried++;
        continue;
      }
      // Send did not go out — reset so a later run retries it.
      try {
        const { error } = await supabase
          .from("invoices")
          .update({ invoice_email_sent_at: null })
          .eq("id", r.id);
        if (error) console.log(`invoice email retry reset failed (${r.id}): ${error.message}`);
      } catch (e) {
        console.log(`invoice email retry reset threw (${r.id}): ${(e as Error).message}`);
      }
    }

    return { emailsRetried };
  } catch (e) {
    // Best-effort, same contract as emailCreatedInvoices — never disturb billing.
    console.log(`invoice email retry error (${tenantId}/${billingMonth}): ${(e as Error).message}`);
    return { emailsRetried: 0 };
  }
}

// ── Blocked-generation alert ───────────────────────────────────────────────
// When an automatic run refuses because attendance is unmarked, nobody finds
// out unless someone opens the admin panel — the run is silent by design. This
// tells the coach (and the superadmin) what to mark.
//
// THROTTLED: the cron runs daily, so a naive send would email every day until
// it is fixed, which trains the recipient to filter it. State lives in
// app_settings under a per-month key, so no schema change is needed.

const BLOCKED_NOTICE_KEY = "invoice_block_notified";

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

  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
    <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a">Invoices for ${escapeHtml(
      formatBillingMonth(billingMonth)
    )} could not be generated</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#475569">
      Some lessons still have no attendance marked. Nothing has been billed.
      Mark these in the app — or mark them <strong>cancelled</strong> if the
      lesson did not run — and invoicing will continue automatically.
    </p>
    <ul style="margin:0 0 16px;padding-left:18px;font-size:14px;color:#334155">${rows}</ul>
    <p style="margin:0;font-size:12px;color:#94a3b8">
      You will not get this reminder again until the outstanding lessons change.
    </p>
  </div></body></html>`;
}

/**
 * Email a TENANT's coaches and admin that their generation is blocked, at most
 * once per distinct set of blocking lessons per month. Never throws; a failure
 * here must not affect the run that produced it.
 *
 * Scoped to the tenant: one school's unmarked lesson is not another business's
 * problem, and telling every coach on the platform about it would leak the
 * blocked class's title and dates across a business boundary.
 */
export async function notifyGenerationBlocked(
  supabase: SupabaseClient,
  billingMonth: string,
  blocking: BlockingLessonSummary[],
  opts: { apiKey?: string; tenantId?: string } = {}
): Promise<{ notified: number }> {
  if (!opts.apiKey || blocking.length === 0) return { notified: 0 };

  try {
    // Fingerprint the blocking set: re-alert only when it actually changes,
    // so a daily cron does not send a daily identical nag.
    const fingerprint = blocking
      .map((b) => `${b.class_title}|${b.session_date}|${b.unmarked_student_count}`)
      .sort()
      .join(";");

    const { data: prior } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", BLOCKED_NOTICE_KEY)
      .maybeSingle();

    // Keyed by tenant AND month, so one business's alert state cannot suppress
    // another's — with a single key, the first tenant to be blocked in a month
    // would silence everyone else's alert for that month.
    const seen = (prior?.value ?? {}) as Record<string, string>;
    const seenKey = opts.tenantId ? `${opts.tenantId}:${billingMonth}` : billingMonth;
    if (seen[seenKey] === fingerprint) return { notified: 0 };

    // This tenant's coaches and admin, plus the platform admin (who has no
    // tenant and is the fallback when something is stuck).
    let q = supabase.from("profiles").select("email, role, tenant_id");
    const { data: recipients } = opts.tenantId
      ? await q.or(`tenant_id.eq.${opts.tenantId},role.eq.platform_admin`)
      : await q.in("role", ["coach", "tenant_admin", "platform_admin"]);

    const html = buildBlockedEmailHtml(billingMonth, blocking);
    const subject = `Action needed: ${formatBillingMonth(
      billingMonth
    )} invoices are blocked by unmarked attendance`;

    let notified = 0;
    for (const r of recipients ?? []) {
      if (!r.email) continue;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: DEFAULT_FROM,
          to: r.email,
          subject,
          html,
        }),
      });
      if (res.ok) notified++;
    }

    // Only record the fingerprint once something actually went out, so a
    // total delivery failure retries tomorrow instead of going quiet.
    if (notified > 0) {
      await supabase
        .from("app_settings")
        .update({
          value: { ...seen, [seenKey]: fingerprint },
          updated_at: new Date().toISOString(),
        })
        .eq("key", BLOCKED_NOTICE_KEY);
    }

    return { notified };
  } catch (e) {
    console.error("notifyGenerationBlocked failed (ignored):", e);
    return { notified: 0 };
  }
}
