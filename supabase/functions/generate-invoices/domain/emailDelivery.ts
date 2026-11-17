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
//
// Moved verbatim out of email.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B10): the DELIVERY
// half — send, claim → send → settle, resendGate and its module state (declared
// ONCE, here — fence 5), emailInvoices, retry, resend and the blocked notice.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import type { CreatedInvoice, CreatedInvoiceItem } from "../types.ts";
import * as repo from "../dao/email.repo.ts";
import type { InvoiceEmailRow } from "../dao/email.repo.ts";
import { claimInvoiceEmailRpc } from "../dao/email.rpc.ts";
import { postResendEmail } from "../dao/resend.ts";
import {
  DEFAULT_APP_URL,
  DEFAULT_FROM,
  blockedNoticeRecipients,
  buildBlockedEmailHtml,
  buildInvoiceEmailHtml,
  buildInvoiceEmailSubject,
  formatBillingMonth,
  formatSessionDate,
  invoiceIdempotencyKey,
  money,
  outcomeForStatus,
  settleActionFor,
} from "./emailTemplates.ts";
import type {
  BlockedNoticeCandidate,
  BlockingLessonSummary,
  InvoiceEmailData,
  InvoiceEmailItem,
  SendOutcome,
  SendResult,
  SettleAction,
} from "./emailTemplates.ts";


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
    const res = await postResendEmail({
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
  supabase: SupabaseClient<Database>,
  invoiceId: string,
  manual = false
): Promise<InvoiceEmailClaim | null> {
  const { data, error } = await claimInvoiceEmailRpc(supabase, invoiceId, manual);
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
  supabase: SupabaseClient<Database>,
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
    const { error } = await repo.settleInvoiceEmailRow(supabase, patch, invoiceId, claimedAt);
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

/** Delivery options shared by every invoice-email path. */
export type EmailSendOpts = {
  apiKey?: string;
  appUrl?: string;
  /** Resend sends per second, at most. Default RESEND_DEFAULT_MAX_PER_SECOND. */
  maxPerSecond?: number;
};

/** How many invoices are in claim → send → settle at the same time. */
export const EMAIL_CONCURRENCY = 5;

/** Resend's documented default team limit has read 2, 5 and 10 req/s on
 *  different pages of its docs; a send over it gets a 429, which outcomeForStatus
 *  maps to "rejected" — the claim is released and the email waits for the next
 *  run. 2 is the strictest figure, so it is the default; raise it with the
 *  RESEND_MAX_PER_SECOND secret once the team's real limit is confirmed on
 *  Resend's Usage page. Sequential sends from the same region as the DB could
 *  already exceed 2/s, so this gate matters even without concurrency. */
export const RESEND_DEFAULT_MAX_PER_SECOND = 2;

// Start time of the most recent Resend call in this isolate. Module-level so
// the created-invoice pass and the retry pass of one invocation share it.
let lastResendStart = 0;
let gateChain: Promise<void> = Promise.resolve();

/** Wait until starting a Resend call keeps this isolate under `maxPerSecond`.
 *  Calls are serialised through a promise chain so concurrent workers queue
 *  instead of all reading the same `lastResendStart`. */
export function resendGate(maxPerSecond?: number): Promise<void> {
  const rate = maxPerSecond && maxPerSecond > 0 ? maxPerSecond : RESEND_DEFAULT_MAX_PER_SECOND;
  const spacing = 1000 / rate;
  const turn = gateChain.then(async () => {
    const wait = lastResendStart + spacing - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastResendStart = Date.now();
  });
  gateChain = turn.catch(() => {});
  return turn;
}

// Claim, send and settle one email per invoice in the batch. Resolves
// recipients and branding ONCE for the batch, then per invoice: claim → send
// with its Idempotency-Key → settle from the outcome. The claim is taken per
// invoice, immediately before its send, so a crash strands at most the
// in-flight invoices (EMAIL_CONCURRENCY of them, since 2026-11-16) — and even
// those only for their 15-minute lease.
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
  supabase: SupabaseClient<Database>,
  invoices: CreatedInvoice[],
  opts: EmailSendOpts & { manual?: boolean } = {}
): Promise<{ emailsSent: number; results: InvoiceSendResult[] }> {
  if (!invoices.length) return { emailsSent: 0, results: [] };
  const appUrl = opts.appUrl ?? DEFAULT_APP_URL;
  let emailsSent = 0;
  const results: InvoiceSendResult[] = new Array(invoices.length);

  try {
    const parentIds = [...new Set(invoices.map((c) => c.parent_id))];
    const studentIds = [
      ...new Set(invoices.flatMap((c) => c.items.map((i) => i.student_id))),
    ];

    // parent_id → { email, name } (profiles is a to-one embed)
    const { data: parentRows } = await repo.readParentContacts(supabase, parentIds);
    const parentInfo: Record<string, { email: string | null; name: string }> = {};
    for (const row of parentRows ?? []) {
      const prof = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      parentInfo[row.id] = {
        email: prof?.email ?? null,
        name: prof?.full_name ?? "there",
      };
    }

    // tenant_id → branding. One query for the whole run, not one per invoice.
    const tenantIds = [...new Set(invoices.map((c) => c.tenant_id).filter(Boolean))];
    const { data: tenantRows } = tenantIds.length
      ? await repo.readTenantBranding(supabase, tenantIds)
      : { data: [] as { id: string; display_name: string; logo_url: string | null }[] };
    const tenantInfo: Record<string, { name: string; logo: string | null }> = {};
    for (const row of tenantRows ?? []) {
      tenantInfo[row.id] = { name: row.display_name, logo: row.logo_url ?? null };
    }

    // student_id → full_name (for itemised lines)
    const { data: studentRows } = await repo.readStudentNames(supabase, studentIds);
    const studentName: Record<string, string> = {};
    for (const row of studentRows ?? []) {
      studentName[row.id] = row.full_name ?? "";
    }

    // Up to EMAIL_CONCURRENCY invoices go through claim → send → settle at
    // once (BILLING ENGINE SPEED, 2026-11-16). Each invoice's own sequence is
    // unchanged — it claims before it sends and settles after — and the claim
    // row-locks, so two workers can never send one invoice. Only the waiting
    // overlaps. Results keep the INPUT order (resendInvoiceEmail reads [0]).
    const sendOne = async (inv: CreatedInvoice, idx: number): Promise<void> => {
      try {
        const claim = await claimInvoiceEmail(supabase, inv.invoice_id, opts.manual ?? false);
        if (!claim) {
          results[idx] = { invoiceId: inv.invoice_id, claimed: false, sent: false };
          return;
        }

        const info = parentInfo[inv.parent_id];
        const brand = tenantInfo[inv.tenant_id];
        // Hold to Resend's per-second limit before the call that counts
        // against it. Skipped when nothing will be sent (no key / no address):
        // sendInvoiceEmail returns before any network call then.
        if (opts.apiKey && info?.email) await resendGate(opts.maxPerSecond);
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
          dueDate: inv.due_date,
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

        results[idx] = { invoiceId: inv.invoice_id, claimed: true, sent: action === "sent", outcome: r.outcome };
        if (action === "sent") emailsSent++;
        else console.log(`invoice email not sent (${inv.invoice_id}): ${r.reason} [claim ${action}]`);
      } catch (e) {
        // A throw here leaves any claim to its lease — it heals in 15 minutes.
        console.log(`invoice email threw (${inv.invoice_id}): ${(e as Error).message}`);
        results[idx] = { invoiceId: inv.invoice_id, claimed: false, sent: false };
      }
    };

    let next = 0;
    const worker = async () => {
      while (next < invoices.length) {
        const idx = next++;
        await sendOne(invoices[idx], idx);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(EMAIL_CONCURRENCY, invoices.length) }, worker)
    );
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
  supabase: SupabaseClient<Database>,
  created: CreatedInvoice[],
  opts: EmailSendOpts = {}
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

// INVOICE_EMAIL_SELECT and InvoiceEmailRow: dao/email.repo.ts (B3).

// Rebuild CreatedInvoice shapes from stored rows. The itemised lines come from
// invoice_items. `ok: false` on an item-fetch error — the caller sends NOTHING
// then (a line-item-less email would still settle as sent and never retry, ⚠ #2).
// An invoice that resolves zero items is a partial fetch and is left out.
async function rebuildInvoices(
  supabase: SupabaseClient<Database>,
  rows: InvoiceEmailRow[]
): Promise<{ ok: true; invoices: CreatedInvoice[] } | { ok: false; reason: string }> {
  const { data: itemRows, error } = await repo.readInvoiceItemsFor(supabase, rows);
  if (error) return { ok: false, reason: error.message };
  const itemsByInvoice: Record<string, CreatedInvoiceItem[]> = {};
  for (const it of itemRows ?? []) {
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
      due_date: r.due_date,
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
  supabase: SupabaseClient<Database>,
  tenantId: string,
  billingMonth: string,
  opts: EmailSendOpts & { excludeIds?: string[] } = {}
): Promise<{ emailsRetried: number }> {
  try {
    let discover = repo.discoverUnsentInvoices(supabase, tenantId, billingMonth);
    if (opts.excludeIds && opts.excludeIds.length) {
      discover = discover.not("id", "in", `(${opts.excludeIds.join(",")})`);
    }
    const { data: candidates, error: discoverErr } = await discover;
    if (discoverErr) {
      console.log(`invoice email retry discovery failed (${tenantId}/${billingMonth}): ${discoverErr.message}`);
      return { emailsRetried: 0 };
    }
    const rows = candidates ?? [];
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
  supabase: SupabaseClient<Database>,
  invoiceId: string,
  opts: EmailSendOpts = {}
): Promise<ResendInvoiceResult> {
  try {
    const { data: row, error } = await repo.readInvoiceForResend(supabase, invoiceId);
    if (error) {
      console.log(`invoice email resend lookup failed (${invoiceId}): ${error.message}`);
      return { sent: false, reason: "lookup failed" };
    }
    if (!row) return { sent: false, reason: "not found" };
    const state = row.invoice_email_state;
    if (state === "SENT") return { sent: false, reason: "nothing to send" };
    if (state === "SENDING") return { sent: false, reason: "sending" };

    // ⚠ RISK 3 — never email in a suspended business's name. Read as a column,
    // the same way core.ts does; unreadable fails closed.
    const { data: tenant, error: tErr } = await repo.readTenantSuspendedAt(supabase, row);
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
  supabase: SupabaseClient<Database>,
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

    const { data: prior } = await repo.readBlockedNoticeState(supabase);

    // Keyed by tenant AND month, so one business's alert state cannot suppress
    // another's — with a single key, the first tenant to be blocked in a month
    // would silence everyone else's alert for that month.
    const seen = (prior?.value ?? {}) as Record<string, string>;
    const seenKey = opts.tenantId ? `${opts.tenantId}:${billingMonth}` : billingMonth;
    if (seen[seenKey] === fingerprint) return { notified: 0 };

    // This tenant's coaches and the admins who can fix the marking, plus the
    // platform admin (who has no tenant and is the fallback when something is
    // stuck). Which admins: blockedNoticeRecipients (X4, roles 2026-09-27).
    const q = repo.profilesQuery(supabase);
    const { data: candidates } = opts.tenantId
      ? await q.or(`tenant_id.eq.${opts.tenantId},role.eq.platform_admin`)
      : await q.in("role", ["coach", "tenant_admin", "platform_admin"]);
    let ownersQ = repo.ownersQuery(supabase);
    if (opts.tenantId) ownersQ = ownersQ.eq("id", opts.tenantId);
    const [{ data: owners }, { data: opsEditRoles }] = await Promise.all([
      ownersQ,
      repo.readOpsEditRoles(supabase),
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
      const res = await postResendEmail({
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
      await repo.recordBlockedNotice(supabase, seen, seenKey, fingerprint);
    }

    return { notified };
  } catch (e) {
    console.error("notifyGenerationBlocked failed (ignored):", e);
    return { notified: 0 };
  }
}
