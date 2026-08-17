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
  shouldResetClaim,
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
  "tenants(display_name, logo_url)";

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
};

/** PostgREST returns an embedded row as an object or a 1-element array. */
export function one<T>(v: unknown): T | undefined {
  return (Array.isArray(v) ? v[0] : v) as T | undefined;
}

export type Candidates =
  | { ok: true; notes: NoteRow[] }
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
    .is("email_sent_at", null);
  if (error) return { ok: false, reason: `discovery failed: ${error.message}` };
  return { ok: true, notes: (data ?? []) as unknown as NoteRow[] };
}

/** One unsent note by id, for the admin Resend path. */
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
  return { ok: true, notes: data ? [data as unknown as NoteRow] : [] };
}

/**
 * Which of these notes are spent, in whole or in part?
 *
 * ⚠ RISK 2 — `status` alone is insufficient: the engine leaves status 'available'
 * while a note is PARTLY drawn down (engine core.ts:1437-1445), so
 * credit_applications is the only reliable signal.
 */
export async function findSpentNoteIds(
  svc: SupabaseClient,
  noteIds: string[],
): Promise<{ ok: true; spent: Set<string> } | { ok: false; reason: string }> {
  if (!noteIds.length) return { ok: true, spent: new Set() };
  const { data, error } = await svc
    .from("credit_applications")
    .select("credit_note_id")
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

/**
 * Atomically claim ONE note for sending. Returns true only for the caller that won.
 *
 * The conditional UPDATE is the whole concurrency story: a second caller racing for
 * the same row (a coach saving twice, or an admin pressing Resend while the coach's
 * save is in flight) matches zero rows and gets false back.
 */
export async function claimNote(
  svc: SupabaseClient,
  noteId: string,
): Promise<{ ok: true; claimed: boolean } | { ok: false; reason: string }> {
  const { data, error } = await svc
    .from("credit_notes")
    // toISOString() writes a timestamptz — it does NOT derive a calendar date, so
    // this is not the §7.7 / ⚠ RISK 13 bug. Same as the invoice precedent's claimedAt.
    .update({ email_sent_at: new Date().toISOString() })
    .eq("id", noteId)
    .is("email_sent_at", null)
    .select("id");
  if (error) return { ok: false, reason: `claim failed: ${error.message}` };
  return { ok: true, claimed: Boolean(data && data.length) };
}

/** Release a claim so the note can be resent. */
export async function releaseNote(
  svc: SupabaseClient,
  noteId: string,
): Promise<void> {
  const { error } = await svc
    .from("credit_notes")
    .update({ email_sent_at: null })
    .eq("id", noteId);
  if (error) console.log(`credit-note email reset failed (${noteId}): ${error.message}`);
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
 * Claim → send → release, once per note.
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
    ) => Promise<SendResult>;
    balances: Map<string, number>;
  },
): Promise<{ sent: number; firstSkip: SkipReason | null }> {
  let sent = 0;
  let firstSkip: SkipReason | null = null;

  for (const note of notes) {
    // ⚠ RISK 12 — ONE try/catch PER NOTE, INSIDE the loop. The claim is a raw
    // UPDATE and can throw (transient DB error, or a missing column if this is ever
    // deployed ahead of its migration). With only an outer try, the first throw
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

      const claim = await claimNote(svc, note.id);
      if (!claim.ok) {
        // The UPDATE may have COMMITTED with only its response lost, which would
        // leave the row stamped-but-unsent: rendered "Emailed", filtered out of
        // findUnsentById, unreachable by Resend. releaseNote is unconditional, so
        // it is safe when the claim never landed.
        console.log(`credit-note email ${claim.reason} (${note.id}) — releasing in case it committed`);
        await releaseNote(svc, note.id);
        continue;
      }
      if (!claim.claimed) continue; // a concurrent call won the race

      // ⚠ RISK 5 — bar this invoice line for the rest of THIS run. The DB query
      // only knows about notes emailed on an EARLIER run; two unsent notes on one
      // line (what a re-toggled correction produces) would otherwise both pass.
      // Recorded on the CLAIM, not on a successful send, so a released claim still
      // does not let a sibling note email the same line.
      ctx.emailedItems.add(note.invoice_item_id);

      // ⚠ RISK 5, CONCURRENCY — the guarantee is "one email per line per run", plus
      // this best-effort cross-run check. It is NOT "ever", and the plan used to
      // over-claim that.
      //
      // The hole: two notes N1/N2 on one invoice_item_id, a coach save and an admin
      // Resend firing together. Both read emailedItems as empty, then claim
      // DIFFERENT ROWS — so both claims succeed and two emails go out for one $30
      // lesson, both quoting the doubled balance. A condition evaluated before the
      // claim is not a claim.
      //
      // Re-reading AFTER our own claim narrows it to the interval between the two
      // claims: whichever ran second now sees the other's stamp and backs out. It
      // cannot close it completely — that needs a partial unique index on
      // credit_notes(invoice_item_id) WHERE email_sent_at IS NOT NULL, filed with
      // the duplicate-note item in BACKLOG.md.
      const sibling = await findEmailedInvoiceItemIds(svc, [note.invoice_item_id]);
      if (sibling.ok) {
        const { data: mine } = await svc
          .from("credit_notes")
          .select("id")
          .eq("invoice_item_id", note.invoice_item_id)
          .not("email_sent_at", "is", null);
        const stamped = (mine ?? []) as { id: string }[];
        if (stamped.length > 1) {
          // Someone else stamped this line too. Back out rather than double-send.
          console.log(
            `credit-note email backing out (${note.id}): another note on invoice line ` +
              `${note.invoice_item_id} was claimed concurrently`,
          );
          await releaseNote(svc, note.id);
          continue;
        }
      }

      // ⚠ RISK 8 — try/finally so a THROW cannot leave a stamped-but-unsent row.
      let release = true;
      try {
        const result = await deps.send(data, to);
        if (result.sent) {
          sent++;
          release = false;
        } else {
          // ⚠ RISK 7 — release ONLY on outcomes that provably never left our side.
          // A thrown fetch or a 5xx may already have been DELIVERED.
          release = shouldResetClaim(result.outcome);
          console.log(
            `credit-note email not sent (${note.id}): ${result.outcome} — ${result.reason}` +
              (release ? "" : " [claim kept: may have been delivered]"),
          );
        }
      } finally {
        if (release) await releaseNote(svc, note.id);
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
  ): Promise<SendResult> => {
    const { sendCreditNoteEmail } = await import("./email.ts");
    return await sendCreditNoteEmail({
      apiKey,
      to,
      subject: buildCreditNoteSubject(data),
      html: buildCreditNoteHtml(data),
      fromName: data.businessName,
    });
  };
}
