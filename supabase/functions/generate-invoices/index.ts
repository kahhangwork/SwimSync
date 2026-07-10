// Supabase Edge Function: generate-invoices
// Scheduled daily at 1am SGT (17:00 UTC) via pg_cron + pg_net
//
// Run logic per daily trigger:
//
//   1. Determine billing month = previous calendar month (YYYY-MM).
//   2. Check billing_periods table:
//        - If the billing month is already marked "complete", exit immediately.
//          Nothing more to do until next month's date rolls around.
//   3. For each active class:
//        a. Find all lesson_sessions in the billing month.
//        b. Find all currently-active enrollees.
//        c. GATE: every active enrollee must have an attendance row for every
//           session. If any are missing → skip this class (still incomplete).
//        d. For classes that pass the gate, aggregate billable attendance per
//           parent and create invoice + invoice_items if not yet issued.
//   4. After processing all classes:
//        - If ZERO classes were skipped due to incomplete attendance,
//          the billing month is fully settled → insert into billing_periods.
//          Future daily runs will exit at step 2.
//        - If some classes were still incomplete, do nothing extra — the cron
//          will retry tomorrow.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Attendance statuses that result in a charge to the parent
const BILLABLE = new Set(["present", "absent", "trial_paid"]);

Deno.serve(async (req: Request) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${Deno.env.get("CRON_SECRET")}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // ── Billing month = previous calendar month ───────────────────────────────
  const now = new Date();
  const billingDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const billingMonth = `${billingDate.getFullYear()}-${String(
    billingDate.getMonth() + 1
  ).padStart(2, "0")}`;
  const monthStart = `${billingMonth}-01`;
  const lastDay = new Date(
    billingDate.getFullYear(),
    billingDate.getMonth() + 1,
    0
  ).getDate();
  const monthEnd = `${billingMonth}-${String(lastDay).padStart(2, "0")}`;

  // ── Step 2: Early exit if billing month is already complete ───────────────
  const { data: billingPeriod } = await supabase
    .from("billing_periods")
    .select("billing_month")
    .eq("billing_month", billingMonth)
    .maybeSingle();

  if (billingPeriod) {
    return new Response(
      JSON.stringify({
        billing_month: billingMonth,
        status: "already_complete",
        message: "Invoices for this billing month were previously finalised. Skipping.",
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  }

  // ── Step 3: Process each active class ────────────────────────────────────
  const { data: classes, error: clsErr } = await supabase
    .from("classes")
    .select("id, title, price_per_lesson")
    .eq("is_active", true);

  if (clsErr) {
    return new Response(JSON.stringify({ error: clsErr.message }), {
      status: 500,
    });
  }

  const log: unknown[] = [];
  let classesIncomplete = 0;  // classes skipped because attendance not fully marked
  let invoicesCreated = 0;

  for (const cls of classes ?? []) {
    // Sessions for this class within the billing month
    const { data: sessions } = await supabase
      .from("lesson_sessions")
      .select("id, session_date")
      .eq("class_id", cls.id)
      .gte("session_date", monthStart)
      .lte("session_date", monthEnd);

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

    // ── Gate: every active student must have a row for every session ─────
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

    if (!complete) {
      classesIncomplete++;
      log.push({
        class_id: cls.id,
        title: cls.title,
        skipped: "incomplete_attendance",
      });
      continue;
    }

    // ── Build parent → invoice items ──────────────────────────────────────
    const { data: parentStudents } = await supabase
      .from("parent_students")
      .select("parent_id, student_id")
      .in("student_id", activeStudentIds);

    type InvoiceItem = {
      student_id: string;
      lesson_session_id: string;
      attendance_status: string;
      amount: number;
      class_title: string;
      session_date: string;
    };

    const parentItems: Record<string, InvoiceItem[]> = {};
    for (const ps of parentStudents ?? []) {
      if (!parentItems[ps.parent_id]) parentItems[ps.parent_id] = [];
    }

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
          parentItems[ps.parent_id].push({
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

    // ── Create invoices per parent ────────────────────────────────────────
    for (const [parentId, items] of Object.entries(parentItems)) {
      if (!items.length) continue;

      // Skip if this parent already has an invoice for the billing month
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
          status: "outstanding",
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

      // Insert invoice items
      await supabase
        .from("invoice_items")
        .insert(items.map((i) => ({ invoice_id: invoice.id, ...i })));

      // Apply credit balance: deduct from parent + mark credit notes as applied (FIFO)
      if (credit > 0) {
        await supabase
          .from("parents")
          .update({ credit_balance: Number(parent!.credit_balance) - credit })
          .eq("id", parentId);

        let remaining = credit;
        const { data: availCNs } = await supabase
          .from("credit_notes")
          .select("id, amount")
          .eq("parent_id", parentId)
          .eq("status", "available")
          .order("issued_at", { ascending: true });

        for (const cn of availCNs ?? []) {
          if (remaining <= 0) break;
          await supabase
            .from("credit_notes")
            .update({
              status: "applied",
              applied_to_invoice_id: invoice.id,
              applied_at: new Date().toISOString(),
            })
            .eq("id", cn.id);
          remaining -= Number(cn.amount);
        }
      }

      invoicesCreated++;
      log.push({
        parent_id: parentId,
        invoice_id: invoice.id,
        billing_month: billingMonth,
        gross,
        credit,
        net,
      });
    }
  }

  // ── Step 4: Mark billing month complete if no classes were still pending ──
  // If classesIncomplete > 0, some classes still have unmarked attendance —
  // the cron will retry tomorrow. Only seal the month when everything is done.
  if (classesIncomplete === 0) {
    await supabase.from("billing_periods").insert({
      billing_month: billingMonth,
      invoices_issued: invoicesCreated,
      notes:
        invoicesCreated === 0
          ? "No billable sessions found for this month."
          : `All ${invoicesCreated} invoice(s) generated successfully.`,
    });
  }

  return new Response(
    JSON.stringify({
      billing_month: billingMonth,
      invoices_created: invoicesCreated,
      classes_still_incomplete: classesIncomplete,
      status:
        classesIncomplete === 0
          ? "complete — billing month sealed"
          : "partial — will retry tomorrow",
      results: log,
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 }
  );
});
