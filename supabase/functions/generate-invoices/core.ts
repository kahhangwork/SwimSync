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
import {
  clampRunDay,
  dayOfMonthInTimeZone,
  DEFAULT_INVOICE_RUN_DAY,
  previousBillingMonth,
} from "./dates.ts";

// Attendance statuses that result in a charge to the parent.
// Per PRD 5.4: only Present and Paid Trial are billable.
export const BILLABLE = new Set(["present", "trial_paid"]);

export type GenerateOptions = {
  mode?: string;
  force?: boolean;
  billing_month?: string;
  /** Clock injection — TESTS ONLY. Production callers omit it and get the real
   *  time. Exists so the run-day guard and the default billing month can be
   *  exercised deterministically rather than only on the right day of the
   *  month. Never sent over the wire (index.ts passes the parsed body through,
   *  and a JSON string here would be ignored by the Date checks below). */
  now?: Date;
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

// A lesson standing between the admin and generation: which class, which date,
// and how many enrolled students still have no attendance row on it.
export type BlockingLesson = {
  class_id: string;
  class_title: string;
  session_date: string;
  unmarked_student_count: number;
};

export type GenerateResult = {
  billing_month: string;
  status: string;
  mode?: string;
  forced?: boolean;
  invoices_created?: number;
  classes_still_incomplete?: number;
  parents_deferred?: number;
  /** True when this run left the month finished and closed — no further run
   *  will process it (they short-circuit on the sealed-month guard). */
  sealed?: boolean;
  /** Present when status is "incomplete_attendance": the lessons to mark
   *  before generation can proceed. Empty/absent otherwise. */
  blocking?: BlockingLesson[];
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
  // Guarded so a stray `now` in a JSON body can never shift billing.
  const now = opts.now instanceof Date ? opts.now : new Date();

  // Billing month: explicit YYYY-MM, else the previous calendar month in the
  // app timezone (SGT by default). Derived via previousBillingMonth() rather
  // than new Date()'s local fields — Edge Functions run in UTC, which bills the
  // wrong month at the SGT day boundary (the 1am SGT cron is 17:00 UTC the day
  // before). See dates.ts.
  let billingMonth: string;
  if (opts.billing_month && /^\d{4}-\d{2}$/.test(opts.billing_month)) {
    billingMonth = opts.billing_month;
  } else {
    billingMonth = previousBillingMonth(now);
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

  // ── Run-day guard (automatic, non-forced runs only) ───────────────────────
  // Billing on the 1st is too early — the month's last lesson may not be
  // marked yet, and a lesson marked after the invoice exists is never added to
  // it. The automatic path therefore waits until a configured day of the
  // following month. Checked AFTER the sealed guard so a finished month
  // reports "already_complete" rather than "before_run_day".
  //
  // Manual/forced runs ignore this entirely: the admin generating on demand is
  // an explicit instruction and must never be blocked by a schedule.
  if (mode === "auto" && !force) {
    const { data: runDaySetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "invoice_run_day")
      .maybeSingle();

    const runDay = clampRunDay(runDaySetting?.value ?? DEFAULT_INVOICE_RUN_DAY);
    // Day-of-month in the APP timezone, never new Date().getDate() — that is
    // the UTC day and is a day behind in SGT before 08:00 (see dates.ts).
    const today = dayOfMonthInTimeZone(now);

    if (today < runDay) {
      return {
        billing_month: billingMonth,
        status: "before_run_day",
        message:
          `Automatic invoices for ${billingMonth} are generated from day ${runDay} of the month. Today is day ${today}. Use manual generation to run now.`,
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
  // Lessons with unmarked attendance. Any entry here stops the whole run.
  const blocking: BlockingLesson[] = [];
  let classesIncomplete = 0; // classes skipped because attendance not fully marked
  // Classes this run actually reckoned with: had lessons recorded AND students
  // to bill, and passed the completeness gate. A month can only be SEALED if
  // this is > 0 — see the sealing block for why zero must never seal.
  let classesComplete = 0;
  let invoicesCreated = 0;
  // A month with a failed write must never be sealed — sealing would lock out
  // the very retry that would have fixed it.
  let invoiceWriteFailed = false;

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

    // Active enrolments — who is EXPECTED to be marked. Drives the
    // completeness gate only.
    const { data: enrolments } = await supabase
      .from("student_class_enrolments")
      .select("student_id")
      .eq("class_id", cls.id)
      .eq("is_active", true);

    const activeStudentIds = (enrolments ?? []).map((e) => e.student_id);

    // All attendance rows for these sessions
    const { data: attRows } = await supabase
      .from("attendance")
      .select("lesson_session_id, student_id, status")
      .in("lesson_session_id", sessionIds);

    // Who gets BILLED is a different question from who must be marked. Billing
    // follows the attendance rows that actually exist, NOT the current
    // enrolment: a child unenrolled part-way through the month still attended
    // the lessons they attended, and must still be billed for them. Deriving
    // the billable set from active enrolments alone silently dropped those
    // lessons — one tap of "remove from class" would have cost a month's
    // revenue for that child.
    const attendedStudentIds = (attRows ?? []).map((a) => a.student_id);
    const billableStudentIds = [
      ...new Set([...activeStudentIds, ...attendedStudentIds]),
    ];

    // Nobody enrolled and nobody marked — nothing to bill or check.
    if (!billableStudentIds.length) continue;

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
    // the incomplete branch needs it to record who must be deferred. Covers
    // the billable set, which is wider than the enrolled set (see above).
    const { data: parentStudents } = await supabase
      .from("parent_students")
      .select("parent_id, student_id")
      .in("student_id", billableStudentIds);

    // Deferral applies only to parents of ACTIVELY enrolled children: a parent
    // whose child has left is not waiting on anyone to mark that child, so an
    // unmarked lesson for someone else's child shouldn't hold their invoice.
    const activeSet = new Set(activeStudentIds);
    const deferrableParentIds = new Set(
      (parentStudents ?? [])
        .filter((ps) => activeSet.has(ps.student_id))
        .map((ps) => ps.parent_id)
    );

    // Unmarked attendance BLOCKS generation, in every mode. An unmarked lesson
    // is unbillable and invisible, and once the parent has an invoice it can
    // never be added to it — so billing around it converts a fixable gap into
    // a permanent underbill. A lesson that genuinely did not run is recorded
    // with cancelled_rain/cancelled_coach (non-billable), which satisfies the
    // gate; there is no case that needs a bypass.
    //
    // `force` keeps its other meaning (skipping the sealed-month guard, the
    // documented reopen path) but no longer overrides this.
    if (!complete) {
      classesIncomplete++;
      for (const pid of deferrableParentIds) deferredParents.add(pid);
      for (const sessId of sessionIds) {
        const unmarked = activeStudentIds.filter(
          (stuId) => !attSet.has(`${sessId}:${stuId}`)
        );
        if (unmarked.length) {
          blocking.push({
            class_id: cls.id,
            class_title: cls.title,
            session_date: sessionDateMap[sessId],
            unmarked_student_count: unmarked.length,
          });
        }
      }
      log.push({
        class_id: cls.id,
        title: cls.title,
        skipped: "incomplete_attendance",
        parents_deferred: deferrableParentIds.size,
      });
      continue;
    }

    // Past the gate with real lessons and real students: this class has been
    // genuinely reckoned with, whether or not it yields a billable item.
    classesComplete++;

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
      billing_month: billingMonth,
      mode,
      forced: force,
      status: "incomplete_attendance",
      invoices_created: 0,
      classes_still_incomplete: classesIncomplete,
      parents_deferred: deferredParents.size,
      sealed: false,
      blocking,
      message:
        `Cannot generate invoices for ${billingMonth}: ${blocking.length} lesson(s) still have unmarked attendance. Mark them — or mark them cancelled if the lesson did not run — then generate again.`,
      results: log,
    };
  }

  // ── Phase 2: create ONE invoice per parent, across all their classes ──────
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
    const { error: itemsErr } = await supabase
      .from("invoice_items")
      .insert(items.map((i) => ({ invoice_id: invoice.id, ...i })));

    if (itemsErr) {
      invoiceWriteFailed = true;
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
  const monthFinished =
    classesComplete > 0 &&
    classesIncomplete === 0 &&
    deferredParents.size === 0 &&
    !invoiceWriteFailed;

  if (monthFinished) {
    // DO NOTHING on conflict, not a plain insert: a forced run bypasses the
    // sealed-month guard, so a second one would otherwise hit a duplicate key
    // on the billing_month primary key. The first seal is the true one — its
    // invoices_issued reflects the run that actually did the work.
    await supabase.from("billing_periods").upsert(
      {
        billing_month: billingMonth,
        invoices_issued: invoicesCreated,
        notes:
          invoicesCreated === 0
            ? "No billable sessions found for this month."
            : `All ${invoicesCreated} invoice(s) generated successfully.`,
      },
      { onConflict: "billing_month", ignoreDuplicates: true }
    );
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
    sealed: monthFinished,
    status: monthFinished
      ? "complete — billing month sealed"
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
  };
}
