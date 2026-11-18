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
import { reduceUnclaimed } from "./domain/unclaimed.ts";
import { incompleteAttendanceStop } from "./domain/hardStop.ts";
import { dropDrawnLessons } from "./domain/drawn.ts";
import { writeInvoices } from "./domain/invoices.ts";
import { sealAndReport } from "./domain/seal.ts";
import * as repo from "./dao/billing.repo.ts";
import type {
  CreatedInvoice,
  GenerateOptions,
  GenerateResult,
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

  // ── Unclaimed attendance, reduced against settlements: domain/unclaimed.ts (B7) ──
  const { unclaimedStudents, unclaimedBillable } = await reduceUnclaimed(
    supabase,
    unclaimedAttendance
  );

  // ── Hard stop: nothing generates while any lesson is unmarked ─────────────
  // All-or-nothing on purpose. Billing the classes that happen to be complete
  // would give those parents an invoice, and the already-exists guard would
  // then permanently block the unmarked lessons from ever reaching one — so a
  // partial run converts a fixable gap into lost money. Returning before phase
  // 2 means no invoice, no credit drawn, no email, nothing to unwind.
  // The result: domain/hardStop.ts (B7). The decision stays HERE.
  if (blocking.length) {
    return incompleteAttendanceStop({
      tenantId, billingMonth, mode, force, blocking, classesIncomplete, deferredParents,
      unclaimedBillable, unclaimedStudents, log, tStart, tGuards,
    });
  }

  // ── Lessons a package already paid for: domain/drawn.ts (B8) ──────────────
  const drawn = await dropDrawnLessons(supabase, parentItems, {
    tenantId, billingMonth, mode, force, log,
  });
  if ("stop" in drawn) return drawn.stop;

  const tTally = performance.now();

  // ── Phase 2: domain/invoices.ts (B9) ───────────────────────────────────────
  const { invoicesCreated, invoiceWriteFailed } = await writeInvoices(supabase, parentItems, {
    tenantId, billingMonth, deferredParents, created, log,
  });

  // ── The seal + the result: domain/seal.ts (B9) ────────────────────────────
  return await sealAndReport(supabase, {
    tenantId, billingMonth, mode, force, classesComplete, classesIncomplete, deferredParents,
    unclaimedBillable, unclaimedStudents, invoicesCreated, invoiceWriteFailed, created, log,
    tStart, tGuards, tTally,
  });
}
