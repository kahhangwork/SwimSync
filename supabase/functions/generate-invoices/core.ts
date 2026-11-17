// Core billing engine for generate-invoices, extracted from the HTTP handler
// so it can be unit/integration-tested directly (see core.test.ts). The
// Deno.serve handler in index.ts does auth + client creation, then calls this.
//
//   • AUTO   — respects the business's auto switch and run day, the billing_periods
//              sealed guard, and the attendance-completeness gate; seals the
//              month when fully processed.
//   • MANUAL — ignores the switch/seal/gate; bills whatever is marked now.
//
// Structure: TWO PHASES, and the split matters.
//   Phase 1 — loop the classes and TALLY billable items into a single
//             cross-class `parentItems` map. No invoice is written here.
//   Phase 2 — after every class is tallied, create ONE invoice per parent.
//
// Creating invoices inside the class loop (the previous shape) under-billed
// any parent with children in two different classes: the invoice was created
// during the first class they appeared in, and the "already has an invoice"
// guard then skipped them for the second — silently dropping those lessons.
// PRD 5.5 requires all of a parent's eligible lessons on one invoice.
//
// Auto mode additionally DEFERS a parent entirely when any class one of their
// children is enrolled in has incomplete attendance: a partial invoice would
// be locked in by that same already-exists guard on tomorrow's retry, losing
// the rest permanently. Better to bill nothing and retry than to bill wrong.
// Both modes apply available credit FIFO via the credit_applications ledger.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../_shared/database.overrides.ts";
import {
  APP_TIMEZONE,
  dateInTimeZone,
  previousBillingMonth,
} from "./dates.ts";
import { runGuards } from "./domain/guards.ts";
import { readPhase1 } from "./domain/phase1.ts";
import { tallyClasses } from "./domain/tally.ts";
import * as repo from "./dao/billing.repo.ts";
import * as rpc from "./dao/billing.rpc.ts";
import type {
  CreatedInvoice,
  GenerateOptions,
  GenerateResult,
  RunTimings,
  UnclaimedStudent,
} from "./types.ts";
// Re-exported: index.ts, bench/run.ts and the tests import these from core.ts.
export { BILLABLE } from "./constants.ts";
export { readPaged } from "./dao/paging.ts";
export type {
  BlockingLesson,
  CreatedInvoice,
  CreatedInvoiceItem,
  GenerateOptions,
  GenerateResult,
  RunTimings,
  UnclaimedStudent,
} from "./types.ts";



/**
 * Generate invoices — for one tenant, or for every tenant independently.
 *
 * TENANT ISOLATION IN BILLING IS ENFORCED HERE, IN CODE. The engine runs with
 * the service-role key, which BYPASSES RLS entirely, so none of the policies in
 * 20260718000900 protect this path. Every query below is scoped by tenant_id
 * explicitly; if one is missed, the RLS work does not catch it.
 *
 * Each tenant is billed, gated, blocked and sealed in COMPLETE ISOLATION: one
 * school's forgotten lesson must never hold up an unrelated coach's invoices,
 * and one business finishing a month must never seal it for anyone else.
 */
export async function generateInvoices(
  supabase: SupabaseClient<Database>,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const billingMonthForResult =
    opts.billing_month && /^\d{4}-\d{2}$/.test(opts.billing_month)
      ? opts.billing_month
      : previousBillingMonth(opts.now instanceof Date ? opts.now : new Date());

  // Scoped run: one tenant, and the result IS that tenant's result — the admin
  // panel's shape is unchanged.
  if (opts.tenant_id) {
    return await generateForTenant(supabase, opts.tenant_id, opts);
  }

  // Unscoped (cron): every tenant, independently.
  const { data: tenantRows, error: tErr } = await repo.listTenantIds(supabase);
  if (tErr) throw new Error(tErr.message);

  const perTenant: GenerateResult[] = [];
  for (const t of tenantRows ?? []) {
    perTenant.push(await generateForTenant(supabase, t.id as string, opts));
  }

  const created = perTenant.flatMap((r) => r.created ?? []);
  const blocking = perTenant.flatMap((r) => r.blocking ?? []);
  const invoicesCreated = perTenant.reduce((n, r) => n + (r.invoices_created ?? 0), 0);

  return {
    billing_month: billingMonthForResult,
    mode: opts.mode === "manual" ? "manual" : "auto",
    forced: opts.force === true,
    // An aggregate status, deliberately coarse: per-tenant detail is the thing
    // to act on, and flattening several tenants' outcomes into one word would
    // hide the tenant that actually needs attention.
    status: `processed ${perTenant.length} tenant(s)`,
    invoices_created: invoicesCreated,
    blocking,
    created,
    per_tenant: perTenant,
  };
}

async function generateForTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const tStart = performance.now();
  const mode = opts.mode === "manual" ? "manual" : "auto";
  const force = opts.force === true;
  // Guarded so a stray `now` in a JSON body can never shift billing.
  const now = opts.now instanceof Date ? opts.now : new Date();

  // ── Guards: domain/guards.ts (B4) ─────────────────────────────────────────
  const guarded = await runGuards(supabase, tenantId, opts, mode, force, now);
  if ("stop" in guarded) return guarded.stop;
  const { billingMonth, monthStart, monthEnd } = guarded.go;

  // ── Phase 1: tally billable items across ALL classes ──────────────────────
  // Ordered so a mixed-class invoice's line items land in a stable order (they
  // are persisted to invoice_items and rendered in the email).
  //
  // INACTIVE CLASSES ARE INCLUDED, and `is_active` no longer means anything to
  // billing — it is SCHEDULING state. A class retired at month end used to drop
  // its already-taught lessons out of the run silently, a hole exactly where
  // someone is tidying up (BACKLOG #6).
  //
  // What this scan feeds is not only the tally: it also decides which classes
  // enter the completeness gate below, so widening it widens what can BLOCK a
  // month. That half is deliberately NOT widened — see `lastScheduledDate` in
  // the loop. Retired classes with nothing recorded and nothing due fall out at
  // the `continue` there — but THREE queries in, not one: sessions, bookings and
  // enrolments all run above it. A tenant that has retired sixty classes over
  // the years pays that on every run, for ever, and nothing prunes it. Filed
  // rather than fixed here: it is a cost, not a correctness bug, and the shape
  // that would fix it (a `deactivated_at` cut-off in the scan) is one more place
  // for the RISK 1 deadlock to hide.
  //
  // (2026-11-16: those per-class queries are now batched — one read per table
  // for the whole tenant-month — so a retired class no longer costs a round
  // trip. Only its in-memory pass remains, which is trivial.)
  const tGuards = performance.now();
  // ── Phase 1 reads: domain/phase1.ts (B5) ─────────────────────────────────
  const phase1 = await readPhase1(supabase, tenantId, monthStart, monthEnd);

  const log: unknown[] = [];
  const created: CreatedInvoice[] = []; // newly-created invoices, for emailing
  let invoicesCreated = 0;
  // A month with a failed write must never be sealed — sealing would lock out
  // the very retry that would have fixed it.
  let invoiceWriteFailed = false;
  // Today in the APP timezone, not UTC — the clamp below decides whether a
  // lesson counts as "should already have happened", and the UTC date is the
  // previous day in SGT before 08:00 (gotcha §7.7).
  const todayDate = dateInTimeZone(now, APP_TIMEZONE);

  // ── The class loop: domain/tally.ts (B6) ──────────────────────────────────
  const {
    parentItems,
    deferredParents,
    blocking,
    classesIncomplete,
    classesComplete,
    unclaimedAttendance,
  } = tallyClasses({ ...phase1, tenantId, monthStart, monthEnd, todayDate, log });

  // ── Reduce unclaimed attendance against settlements ───────────────────────
  // A settlement says money for this student was received outside SwimSync, or
  // written off. It is EFFECTIVE-DATED: it covers attendance on or before
  // settled_through and nothing after, so settling once cannot blanket-
  // authorise every future lesson. A reversed settlement covers nothing —
  // reversal exists because a parent who turns up two months after a write-off
  // must be recoverable.
  const unclaimedStudentIds = [
    ...new Set(unclaimedAttendance.map((u) => u.student_id)),
  ];

  let unclaimedStudents: UnclaimedStudent[] = [];
  if (unclaimedStudentIds.length) {
    const { data: settlements } = await repo.readSettlements(supabase, unclaimedStudentIds);

    // Latest live settlement per student — the furthest date any of them covers.
    const coveredThrough = new Map<string, string>();
    for (const st of settlements ?? []) {
      const prev = coveredThrough.get(st.student_id as string);
      const through = st.settled_through as string;
      if (!prev || through > prev) {
        coveredThrough.set(st.student_id as string, through);
      }
    }

    // String comparison is correct and deliberate: both sides are YYYY-MM-DD,
    // which sorts lexicographically. No Date object is constructed, so there is
    // no timezone to get wrong (§7.7).
    const unsettled = unclaimedAttendance.filter((u) => {
      const through = coveredThrough.get(u.student_id);
      return !through || u.session_date > through;
    });

    if (unsettled.length) {
      const { data: names } = await repo.readUnsettledNames(supabase, unsettled);
      const nameById = new Map(
        (names ?? []).map((n) => [n.id as string, n.full_name as string])
      );

      const byStudent = new Map<string, string[]>();
      for (const u of unsettled) {
        const dates = byStudent.get(u.student_id) ?? [];
        dates.push(u.session_date);
        byStudent.set(u.student_id, dates);
      }

      unclaimedStudents = [...byStudent.entries()]
        .map(([student_id, dates]) => {
          const sorted = [...dates].sort();
          return {
            student_id,
            student_name: nameById.get(student_id) ?? null,
            lessons: sorted.length,
            earliest_session_date: sorted[0],
            latest_session_date: sorted[sorted.length - 1],
          };
        })
        .sort((a, b) =>
          a.earliest_session_date.localeCompare(b.earliest_session_date)
        );
    }
  }

  const unclaimedBillable = unclaimedStudents.reduce(
    (sum, u) => sum + u.lessons,
    0
  );

  // ── Hard stop: nothing generates while any lesson is unmarked ─────────────
  // All-or-nothing on purpose. Billing the classes that happen to be complete
  // would give those parents an invoice, and the already-exists guard would
  // then permanently block the unmarked lessons from ever reaching one — so a
  // partial run converts a fixable gap into lost money. Returning before phase
  // 2 means no invoice, no credit drawn, no email, nothing to unwind.
  if (blocking.length) {
    blocking.sort(
      (a, b) =>
        a.session_date.localeCompare(b.session_date) ||
        a.class_title.localeCompare(b.class_title)
    );
    return {
      tenant_id: tenantId,
      billing_month: billingMonth,
      mode,
      forced: force,
      status: "incomplete_attendance",
      invoices_created: 0,
      classes_still_incomplete: classesIncomplete,
      parents_deferred: deferredParents.size,
      // Reported even on the blocked path: an admin fixing unmarked lessons
      // should learn about the unclaimed ones in the same trip, not discover
      // them on the next run.
      unclaimed_billable: unclaimedBillable,
      ...(unclaimedStudents.length ? { unclaimed_students: unclaimedStudents } : {}),
      sealed: false,
      blocking,
      message:
        `Cannot generate invoices for ${billingMonth}: ${blocking.length} lesson(s) still have unmarked attendance. Mark them — or mark them cancelled if the lesson did not run — then generate again.`,
      results: log,
      timings_ms: timingsSince(tStart, tGuards, performance.now(), null),
    };
  }

  // ── Lessons a package ALREADY paid for at marking ─────────────────────────
  // docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md. Attendance triggers draw
  // the package the moment a lesson is marked (package_candidates_for is the one
  // matching rule), so a drawn lesson is PAID and must never reach an invoice
  // line (the DB backstop on invoice_items would refuse it — PK002 — and fail
  // the run's write). The engine matches no package itself: the pay-at-the-run
  // matcher and its tenants.package_draw_at_marking switch were removed
  // (BACKLOG Wave 9 item 9). Every remaining item is ad-hoc at its class price.
  //
  // ⚠ FAIL CLOSED (RISK 1, §7.325): an unreadable drawn set returns
  // package_mode_unreadable — no invoice, no seal, never a throw (§7.265). Do NOT
  // default the drawn set to empty: that bills a lesson the family already paid
  // for.
  const itemSessionIds = [
    ...new Set([...parentItems.values()].flat().map((i) => i.lesson_session_id)),
  ];
  const drawnKeys = new Set<string>();
  // Chunked: an .in() list rides the URL, and a month of sessions can be long.
  for (let i = 0; i < itemSessionIds.length; i += 200) {
    const { data: drawnRows, error: drawnErr } = await repo.readDrawnChunk(supabase, itemSessionIds, i);
    if (drawnErr || !drawnRows) {
      return packageModeUnreadable(
        drawnErr ? drawnErr.message : "the package draws could not be read"
      );
    }
    for (const r of drawnRows) {
      drawnKeys.add(`${r.lesson_session_id}:${r.student_id}`);
    }
  }
  if (drawnKeys.size) {
    for (const [parentId, items] of parentItems) {
      parentItems.set(
        parentId,
        items.filter((i) => !drawnKeys.has(`${i.lesson_session_id}:${i.student_id}`))
      );
    }
  }

  function packageModeUnreadable(reason: string): GenerateResult {
    return {
      tenant_id: tenantId,
      billing_month: billingMonth,
      mode,
      forced: force,
      status: "package_mode_unreadable",
      invoices_created: 0,
      sealed: false,
      message:
        `Could not read which lessons a package has already paid for (${reason}). ` +
        `No invoices were generated and the month was left open — generate again.`,
      results: log,
    };
  }

  const tTally = performance.now();

  // ── Phase 2: create ONE invoice per parent, across all their classes ──────
  // Two READS that used to run per parent are batched here, once for the
  // tenant-month: which parents already have an invoice, and every balance.
  // The WRITES stay per parent and in the same order — insert, items, credit —
  // so one parent's failed write still skips only that parent (and holds the
  // seal), exactly as before.
  //
  // What batching moves: these rows are read just before the loop instead of
  // just before each parent's insert — a window of one run (~ms on a
  // same-region call). Both reads were already only advisory:
  //   • "already has an invoice" — UNIQUE (parent_id, tenant_id, billing_month)
  //     is the real guard. A concurrent run that bills a parent inside the
  //     window makes THIS run's insert fail (logged, month not sealed by this
  //     run) instead of skipping it. No double bill either way.
  //   • the balance — an ESTIMATE; apply_credit_to_invoice locks and draws from
  //     the real rows. A credit note issued inside the window may be left for
  //     next month's invoice instead of this one (it is never lost or doubled).
  // ⚠ FAIL CLOSED: an unreadable existing-invoice set would bill duplicates
  // into the UNIQUE guard, and an unreadable balance would skip credit; both
  // throw (readPaged) before anything is written.
  const billingAny = [...parentItems.values()].some((items) => items.length > 0);
  const [existingInvoices, balanceRows] = billingAny
    ? await Promise.all([
        repo.readExistingInvoices(supabase, tenantId, billingMonth),
        repo.readBalances(supabase, tenantId),
      ])
    : [[], []];
  const alreadyInvoiced = new Set(existingInvoices.map((i) => i.parent_id));
  const balanceByParent = new Map(balanceRows.map((b) => [b.parent_id, b]));
  // Note: deferredParents can no longer be populated on a run that reaches
  // here (the hard stop above returns first). The check below is kept as an
  // inner guard — it is correct, it costs nothing, and it is the right
  // behaviour if the block is ever relaxed to per-parent.
  // Sorted for deterministic ordering across runs.
  for (const parentId of [...parentItems.keys()].sort()) {
    const items = parentItems.get(parentId)!;
    if (!items.length) continue;

    // A child of theirs sits in a class with unmarked attendance — bill
    // nothing this run rather than lock in a partial invoice.
    if (deferredParents.has(parentId)) {
      log.push({
        parent_id: parentId,
        billing_month: billingMonth,
        skipped: "deferred_incomplete_class",
        pending_items: items.length,
      });
      continue;
    }

    // Chronological, so the invoice and its email read in lesson order even
    // when items come from several classes.
    items.sort(
      (a, b) =>
        a.session_date.localeCompare(b.session_date) ||
        a.class_title.localeCompare(b.class_title) ||
        a.student_id.localeCompare(b.student_id)
    );

    // Skip if this parent already has an invoice for the billing month.
    // Cannot fire within a run any more (each parent is visited exactly
    // once) — this guards RE-RUNS: the daily cron on an unsealed month, or
    // a manual run after an auto one. Removing it reopens double-billing.
    // (batched above — one read for the tenant-month)
    if (alreadyInvoiced.has(parentId)) {
      log.push({
        parent_id: parentId,
        billing_month: billingMonth,
        skipped: "already_exists",
      });
      continue;
    }

    // Credit available FROM THIS TENANT. Never crosses: a note earned at a
    // school is not spendable against a private coach's invoice, or one
    // business ends up paying another's bill. Pools freely across this parent's
    // children WITHIN the tenant.
    // (batched above; no row = no balance, as maybeSingle() returned null)
    const balanceRow = balanceByParent.get(parentId);

    const available = Number(balanceRow?.credit_balance ?? 0);
    // A DEBIT (parent owes us, from a voided-then-paid credit — 20260822000100)
    // is folded onto THIS invoice by apply_credit_to_invoice, which draws credit
    // against the debit-inclusive base so the two net. The values below are an
    // ESTIMATE for the insert; the RPC trues up net/credit/balance_adjustment.
    const debit = Number(balanceRow?.debit_balance ?? 0);
    // Every line is ad-hoc (a package-funded lesson was drawn at marking and
    // dropped above), so credit notes apply to the whole gross.
    const gross = items.reduce((s, i) => s + i.amount, 0);
    const credit = Math.min(available, Math.max(gross, 0));
    const net = gross - credit;

    // Insert invoice
    // package_applied 0 and status from net: see the dao. due_date comes back from the
    // BEFORE INSERT trigger — never sent, never computed here.
    const { data: invoice, error: invErr } = await repo.insertInvoice(
      supabase, parentId, tenantId, billingMonth, gross, credit, net
    );

    if (invErr || !invoice) {
      invoiceWriteFailed = true;
      log.push({
        parent_id: parentId,
        error: invErr?.message ?? "invoice insert failed",
      });
      continue;
    }

    // Insert invoice items. A failure here is NOT cosmetic: the invoice row
    // (carrying gross) is already committed and there is no transaction across
    // these calls, so silently continuing would draw down credit and email a
    // parent an invoice with no line items — and the credit-note trigger,
    // which keys off invoice_items, could never fire for those lessons.
    // Stop before touching money.
    const { error: itemsErr } = await repo.insertInvoiceItems(supabase, items, invoice);

    if (itemsErr) {
      invoiceWriteFailed = true;
      log.push({
        parent_id: parentId,
        invoice_id: invoice.id,
        error: `invoice_items insert failed: ${itemsErr.message}`,
      });
      continue;
    }

    // ── Draw credit + true up the invoice in ONE DB transaction (Item 2) ─────
    // apply_credit_to_invoice (20260818000200) locks the balance row and the
    // notes FOR UPDATE — serialising against the credit-note trigger's
    // un-correction, which also takes FOR UPDATE (20260818000100), and against
    // Item 3's void — draws FIFO, and writes the invoice's OWN
    // credit_applied/net_amount/status. It is idempotent per invoice, so the
    // §7.17 retry path cannot draw the same credit twice. The engine keeps only
    // the RETURNED allocation, for the email/log figures: `credit`/`net`
    // computed above were an ESTIMATE for the insert, which the RPC has now
    // trued up. They agree except when the pooled balance and the note ledger
    // disagree — exactly the double-decrement window this closes.
    // Only when the estimate drew something: with credit === 0 nothing is drawn
    // and the insert's credit_applied/net (both from the same estimate) are
    // already the truth, so there is no discrepancy to reconcile and no
    // double-draw window to guard — skip the round-trip.
    let creditApplied = credit;
    let balanceAdjustment = 0;
    let netApplied = gross - creditApplied;
    if (credit > 0 || debit > 0) {
      const { data: allocated, error: creditErr } = await rpc.applyCreditToInvoice(supabase, invoice);
      if (creditErr) {
        invoiceWriteFailed = true;
        log.push({
          parent_id: parentId,
          invoice_id: invoice.id,
          error: `apply_credit_to_invoice failed: ${creditErr.message}`,
        });
        continue;
      }
      creditApplied = Number(allocated ?? 0);
      // Re-read the trued-up invoice: the RPC folded any pending debit into
      // net_amount and set balance_adjustment. These — not the pre-fold estimate
      // — are the authoritative figures for the email/log.
      const { data: settled, error: readErr } = await repo.readSettledInvoice(supabase, invoice);
      if (readErr || !settled) {
        invoiceWriteFailed = true;
        log.push({
          parent_id: parentId,
          invoice_id: invoice.id,
          error: `re-read settled invoice failed: ${readErr?.message ?? "no row"}`,
        });
        continue;
      }
      balanceAdjustment = Number(settled.balance_adjustment ?? 0);
      netApplied = Number(settled.net_amount ?? netApplied);
    }

    invoicesCreated++;
    created.push({
      invoice_id: invoice.id,
      parent_id: parentId,
      tenant_id: tenantId,
      billing_month: billingMonth,
      gross,
      package: 0,
      credit: creditApplied,
      balance_adjustment: balanceAdjustment,
      net: netApplied,
      due_date: invoice.due_date as string,
      items: items.map((i) => ({
        student_id: i.student_id,
        session_date: i.session_date,
        class_title: i.class_title,
        amount: i.amount,
      })),
    });
    log.push({
      parent_id: parentId,
      invoice_id: invoice.id,
      billing_month: billingMonth,
      gross,
      package: 0,
      credit: creditApplied,
      net: netApplied,
    });
  }

  // ── Seal the billing month once it is genuinely finished ──────────────────
  // Mode-independent: an early MANUAL run that happens to complete the month
  // seals it too, so the daily cron then returns "already_complete" instead of
  // re-walking every class. (Previously only auto sealed, so a month finished
  // by hand stayed open and was reprocessed until the cron got to it.)
  //
  // Safe only because completeness is now measured even under force — without
  // that, a forced run would report 0 incomplete classes unconditionally and
  // seal every month regardless of reality, locking out unmarked lessons for
  // good. The four conditions are the whole safety property:
  //   • at least one class actually reckoned with (there WAS work to finish)
  //   • no class left unmarked          (nothing still to bill)
  //   • no parent deferred              (nobody skipped this run)
  //   • no failed invoice write         (nothing to retry)
  //
  // The first condition is what stops a VACUOUS seal. The other three are all
  // trivially true when the run found nothing at all — no classes yet, no
  // students yet, or (the common one) no lesson_sessions in the month, since
  // sessions are created lazily by attendance marking and therefore do not
  // exist for a month nobody has marked. Without this guard, running
  // generation on an empty or not-yet-marked month reported "0 invoices" and
  // then sealed it, locking out every real invoice that month would later
  // have produced. "Nothing happened" is not the same as "everything is
  // finished", and only the latter may close a month.
  //
  // If a month is ever sealed wrongly, delete its billing_periods row — see
  // INVOICE_RUNBOOK.md.
  // A FIFTH condition joins the four above: no billable lesson may be left
  // with nobody to bill. Without it a trial walk-in or an un-registered
  // family's lessons are dropped from the invoice AND the month closes over
  // them, so they can never be billed even after the parent registers — the
  // §7.8/§7.13/§7.32 permanent-underbill shape through a fourth door.
  //
  // The escape hatch is a SETTLEMENT, not an override: the admin records that
  // the money arrived outside SwimSync, or writes it off. Same philosophy as
  // the attendance gate — add a way to RECORD the thing, never a way to skip it.
  const monthFinished =
    classesComplete > 0 &&
    classesIncomplete === 0 &&
    deferredParents.size === 0 &&
    unclaimedBillable === 0 &&
    !invoiceWriteFailed;

  if (monthFinished) {
    // Sealed for THIS TENANT only. The key is (tenant_id, billing_month): a
    // single billing_month key would have let one business finishing July close
    // it for every other tenant, who would then silently bill nothing.
    //
    // DO NOTHING on conflict, not a plain insert: a forced run bypasses the
    // sealed-month guard, so a second one would otherwise hit a duplicate key.
    // The first seal is the true one — its invoices_issued reflects the run
    // that actually did the work.
    await repo.sealBillingMonth(supabase, tenantId, billingMonth, invoicesCreated);
  }

  return {
    tenant_id: tenantId,
    billing_month: billingMonth,
    mode,
    forced: force,
    invoices_created: invoicesCreated,
    classes_still_incomplete: classesIncomplete,
    // Every parent blocked by an incomplete class — NOT just those reaching
    // phase 2. A parent whose only class is unmarked is never tallied at all,
    // so counting inside the phase-2 loop reported 0 while the whole month was
    // blocked, which is exactly the silent case this number exists to surface.
    parents_deferred: deferredParents.size,
    unclaimed_billable: unclaimedBillable,
    ...(unclaimedStudents.length ? { unclaimed_students: unclaimedStudents } : {}),
    sealed: monthFinished,
    status: monthFinished
      ? "complete — billing month sealed"
      : // Everything else is done; the only thing holding the month open is
      // attendance nobody can be invoiced for. Named distinctly so the admin
      // is told to invite a parent or record a settlement, rather than being
      // sent hunting for an unmarked lesson that does not exist.
      classesIncomplete === 0 && deferredParents.size === 0 && unclaimedBillable > 0
      ? `open — ${unclaimedBillable} billable lesson(s) have no parent account to bill`
      : // Nothing to reckon with at all. Called out as its own status because
      // it is NOT "attendance still incomplete" (there is no attendance to be
      // incomplete) and NOT a finished month — it usually means no lesson has
      // been marked for this month yet, or there are no classes/students.
      classesComplete === 0 && classesIncomplete === 0
      ? "nothing_to_bill"
      : mode === "manual"
      ? "manual run complete — month left open, attendance still incomplete"
      : deferredParents.size > 0
      ? `partial — ${deferredParents.size} parent(s) deferred, will retry tomorrow`
      : "partial — will retry tomorrow",
    ...(classesComplete === 0 && classesIncomplete === 0
      ? {
          message:
            `No lessons are recorded for ${billingMonth}, so there is nothing to invoice. ` +
            `The month has been left OPEN — generate again once attendance is marked.`,
        }
      : {}),
    results: log,
    created,
    timings_ms: timingsSince(tStart, tGuards, tTally, performance.now()),
  };
}

/** Whole milliseconds per part of a run; `tInvoices` null when phase 2 never ran. */
function timingsSince(
  tStart: number,
  tGuards: number,
  tTally: number,
  tInvoices: number | null
): RunTimings {
  const end = tInvoices ?? tTally;
  return {
    guards: Math.round(tGuards - tStart),
    tally: Math.round(tTally - tGuards),
    invoices: tInvoices === null ? 0 : Math.round(tInvoices - tTally),
    total: Math.round(end - tStart),
  };
}
