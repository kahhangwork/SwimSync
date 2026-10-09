// Transactional invoice email for generate-invoices.
//
// Kept OUT of core.ts (the billing engine, which stays pure + unit-tested):
// index.ts sends via emailCreatedInvoices() for each invoice core.ts reports
// creating, then runs retryUnsentInvoiceEmails() to re-send any earlier miss;
// the admin's per-invoice Resend comes in through resendInvoiceEmail(). All
// three go through the private emailInvoices() helper + sendInvoiceEmail().
// There is no other transactional-email path in the project today — password
// reset uses Supabase Auth's built-in SMTP, which only fires on auth events.
// This talks to the Resend HTTP API directly with the same key that backs the
// SMTP sender.
//
// Design notes:
//  • The API key is passed IN (not read from Deno.env here) so the builders and
//    sender are testable without touching the environment.
//  • sendInvoiceEmail NEVER throws — a delivery failure must not disturb invoice
//    generation. It returns { sent, outcome, reason }; the claim is settled from
//    the typed outcome (settleActionFor), never by parsing the reason text.
//  • CLAIM → SEND → SETTLE, on every send (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §3.2).
//    The claim is invoice_email_claimed_at, a 15-minute lease taken by the
//    claim_invoice_email RPC — the lease maths lives in SQL, never here.
//    invoice_email_sent_at is stamped ONLY after a confirmed send. Every send
//    carries a Resend Idempotency-Key, so a retry inside Resend's 24-hour window
//    cannot deliver twice; after 24 h nothing retries automatically.
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
  "Jul", "Aug", "Sept", "Oct", "Nov", "Dec",
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
  /** Prepaid package value applied. net = gross − package − credit + balanceAdjustment. */
  packageApplied?: number;
  credit: number;
  /** A prior-period DEBIT (a voided-then-paid credit) folded onto this invoice —
   *  it ADDS to what's owed, so it renders with a + sign. */
  balanceAdjustment?: number;
  net: number;
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

  // A prior-period DEBIT ADDS to what's owed (voided-then-paid credit, 20260822000100).
  const adjustmentRow =
    (data.balanceAdjustment ?? 0) > 0
      ? `
              <tr>
                <td colspan="2" style="padding:6px 0;font-size:13px;color:#475569;text-align:right;">Adjustment from a prior invoice</td>
                <td style="padding:6px 0;font-size:13px;color:#dc2626;text-align:right;white-space:nowrap;">+${escapeHtml(
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
              </tr>${packageRow}${creditRow}${adjustmentRow}
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
    /** Resend Idempotency-Key — see invoiceIdempotencyKey. */
    idempotencyKey?: string;
  }
): Promise<SendResult> {
  if (!opts.apiKey) return { sent: false, outcome: "no_api_key", reason: "no_api_key" };
  if (!opts.to) return { sent: false, outcome: "no_recipient", reason: "no_recipient" };

  const subject = buildInvoiceEmailSubject(opts);
  const html = buildInvoiceEmailHtml(opts);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
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
      const outcome = outcomeForStatus(res.status, body);
      return {
        sent: outcome === "key_reused",
        outcome,
        reason: `resend_${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return { sent: true, outcome: "ok" };
  } catch (e) {
    return { sent: false, outcome: "threw", reason: `fetch_error: ${(e as Error).message}` };
  }
}

// ── Claim → send → settle (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §3.2) ─────────────

/** A won claim. `claimedAt` is the SETTLE TOKEN: every settle is conditional on
 *  it, so a row that was re-claimed after its lease expired is no longer ours. */
export type InvoiceEmailClaim = { claimedAt: string; priorState: string };

/**
 * Claim one invoice's email. null = not claimed (SENT, SENDING, MAY_HAVE_SENT
 * on an automatic pass, no such invoice, or the RPC failed) — skip it.
 *
 * The RPC row-locks, computes the state in SQL and claims only UNSENT or
 * RETRYABLE — or MAY_HAVE_SENT when `manual` (a human pressed Resend). A
 * concurrent claimer waits on the lock, then sees SENDING and gets no row.
 */
export async function claimInvoiceEmail(
  supabase: SupabaseClient,
  invoiceId: string,
  manual = false
): Promise<InvoiceEmailClaim | null> {
  const { data, error } = await supabase.rpc("claim_invoice_email", {
    p_invoice_id: invoiceId,
    p_manual: manual,
  });
  if (error) {
    // If the claim committed and only its response was lost, the row reads
    // SENDING for 15 minutes and then RETRYABLE — it heals, it does not strand.
    console.log(`invoice email claim failed (${invoiceId}): ${error.message}`);
    return null;
  }
  const row = (data as { claimed_at: string; prior_state: string }[] | null)?.[0];
  return row ? { claimedAt: row.claimed_at, priorState: row.prior_state } : null;
}

/**
 * Settle a claim. Conditional on the token (`… AND invoice_email_claimed_at =
 * <claimedAt>`), so it touches nothing if the row has since been re-claimed.
 * Never throws; a failed settle leaves the claim, which the lease expires.
 */
export async function settleInvoiceEmail(
  supabase: SupabaseClient,
  invoiceId: string,
  claimedAt: string,
  action: SettleAction
): Promise<void> {
  if (action === "keep") return;
  const patch =
    action === "sent"
      ? { invoice_email_sent_at: new Date().toISOString(), invoice_email_claimed_at: null }
      : { invoice_email_claimed_at: null };
  try {
    const { error } = await supabase
      .from("invoices")
      .update(patch)
      .eq("id", invoiceId)
      .eq("invoice_email_claimed_at", claimedAt);
    if (error) console.log(`invoice email settle (${action}) failed (${invoiceId}): ${error.message}`);
  } catch (e) {
    console.log(`invoice email settle (${action}) threw (${invoiceId}): ${(e as Error).message}`);
  }
}

// Per-invoice outcome. `claimed` false = another sender held it, or it was not
// in a claimable state; nothing was sent.
export type InvoiceSendResult = {
  invoiceId: string;
  claimed: boolean;
  sent: boolean;
  outcome?: SendOutcome;
};

// Claim, send and settle one email per invoice in the batch. Resolves
// recipients and branding ONCE for the batch, then per invoice: claim → send
// with its Idempotency-Key → settle from the outcome. The claim is taken per
// invoice, immediately before its send, so a crash strands at most the ONE
// in-flight invoice — and even that only for its 15-minute lease.
// NEVER throws — any failure is logged and swallowed, and one invoice's failure
// never blocks the rest (a try/catch per invoice). A no-op when there are no
// invoices; without an apiKey each claim is released again (no_api_key).
//
// Student NAMES are resolved LIVE from students.full_name — NOT from the
// invoice_items.student_name snapshot — so first-send and retried emails render
// identically (⚠ RISK 7, INVOICE_EMAIL_RETRY_PLAN.md). A rename between two
// attempts changes the payload under the same key; Resend then answers 409
// invalid_idempotent_request, which settleActionFor reads as SENT.
async function emailInvoices(
  supabase: SupabaseClient,
  invoices: CreatedInvoice[],
  opts: { apiKey?: string; appUrl?: string; manual?: boolean } = {}
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
      try {
        const claim = await claimInvoiceEmail(supabase, inv.invoice_id, opts.manual ?? false);
        if (!claim) {
          results.push({ invoiceId: inv.invoice_id, claimed: false, sent: false });
          continue;
        }

        const info = parentInfo[inv.parent_id];
        const brand = tenantInfo[inv.tenant_id];
        // sendInvoiceEmail never throws, so the settle below always runs.
        const r = await sendInvoiceEmail({
          apiKey: opts.apiKey,
          to: info?.email,
          idempotencyKey: invoiceIdempotencyKey(inv.invoice_id),
          parentName: info?.name ?? "there",
          businessName: brand?.name,
          logoUrl: brand?.logo ?? null,
          billingMonth: inv.billing_month,
          gross: inv.gross,
          packageApplied: inv.package,
          credit: inv.credit,
          balanceAdjustment: inv.balance_adjustment,
          net: inv.net,
          appUrl,
          items: inv.items.map((i) => ({
            studentName: studentName[i.student_id] ?? "",
            sessionDate: i.session_date,
            classTitle: i.class_title,
            amount: i.amount,
          })),
        });
        const action = settleActionFor(r.outcome);
        await settleInvoiceEmail(supabase, inv.invoice_id, claim.claimedAt, action);

        results.push({ invoiceId: inv.invoice_id, claimed: true, sent: action === "sent", outcome: r.outcome });
        if (action === "sent") emailsSent++;
        else console.log(`invoice email not sent (${inv.invoice_id}): ${r.reason} [claim ${action}]`);
      } catch (e) {
        // A throw here leaves any claim to its lease — it heals in 15 minutes.
        console.log(`invoice email threw (${inv.invoice_id}): ${(e as Error).message}`);
        results.push({ invoiceId: inv.invoice_id, claimed: false, sent: false });
      }
    }
  } catch (e) {
    // Never let the email step fail the caller — invoices are already committed.
    console.log(`invoice email step error: ${(e as Error).message}`);
  }

  return { emailsSent, results };
}

// Orchestrate emails for a batch of just-created invoices. Called by index.ts
// AFTER generation has committed, so nothing here can affect billing. The first
// send CLAIMS like every other send: before 20260927000100 it sent first and
// stamped after, so a concurrent run's retry pass could claim and send a
// just-created invoice while this one was mid-send — two emails to one parent.
// NEVER throws — any failure is logged and swallowed; returns how many sent.
export async function emailCreatedInvoices(
  supabase: SupabaseClient,
  created: CreatedInvoice[],
  opts: { apiKey?: string; appUrl?: string } = {}
): Promise<{ emailsSent: number }> {
  if (!created.length) return { emailsSent: 0 };
  const { emailsSent } = await emailInvoices(supabase, created, opts);
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
  // Settings unreadable → suspension unknown → treated as suspended.
  if (status === "tenant_unreadable") return false;
  // Wave 6: which lessons a package already paid is unknown — resending would
  // rest on the same unread state. Nothing was generated; nothing to retry.
  if (status === "package_mode_unreadable") return false;
  if (status === "auto_disabled" && !isManual) return false;
  return true;
}

const INVOICE_EMAIL_SELECT =
  "id, parent_id, tenant_id, billing_month, gross_amount, package_applied, credit_applied, balance_adjustment, net_amount";

// Rebuild CreatedInvoice shapes from stored rows. The itemised lines come from
// invoice_items. `ok: false` on an item-fetch error — the caller sends NOTHING
// then (a line-item-less email would still settle as sent and never retry, ⚠ #2).
// An invoice that resolves zero items is a partial fetch and is left out.
async function rebuildInvoices(
  supabase: SupabaseClient,
  rows: any[]
): Promise<{ ok: true; invoices: CreatedInvoice[] } | { ok: false; reason: string }> {
  const { data: itemRows, error } = await supabase
    .from("invoice_items")
    .select("invoice_id, student_id, session_date, class_title, amount")
    .in("invoice_id", rows.map((r) => r.id as string));
  if (error) return { ok: false, reason: error.message };
  const itemsByInvoice: Record<string, CreatedInvoiceItem[]> = {};
  for (const it of (itemRows ?? []) as any[]) {
    (itemsByInvoice[it.invoice_id] ??= []).push({
      student_id: it.student_id,
      session_date: it.session_date,
      class_title: it.class_title,
      amount: Number(it.amount),
    });
  }
  const invoices: CreatedInvoice[] = [];
  for (const r of rows) {
    const items = itemsByInvoice[r.id] ?? [];
    if (!items.length) {
      // A generated invoice always has >=1 item; none means the item fetch was
      // partial. Left unclaimed so a later run rebuilds it (⚠ #2).
      console.log(`invoice email skipped (${r.id}): no items resolved`);
      continue;
    }
    invoices.push({
      invoice_id: r.id,
      parent_id: r.parent_id,
      tenant_id: r.tenant_id,
      billing_month: r.billing_month,
      gross: Number(r.gross_amount),
      package: Number(r.package_applied),
      credit: Number(r.credit_applied),
      balance_adjustment: Number(r.balance_adjustment ?? 0),
      net: Number(r.net_amount),
      items,
    });
  }
  return { ok: true, invoices };
}

// Retry unsent invoice emails for ONE (tenant, month) — the self-heal path.
// Runs on every generate-invoices invocation, INCLUDING a sealed-month
// short-circuit, so a send that failed on an earlier run is re-sent on the next
// run with no duplicate to parents who already got theirs.
//
// Candidates are UNSENT (never claimed, or released) and RETRYABLE (claimed
// 15 min – 24 h ago with no outcome — a crash, a 5xx, a timeout). RETRYABLE is
// safe to resend because the SAME Idempotency-Key is still inside Resend's
// 24-hour window. MAY_HAVE_SENT (> 24 h) is NEVER retried here — the key has
// lapsed, so a retry could duplicate; the admin's Billing months card offers a
// human Resend instead (plan §2). The claim RPC enforces all of this; the state
// filter below only saves rebuilding emails that would not claim.
//
// ⚠ RISK 5 — excludeIds (this run's freshly-created invoice ids) are held out,
// so a first send that was released (no key, no recipient, a 4xx) is not
// re-attempted in the SAME invocation.
export async function retryUnsentInvoiceEmails(
  supabase: SupabaseClient,
  tenantId: string,
  billingMonth: string,
  opts: { apiKey?: string; appUrl?: string; excludeIds?: string[] } = {}
): Promise<{ emailsRetried: number }> {
  try {
    let discover = supabase
      .from("invoices")
      .select(INVOICE_EMAIL_SELECT)
      .eq("tenant_id", tenantId)
      .eq("billing_month", billingMonth)
      .in("invoice_email_state", ["UNSENT", "RETRYABLE"]);
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

    const rebuilt = await rebuildInvoices(supabase, rows);
    if (!rebuilt.ok) {
      console.log(`invoice email retry items fetch failed (${tenantId}/${billingMonth}): ${rebuilt.reason}`);
      return { emailsRetried: 0 };
    }

    const { emailsSent } = await emailInvoices(supabase, rebuilt.invoices, opts);
    return { emailsRetried: emailsSent };
  } catch (e) {
    // Best-effort, same contract as emailCreatedInvoices — never disturb billing.
    console.log(`invoice email retry error (${tenantId}/${billingMonth}): ${(e as Error).message}`);
    return { emailsRetried: 0 };
  }
}

export type ResendInvoiceResult = {
  sent: boolean;
  reason?:
    | "not found"
    | "tenant suspended"
    | "tenant check failed"
    | "lookup failed"
    | "nothing to send"
    | "sending"
    | "no items"
    | SendOutcome;
};

// The admin's per-invoice Resend (Billing months card → "may not have
// arrived"). AUTHORITY IS THE CALLER'S JOB — the admin route checks
// is_tenant_admin for the invoice's tenant before this is ever reached.
//
// Claims with p_manual, so it also accepts MAY_HAVE_SENT — a human choosing to
// resend is choosing to risk one duplicate. It sends under the invoice's one
// key, which has lapsed by then (see invoiceIdempotencyKey). A double-clicked
// Resend (or two admins) is still one email: the second claim finds SENDING
// and returns "sending".
// NEVER throws.
export async function resendInvoiceEmail(
  supabase: SupabaseClient,
  invoiceId: string,
  opts: { apiKey?: string; appUrl?: string } = {}
): Promise<ResendInvoiceResult> {
  try {
    const { data: row, error } = await supabase
      .from("invoices")
      .select(`${INVOICE_EMAIL_SELECT}, invoice_email_state`)
      .eq("id", invoiceId)
      .maybeSingle();
    if (error) {
      console.log(`invoice email resend lookup failed (${invoiceId}): ${error.message}`);
      return { sent: false, reason: "lookup failed" };
    }
    if (!row) return { sent: false, reason: "not found" };
    const state = (row as any).invoice_email_state as string;
    if (state === "SENT") return { sent: false, reason: "nothing to send" };
    if (state === "SENDING") return { sent: false, reason: "sending" };

    // ⚠ RISK 3 — never email in a suspended business's name. Read as a column,
    // the same way core.ts does; unreadable fails closed.
    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("suspended_at")
      .eq("id", (row as any).tenant_id)
      .maybeSingle();
    if (tErr || !tenant) return { sent: false, reason: "tenant check failed" };
    if ((tenant as { suspended_at: string | null }).suspended_at !== null) {
      return { sent: false, reason: "tenant suspended" };
    }

    const rebuilt = await rebuildInvoices(supabase, [row]);
    if (!rebuilt.ok) {
      console.log(`invoice email resend items fetch failed (${invoiceId}): ${rebuilt.reason}`);
      return { sent: false, reason: "lookup failed" };
    }
    if (!rebuilt.invoices.length) return { sent: false, reason: "no items" };

    const { results } = await emailInvoices(supabase, rebuilt.invoices, { ...opts, manual: true });
    const r = results[0];
    if (!r?.claimed) return { sent: false, reason: "sending" };
    return r.sent ? { sent: true } : { sent: false, reason: r.outcome };
  } catch (e) {
    console.log(`invoice email resend error (${invoiceId}): ${(e as Error).message}`);
    return { sent: false, reason: "lookup failed" };
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

    // This tenant's coaches and the admins who can fix the marking, plus the
    // platform admin (who has no tenant and is the fallback when something is
    // stuck). Which admins: blockedNoticeRecipients (X4, roles 2026-09-27).
    const q = supabase.from("profiles").select("id, email, role, tenant_id, admin_role_id");
    const { data: candidates } = opts.tenantId
      ? await q.or(`tenant_id.eq.${opts.tenantId},role.eq.platform_admin`)
      : await q.in("role", ["coach", "tenant_admin", "platform_admin"]);
    let ownersQ = supabase.from("tenants").select("owner_profile_id");
    if (opts.tenantId) ownersQ = ownersQ.eq("id", opts.tenantId);
    const [{ data: owners }, { data: opsEditRoles }] = await Promise.all([
      ownersQ,
      supabase.from("tenant_role_permissions").select("role_id")
        .eq("area", "operations").eq("level", "edit"),
    ]);
    const recipients = blockedNoticeRecipients(
      (candidates ?? []) as BlockedNoticeCandidate[],
      new Set((owners ?? []).map((t) => t.owner_profile_id as string).filter(Boolean)),
      new Set((opsEditRoles ?? []).map((r) => r.role_id as string)),
    );

    const html = buildBlockedEmailHtml(billingMonth, blocking);
    const subject = `Action needed: ${formatBillingMonth(
      billingMonth
    )} invoices are blocked by unmarked attendance`;

    let notified = 0;
    for (const r of recipients) {
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
