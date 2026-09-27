// credit-note-emails — the database-facing pipeline, split out of the handler so it
// can be integration-tested against a real stack.
//
// Plan: docs/plans/CREDIT_NOTE_EMAIL_PLAN.md. Same split as generate-invoices
// (core.ts does the work, index.ts is the Deno.serve wrapper): the interesting
// failures — a missing tenant filter, a duplicate email, a claim that both runs
// win — live in SQL semantics, and a Deno.serve closure cannot be reached by a test.
//
// ⚠ RISK 14 — nothing here may be tested with a hand-INSERTed credit note. The
// local credit_notes table is empty, so a fixture that inserts one directly proves
// nothing about the path that actually fires. core.test.ts drives the
// handle_attendance_update TRIGGER and throws if it produced no row.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildCreditNoteHtml,
  buildCreditNoteSubject,
  type CreditNoteEmailData,
  isSendableNote,
  type SendResult,
  type SettleAction,
  settleActionFor,
} from "./email.ts";

// ⚠ RISK 6 — snapshot fields ONLY. credit_notes.student_name is the note's own
// snapshot; class_title and session_date come from invoice_items, snapshotted at
// invoicing. §7.155: a resend weeks later must render what the invoice said, not what
// the records say now.
// PROHIBITION: this string must NOT grow students(full_name), classes(title), or
// lesson_sessions(session_date).
export const NOTE_SELECT =
  "id, reference_number, amount, reason, status, applied_to_invoice_id, " +
  "tenant_id, parent_id, invoice_item_id, lesson_session_id, student_name, " +
  "invoice_items(class_title, session_date), " +
  "parents(profiles(full_name, email)), " +
  "tenants(display_name, logo_url), " +
  // PostgREST computed column (20260927000100): the email state, computed in SQL
  // so no lease maths happens in Deno.
  "credit_note_email_state";

export type NoteRow = {
  id: string;
  reference_number: string;
  amount: number | string;
  reason: string | null;
  status: string;
  applied_to_invoice_id: string | null;
  tenant_id: string;
  parent_id: string;
  invoice_item_id: string;
  lesson_session_id: string;
  student_name: string | null;
  invoice_items: unknown;
  parents: unknown;
  tenants: unknown;
  /** SENT / UNSENT / SENDING / RETRYABLE / MAY_HAVE_SENT (email_delivery_state). */
  credit_note_email_state: string;
};

/** PostgREST returns an embedded row as an object or a 1-element array. */
export function one<T>(v: unknown): T | undefined {
  return (Array.isArray(v) ? v[0] : v) as T | undefined;
}

export type Candidates =
  /** `sending` (findUnsentById only): the note exists and is mid-send under
   *  someone else's fresh claim — not "nothing to send", which means emailed. */
  | { ok: true; notes: NoteRow[]; sending?: boolean }
  | { ok: false; reason: string };

/**
 * Unsent notes for one lesson session, scoped to the session's tenant.
 *
 * ⚠ RISK 3 — the tenant filter is not decoration. This runs on the SERVICE client,
 * which bypasses RLS, while authority was checked against the SESSION.
 * core.ts:1400-1409 in the engine says of its own equivalent query: "This filter is
 * the only thing preventing it — service_role bypasses RLS." And credit_notes.tenant_id
 * is derived from invoices.tenant_id with a fallback to students.tenant_id, so it CAN
 * diverge from session_tenant().
 *
 * Only UNSENT and RETRYABLE notes: a coach's re-save must neither race an
 * in-flight send (SENDING) nor resend one whose outcome is unknown after 24 h
 * (MAY_HAVE_SENT — the Idempotency-Key has lapsed; that is a human decision).
 */
export async function findUnsentBySession(
  svc: SupabaseClient,
  lessonSessionId: string,
  tenantId: string,
): Promise<Candidates> {
  const { data, error } = await svc
    .from("credit_notes")
    .select(NOTE_SELECT)
    .eq("lesson_session_id", lessonSessionId)
    .eq("tenant_id", tenantId) // ⚠ RISK 3
    .in("credit_note_email_state", ["UNSENT", "RETRYABLE"]);
  if (error) return { ok: false, reason: `discovery failed: ${error.message}` };
  return { ok: true, notes: (data ?? []) as unknown as NoteRow[] };
}

/**
 * One unsent note by id, for the admin Resend path. Accepts UNSENT, RETRYABLE
 * and MAY_HAVE_SENT — a human asked. A note mid-send under a fresh claim comes
 * back as `sending`, with no notes.
 */
export async function findUnsentById(
  svc: SupabaseClient,
  creditNoteId: string,
): Promise<Candidates> {
  const { data, error } = await svc
    .from("credit_notes")
    .select(NOTE_SELECT)
    .eq("id", creditNoteId)
    .is("email_sent_at", null)
    .maybeSingle();
  if (error) return { ok: false, reason: `lookup failed: ${error.message}` };
  // No row means "no such note" OR "already emailed". Both are nothing-to-do, and
  // the second is what stops a double press re-sending.
  if (!data) return { ok: true, notes: [] };
  const note = data as unknown as NoteRow;
  if (note.credit_note_email_state === "SENDING") return { ok: true, notes: [], sending: true };
  return { ok: true, notes: [note] };
}

/**
 * Which of these notes are spent, in whole or in part?
 *
 * ⚠ RISK 2 — `status` alone is insufficient: the engine leaves status 'available'
 * while a note is PARTLY drawn down (engine core.ts:1437-1445), so
 * credit_applications is the only reliable signal.
 *
 * ⚠ Item 3 — filters `reversed_at IS NULL`: a draw REVERSED by an admin void is no
 * longer spent. A note voided then re-activated (handle_attendance_update) is
 * 'available' again with its old draws marked reversed; without this filter those
 * rows would read as "spent" forever and the re-issued credit email would never
 * send. Mirrors the trigger's own spend-signal and apply_credit_to_invoice.
 */
export async function findSpentNoteIds(
  svc: SupabaseClient,
  noteIds: string[],
): Promise<{ ok: true; spent: Set<string> } | { ok: false; reason: string }> {
  if (!noteIds.length) return { ok: true, spent: new Set() };
  const { data, error } = await svc
    .from("credit_applications")
    .select("credit_note_id")
    .is("reversed_at", null)
    .in("credit_note_id", noteIds);
  if (error) return { ok: false, reason: `applications check failed: ${error.message}` };
  const spent = new Set<string>();
  for (const r of (data ?? []) as { credit_note_id: string }[]) {
    spent.add(r.credit_note_id);
  }
  return { ok: true, spent };
}

/**
 * Invoice lines that ALREADY had a credit-note email sent for them.
 *
 * ⚠ RISK 5 — a re-toggled correction issues a SECOND credit note on the same
 * invoice_item_id and doubles the credit; credit_notes has no unique constraint
 * there (verified against the live catalogue). Without this the email would announce
 * $60 of credit for one $30 lesson. Filed for a real fix in BACKLOG.md; this keeps the
 * EMAIL from making it worse.
 */
export async function findEmailedInvoiceItemIds(
  svc: SupabaseClient,
  invoiceItemIds: string[],
): Promise<{ ok: true; items: Set<string> } | { ok: false; reason: string }> {
  if (!invoiceItemIds.length) return { ok: true, items: new Set() };
  const { data, error } = await svc
    .from("credit_notes")
    .select("invoice_item_id")
    .in("invoice_item_id", invoiceItemIds)
    .not("email_sent_at", "is", null);
  if (error) return { ok: false, reason: `sibling check failed: ${error.message}` };
  const items = new Set<string>();
  for (const r of (data ?? []) as { invoice_item_id: string }[]) {
    items.add(r.invoice_item_id);
  }
  return { ok: true, items };
}

/**
 * Is this business suspended? Read as a COLUMN, deliberately not via the
 * tenant_suspended() RPC.
 *
 * ⚠ THE RPC IS NOT CALLABLE BY service_role AND FAILS OPEN. This shipped as a real
 * bug on 2026-08-17 and was caught in review, not by a test:
 *   proacl for tenant_suspended = {postgres=X/postgres,authenticated=X/postgres}
 *   SET ROLE service_role; SELECT tenant_suspended(...) → permission denied
 * The old code did `const { data: suspended } = await svc.rpc("tenant_suspended", …)`
 * and discarded `error`, so data was null, `null === true` was false, and the gate
 * concluded "not suspended" on EVERY invocation. The RISK 10 mitigation was dead
 * code. `canEmailForTenant` was never the problem — its input always said false.
 *
 * PROHIBITION: do NOT fix that by granting EXECUTE to service_role. §7.87 —
 * privileges no policy permits turn table_grants/function_grants red, and a plain
 * column read needs no new privilege at all (service_role already holds SELECT on
 * tenants). This mirrors generate-invoices/core.ts:275-285, which reads
 * suspended_at the same way for the same reason.
 *
 * FAILS CLOSED: an unreadable tenant row returns `null`, and the caller must treat
 * that as "do not email". A suspended business is dark — credit_notes_select hides
 * the note from the parent while tenant_suspended(tenant_id) — so emailing about a
 * credit they cannot find in the app is the harm being prevented.
 */
export async function fetchTenantSuspended(
  svc: SupabaseClient,
  tenantId: string,
): Promise<boolean | null> {
  const { data, error } = await svc
    .from("tenants")
    .select("suspended_at")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) {
    console.log(
      `credit-note email tenant check failed (${tenantId}): ${error?.message ?? "no row"}`,
    );
    return null;
  }
  // tenants.suspend is VESTIGIAL and deliberately not read — default false, and
  // suspend_tenant() writes only suspended_at. Filed for deletion in BACKLOG.md.
  return (data as { suspended_at: string | null }).suspended_at !== null;
}

/** The parent's current credit with ONE business, keyed by parent. */
export async function fetchBalances(
  svc: SupabaseClient,
  tenantId: string,
  parentIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!parentIds.length) return out;
  const { data } = await svc
    .from("parent_tenant_balances")
    .select("parent_id, credit_balance")
    .eq("tenant_id", tenantId)
    .in("parent_id", parentIds);
  for (const b of (data ?? []) as { parent_id: string; credit_balance: number | string }[]) {
    out.set(b.parent_id, Number(b.credit_balance));
  }
  return out;
}

/** A won claim. `claimedAt` is the SETTLE TOKEN; `issuedAt` versions the key. */
export type NoteClaim = { claimedAt: string; priorState: string; issuedAt: string };

/**
 * Atomically claim ONE note for sending (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §3.2).
 * `claim` is null unless this caller won.
 *
 * claim_credit_note_email row-locks, computes the state in SQL, and claims only
 * UNSENT or RETRYABLE — or MAY_HAVE_SENT when `manual` (the admin's Resend). A
 * second caller racing for the same row (a coach saving twice, or an admin
 * pressing Resend while the coach's save is in flight) waits on the lock, then
 * sees SENDING and gets no row. The claim is email_claimed_at, a 15-minute lease:
 * email_sent_at is stamped only after a confirmed send (settleNote).
 */
export async function claimNote(
  svc: SupabaseClient,
  noteId: string,
  manual = false,
): Promise<{ ok: true; claim: NoteClaim | null } | { ok: false; reason: string }> {
  const { data, error } = await svc.rpc("claim_credit_note_email", {
    p_credit_note_id: noteId,
    p_manual: manual,
  });
  if (error) return { ok: false, reason: `claim failed: ${error.message}` };
  const row = (data as { claimed_at: string; prior_state: string; issued_at: string }[] | null)?.[0];
  return {
    ok: true,
    claim: row ? { claimedAt: row.claimed_at, priorState: row.prior_state, issuedAt: row.issued_at } : null,
  };
}

/**
 * Settle a claim. CONDITIONAL on the token (`… AND email_claimed_at = <claimedAt>`):
 * a note re-issued meanwhile (its trigger clears the claim) or re-claimed after the
 * lease expired is no longer ours, and is left alone. Never throws.
 */
export async function settleNote(
  svc: SupabaseClient,
  noteId: string,
  claimedAt: string,
  action: SettleAction,
): Promise<void> {
  if (action === "keep") return;
  const patch = action === "sent"
    // toISOString() writes a timestamptz — it does NOT derive a calendar date, so
    // this is not the §7.7 / ⚠ RISK 13 bug.
    ? { email_sent_at: new Date().toISOString(), email_claimed_at: null }
    : { email_claimed_at: null };
  try {
    const { error } = await svc
      .from("credit_notes")
      .update(patch)
      .eq("id", noteId)
      .eq("email_claimed_at", claimedAt);
    if (error) console.log(`credit-note email settle (${action}) failed (${noteId}): ${error.message}`);
  } catch (e) {
    console.log(`credit-note email settle (${action}) threw (${noteId}): ${(e as Error).message}`);
  }
}

/**
 * The Resend Idempotency-Key for one credit-note email. Versioned by issued_at:
 * a re-issued note (same row, new issued_at) is a NEW email, and reusing the first
 * issue's key would have Resend replay that send, or answer 409.
 *
 * Within one issue it is ONE key for every attempt — including a human resend of a
 * MAY_HAVE_SENT note (decided with the user 2026-09-27, superseding plan §2's "new
 * key"). MAY_HAVE_SENT means the claim is > 24 h old, so the key has lapsed and
 * Resend sends fresh; a new key would let a coach re-save 15 minutes after an
 * unknown-outcome resend send a second copy under the lapsed original key.
 *
 * The epoch is taken from the timestamptz only to be a stable version number — no
 * calendar date is derived, so this is not the ⚠ RISK 13 pattern.
 */
export function creditNoteIdempotencyKey(noteId: string, claim: NoteClaim): string {
  // An unparseable timestamp falls back to the raw string — still a distinct
  // version per issue, where NaN would collide across every re-issue.
  const epoch = Date.parse(claim.issuedAt);
  return `credit-note/${noteId}/${Number.isNaN(epoch) ? claim.issuedAt : epoch}`;
}

export type SkipReason = "already-applied" | "invoice-line-already-emailed" | "no-snapshot";

/**
 * Should this note be emailed, given what the database says about it?
 *
 * Pure, so the ordering of the three refusals is pinned by a test rather than by
 * reading the loop. `emailedItems` is MUTATED by the caller as each note is claimed
 * — see the ⚠ RISK 5 note in index.ts: two unsent notes on one invoice line (exactly
 * what a re-toggled correction produces) would otherwise both pass in a single run.
 */
export function skipReasonFor(
  note: NoteRow,
  ctx: { spent: Set<string>; emailedItems: Set<string> },
): SkipReason | null {
  if (
    !isSendableNote({
      status: note.status,
      appliedToInvoiceId: note.applied_to_invoice_id,
      hasApplications: ctx.spent.has(note.id),
    })
  ) {
    return "already-applied";
  }
  if (ctx.emailedItems.has(note.invoice_item_id)) {
    return "invoice-line-already-emailed";
  }
  const item = one<{ class_title: string; session_date: string }>(note.invoice_items);
  if (!item?.session_date) {
    // The snapshot is the ONLY permitted source (⚠ RISK 6) — never a live-join
    // fallback. Left unclaimed so Resend can retry once the cause is understood.
    return "no-snapshot";
  }
  return null;
}

/** Recipient + branding + copy inputs for one note. Snapshot fields only (⚠ RISK 6). */
export function buildEmailData(
  note: NoteRow,
  balances: Map<string, number>,
): { data: CreditNoteEmailData; to: string | undefined } {
  const item = one<{ class_title: string; session_date: string }>(note.invoice_items);
  const parent = one<{ profiles: unknown }>(note.parents);
  const profile = one<{ full_name: string; email: string }>(parent?.profiles);
  const tenant = one<{ display_name: string; logo_url: string | null }>(note.tenants);
  const businessName = tenant?.display_name ?? "Your coach";
  return {
    to: profile?.email,
    data: {
      parentName: profile?.full_name ?? "there",
      businessName,
      logoUrl: tenant?.logo_url ?? null,
      referenceNumber: note.reference_number,
      amount: Number(note.amount),
      // ⚠ RISK 11 — a per-(parent,tenant) AGGREGATE, not this note's amount. The
      // copy labels both numbers and names the business precisely because of that.
      creditBalance: balances.get(note.parent_id) ?? Number(note.amount),
      studentName: note.student_name ?? "your child",
      classTitle: item?.class_title ?? "a lesson",
      sessionDate: item!.session_date, // skipReasonFor guarantees this
      reason: note.reason,
    },
  };
}

/**
 * Claim → send → settle, once per note.
 *
 * EXTRACTED FROM THE Deno.serve CLOSURE ON PURPOSE. A handler closure cannot be
 * reached by a test, and that is not academic: the RISK 10 suspension gate shipped
 * FAILING OPEN (fetchTenantSuspended's comment) and no test could see it, because
 * every test targeted core.ts and email.ts while the gate lived in index.ts. The
 * three mitigations below are the ones a review can only read, not run — so they
 * live here, where core.test.ts runs them.
 *
 * `send` is injected so a test can make it throw, 5xx, or refuse without a network.
 */
export async function sendNotes(
  svc: SupabaseClient,
  notes: NoteRow[],
  ctx: { spent: Set<string>; emailedItems: Set<string> },
  deps: {
    send: (
      data: CreditNoteEmailData,
      to: string | undefined,
      idempotencyKey: string,
    ) => Promise<SendResult>;
    balances: Map<string, number>;
    /** The admin's Resend: may claim a MAY_HAVE_SENT note. */
    manual?: boolean;
  },
): Promise<{ sent: number; firstSkip: SkipReason | null }> {
  let sent = 0;
  let firstSkip: SkipReason | null = null;

  for (const note of notes) {
    // ⚠ RISK 12 — ONE try/catch PER NOTE, INSIDE the loop. The claim and the
    // settle are database calls and can throw (transient DB error, or a missing
    // function if this is ever deployed ahead of its migration). With only an outer try, the first throw
    // silently drops every remaining parent in a rained-off class — verbatim
    // INVOICE_EMAIL_RETRY_PLAN.md RISK 4.
    try {
      const skip = skipReasonFor(note, ctx);
      if (skip) {
        if (!firstSkip) firstSkip = skip;
        console.log(`credit-note email skipped (${note.id}): ${skip}`);
        continue;
      }

      const { data, to } = buildEmailData(note, deps.balances);

      const claimed = await claimNote(svc, note.id, deps.manual ?? false);
      if (!claimed.ok) {
        // If the claim COMMITTED with only its response lost, the note reads
        // "Sending…" for 15 minutes and then becomes resendable — the lease heals
        // it. (Before 20260927000100 this stranded it as "Emailed" forever.)
        console.log(`credit-note email ${claimed.reason} (${note.id})`);
        continue;
      }
      const claim = claimed.claim;
      if (!claim) continue; // a concurrent call holds it, or it is not claimable

      // ⚠ RISK 5 — bar this invoice line for the rest of THIS run. Recorded on the
      // CLAIM, not on a successful send, so a released claim still does not let a
      // sibling note email the same line. Cross-run, UNIQUE(invoice_item_id)
      // (credit_notes_invoice_item_id_key, 20260818000100) makes a second note on
      // one line impossible, so the old post-claim sibling re-read is gone: with
      // one row per line, the row lock inside the claim RPC IS the line lock.
      ctx.emailedItems.add(note.invoice_item_id);

      // ⚠ RISK 7 / RISK 8 — settle from the typed outcome (settleActionFor). A
      // THROW is an unknown outcome like a 5xx: the claim is KEPT, and its lease
      // expires in 15 minutes — so the note is never stranded "Emailed" (sent_at
      // was never stamped), and a resend inside 24 h reuses the same key.
      let result: SendResult;
      try {
        result = await deps.send(data, to, creditNoteIdempotencyKey(note.id, claim));
      } catch (e) {
        result = { sent: false, outcome: "threw", reason: (e as Error).message };
      }
      const action = settleActionFor(result.outcome);
      await settleNote(svc, note.id, claim.claimedAt, action);
      if (action === "sent") {
        sent++;
      } else {
        console.log(
          `credit-note email not sent (${note.id}): ${result.outcome} — ${result.reason} [claim ${action}]`,
        );
      }
    } catch (e) {
      console.log(`credit-note email threw (${note.id}): ${(e as Error).message}`);
    }
  }

  return { sent, firstSkip };
}

/** The real sender, wired to Resend. Split out so sendNotes stays injectable. */
export function resendSender(apiKey: string | undefined) {
  return async (
    data: CreditNoteEmailData,
    to: string | undefined,
    idempotencyKey: string,
  ): Promise<SendResult> => {
    const { sendCreditNoteEmail } = await import("./email.ts");
    return await sendCreditNoteEmail({
      apiKey,
      to,
      subject: buildCreditNoteSubject(data),
      html: buildCreditNoteHtml(data),
      fromName: data.businessName,
      idempotencyKey,
    });
  };
}
