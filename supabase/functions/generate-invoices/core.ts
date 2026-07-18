// Core billing engine for generate-invoices, extracted from the HTTP handler
// so it can be unit/integration-tested directly (see core.test.ts). The
// Deno.serve handler in index.ts does auth + client creation, then calls this.
//
//   • AUTO   — respects the app_settings auto switch, the billing_periods
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

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { previousBillingMonth } from "./dates.ts";

// Attendance statuses that result in a charge to the parent.
// Per PRD 5.4: only Present and Paid Trial are billable.
export const BILLABLE = new Set(["present", "trial_paid"]);

export type GenerateOptions = {
  mode?: string;
  force?: boolean;
  billing_month?: string;
};

// One billed lesson on a created invoice — enough for an itemized email.
export type CreatedInvoiceItem = {
  student_id: string;
  session_date: string;
  class_title: string;
  amount: number;
};

// A newly-created invoice, surfaced so the caller (index.ts) can email the
// parent. The engine itself sends nothing — it stays pure and testable; the
// handler orchestrates delivery from this list. Only genuinely-new invoices
// appear here (parents with an existing invoice for the month are skipped),
// so emailing this list can never double-send.
//
// `items` may span MULTIPLE CLASSES — one entry per parent per run, carrying
// every billable lesson across all their children. email.ts already renders
// per-item class titles, so this needs no special handling there.
export type CreatedInvoice = {
  invoice_id: string;
  parent_id: string;
  billing_month: string;
  gross: number;
  credit: number;
  net: number;
  items: CreatedInvoiceItem[];
};

export type GenerateResult = {
  billing_month: string;
  status: string;
  mode?: string;
  forced?: boolean;
  invoices_created?: number;
  classes_still_incomplete?: number;
  parents_deferred?: number;
  message?: string;
  results?: unknown[];
  created?: CreatedInvoice[];
};

export async function generateInvoices(
  supabase: SupabaseClient,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const mode = opts.mode === "manual" ? "manual" : "auto";
  const force = opts.force === true;

  // Billing month: explicit YYYY-MM, else the previous calendar month in the
  // app timezone (SGT by default). Derived via previousBillingMonth() rather
  // than new Date()'s local fields — Edge Functions run in UTC, which bills the
  // wrong month at the SGT day boundary (the 1am SGT cron is 17:00 UTC the day
  // before). See dates.ts.
  let billingMonth: string;
  if (opts.billing_month && /^\d{4}-\d{2}$/.test(opts.billing_month)) {
    billingMonth = opts.billing_month;
  } else {
    billingMonth = previousBillingMonth();
  }
  const [by, bm] = billingMonth.split("-").map(Number);
  const monthStart = `${billingMonth}-01`;
  const lastDay = new Date(by, bm, 0).getDate();
  const monthEnd = `${billingMonth}-${String(lastDay).padStart(2, "0")}`;

  // ── Auto switch (auto mode only) ──────────────────────────────────────────
  if (mode === "auto") {
    const { data: setting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "auto_invoice_enabled")
      .maybeSingle();
    const enabled = setting?.value === true || setting?.value === "true";
    if (!enabled) {
      return {
        billing_month: billingMonth,
        status: "auto_disabled",
        message:
          "Automatic invoice generation is turned off. Use manual generation from the admin panel.",
      };
    }
  }

  // ── Sealed-month guard (skipped when forced) ──────────────────────────────
  if (!force) {
    const { data: billingPeriod } = await supabase
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", billingMonth)
      .maybeSingle();

    if (billingPeriod) {
      return {
        billing_month: billingMonth,
        status: "already_complete",
        message:
          "Invoices for this billing month were previously finalised. Skipping.",
      };
    }
  }

  // ── Phase 1: tally billable items across ALL classes ──────────────────────
  // Ordered so a mixed-class invoice's line items land in a stable order (they
  // are persisted to invoice_items and rendered in the email).
  const { data: classes, error: clsErr } = await supabase
    .from("classes")
    .select("id, title, price_per_lesson")
    .eq("is_active", true)
    .order("id");

  if (clsErr) throw new Error(clsErr.message);

  type InvoiceItem = {
    student_id: string;
    lesson_session_id: string;
    attendance_status: string;
    amount: number;
    class_title: string;
    session_date: string;
  };

  const log: unknown[] = [];
  const created: CreatedInvoice[] = []; // newly-created invoices, for emailing
  // Billable items for the whole run, keyed by parent — the cross-class tally
  // that makes one-invoice-per-parent possible.
  const parentItems = new Map<string, InvoiceItem[]>();
  // Parents with a child enrolled in a class whose attendance is incomplete.
  // Tracked from ENROLMENTS, not from billable items: a class may contribute
  // zero items precisely because nobody marked it.
  const deferredParents = new Set<string>();
  let classesIncomplete = 0; // classes skipped because attendance not fully marked
  let invoicesCreated = 0;

  for (const cls of classes ?? []) {
    // Sessions for this class within the billing month
    const { data: sessions } = await supabase
      .from("lesson_sessions")
      .select("id, session_date")
      .eq("class_id", cls.id)
      .gte("session_date", monthStart)
      .lte("session_date", monthEnd)
      .order("session_date");

    if (!sessions?.length) continue; // no lessons this month, nothing to bill

    const sessionIds = sessions.map((s) => s.id);
    const sessionDateMap: Record<string, string> = Object.fromEntries(
      sessions.map((s) => [s.id, s.session_date])
    );

    // Active enrolments
    const { data: enrolments } = await supabase
      .from("student_class_enrolments")
      .select("student_id")
      .eq("class_id", cls.id)
      .eq("is_active", true);

    if (!enrolments?.length) continue;

    const activeStudentIds = enrolments.map((e) => e.student_id);

    // All attendance rows for these sessions
    const { data: attRows } = await supabase
      .from("attendance")
      .select("lesson_session_id, student_id, status")
      .in("lesson_session_id", sessionIds);

    // ── Gate: every active student must have a row for every session ────────
    // Enforced only for automatic runs. Manual/force runs bill whatever
    // attendance has been marked so far.
    const attSet = new Set(
      (attRows ?? []).map((a) => `${a.lesson_session_id}:${a.student_id}`)
    );
    let complete = true;
    outer: for (const sessId of sessionIds) {
      for (const stuId of activeStudentIds) {
        if (!attSet.has(`${sessId}:${stuId}`)) {
          complete = false;
          break outer;
        }
      }
    }

    // Parents of this class's students. Queried BEFORE the gate check because
    // the incomplete branch needs it to record who must be deferred.
    const { data: parentStudents } = await supabase
      .from("parent_students")
      .select("parent_id, student_id")
      .in("student_id", activeStudentIds);

    if (!complete && !force) {
      classesIncomplete++;
      // Every parent with a child in this class is deferred — including those
      // whose billable items all came from other, fully-marked classes. A
      // partial invoice now is permanent: tomorrow's retry hits the
      // already-exists guard and the missing lessons are never billed.
      for (const ps of parentStudents ?? []) deferredParents.add(ps.parent_id);
      log.push({
        class_id: cls.id,
        title: cls.title,
        skipped: "incomplete_attendance",
        parents_deferred: new Set((parentStudents ?? []).map((p) => p.parent_id))
          .size,
      });
      continue;
    }

    // ── Tally this class's billable items into the cross-class map ──────────
    const attByKey: Record<string, string> = Object.fromEntries(
      (attRows ?? []).map((a) => [
        `${a.lesson_session_id}:${a.student_id}`,
        a.status,
      ])
    );

    for (const ps of parentStudents ?? []) {
      for (const sessId of sessionIds) {
        const status = attByKey[`${sessId}:${ps.student_id}`];
        if (status && BILLABLE.has(status)) {
          let items = parentItems.get(ps.parent_id);
          if (!items) {
            items = [];
            parentItems.set(ps.parent_id, items);
          }
          items.push({
            student_id: ps.student_id,
            lesson_session_id: sessId,
            attendance_status: status,
            amount: Number(cls.price_per_lesson),
            class_title: cls.title,
            session_date: sessionDateMap[sessId],
          });
        }
      }
    }
  }

  // ── Phase 2: create ONE invoice per parent, across all their classes ──────
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
    const { data: existing } = await supabase
      .from("invoices")
      .select("id")
      .eq("parent_id", parentId)
      .eq("billing_month", billingMonth)
      .maybeSingle();

    if (existing) {
      log.push({
        parent_id: parentId,
        billing_month: billingMonth,
        skipped: "already_exists",
      });
      continue;
    }

    // Get parent's available credit balance
    const { data: parent } = await supabase
      .from("parents")
      .select("credit_balance")
      .eq("id", parentId)
      .single();

    const gross = items.reduce((s, i) => s + i.amount, 0);
    const credit = Math.min(Number(parent?.credit_balance ?? 0), gross);
    const net = gross - credit;

    // Insert invoice
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .insert({
        parent_id: parentId,
        billing_month: billingMonth,
        gross_amount: gross,
        credit_applied: credit,
        net_amount: net,
        status: net === 0 ? "paid" : "outstanding",
      })
      .select("id")
      .single();

    if (invErr || !invoice) {
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
    const { error: itemsErr } = await supabase
      .from("invoice_items")
      .insert(items.map((i) => ({ invoice_id: invoice.id, ...i })));

    if (itemsErr) {
      log.push({
        parent_id: parentId,
        invoice_id: invoice.id,
        error: `invoice_items insert failed: ${itemsErr.message}`,
      });
      continue;
    }

    // Apply credit balance FIFO. Draw down each credit note by the
    // AMOUNT ACTUALLY CONSUMED and record every draw in the
    // credit_applications ledger, so the note ledger reconciles with
    // the invoice (a $30 note covering a $20 invoice consumes $20 and
    // stays available for the remaining $10). See
    // 20260711000100_credit_applications.sql.
    if (credit > 0) {
      const nowIso = new Date().toISOString();

      // Available notes, oldest first (FIFO).
      const { data: availCNs } = await supabase
        .from("credit_notes")
        .select("id, amount")
        .eq("parent_id", parentId)
        .eq("status", "available")
        .order("issued_at", { ascending: true });

      let remaining = credit; // total credit still to allocate to this invoice

      for (const cn of availCNs ?? []) {
        if (remaining <= 0) break;

        // Amount of THIS note already spent on earlier invoices.
        const { data: priorApps } = await supabase
          .from("credit_applications")
          .select("amount")
          .eq("credit_note_id", cn.id);
        const used = (priorApps ?? []).reduce(
          (s, a) => s + Number(a.amount),
          0
        );
        const noteRemaining = Number(cn.amount) - used;
        if (noteRemaining <= 0) {
          // Shouldn't happen for an 'available' note; self-heal the flag.
          await supabase
            .from("credit_notes")
            .update({ status: "applied" })
            .eq("id", cn.id);
          continue;
        }

        const draw = Math.min(noteRemaining, remaining);

        await supabase.from("credit_applications").insert({
          credit_note_id: cn.id,
          invoice_id: invoice.id,
          amount: draw,
          applied_at: nowIso,
        });

        // Flip to 'applied' only once the note is fully consumed.
        if (draw >= noteRemaining) {
          await supabase
            .from("credit_notes")
            .update({
              status: "applied",
              applied_to_invoice_id: invoice.id,
              applied_at: nowIso,
            })
            .eq("id", cn.id);
        }

        remaining -= draw;
      }

      // Deduct the amount actually allocated from the pooled balance.
      const allocated = credit - remaining;
      await supabase
        .from("parents")
        .update({
          credit_balance: Number(parent!.credit_balance) - allocated,
        })
        .eq("id", parentId);
    }

    invoicesCreated++;
    created.push({
      invoice_id: invoice.id,
      parent_id: parentId,
      billing_month: billingMonth,
      gross,
      credit,
      net,
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
      credit,
      net,
    });
  }

  // ── Seal the billing month (automatic, non-forced, fully-marked runs only) ─
  // deferredParents can only be non-empty when classesIncomplete > 0, so the
  // second clause is implied — stated anyway so the invariant is local.
  if (
    mode === "auto" &&
    !force &&
    classesIncomplete === 0 &&
    deferredParents.size === 0
  ) {
    await supabase.from("billing_periods").insert({
      billing_month: billingMonth,
      invoices_issued: invoicesCreated,
      notes:
        invoicesCreated === 0
          ? "No billable sessions found for this month."
          : `All ${invoicesCreated} invoice(s) generated successfully.`,
    });
  }

  return {
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
    status:
      mode === "manual"
        ? "manual run complete"
        : classesIncomplete === 0
        ? "complete — billing month sealed"
        : deferredParents.size > 0
        ? `partial — ${deferredParents.size} parent(s) deferred, will retry tomorrow`
        : "partial — will retry tomorrow",
    results: log,
    created,
  };
}
