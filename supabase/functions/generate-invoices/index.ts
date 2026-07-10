// Supabase Edge Function: generate-invoices
//
// One implementation, two ways to trigger it:
//
//   • AUTO  (cron)   — POST {} (or {"mode":"auto"}). Runs daily via pg_cron.
//                      Respects the app_settings "auto_invoice_enabled" switch,
//                      the billing_periods "already sealed" guard, and the
//                      attendance-completeness gate (only bills a class once
//                      every active student has an attendance row for every
//                      session that month). Seals the month when fully done.
//
//   • MANUAL (admin) — POST {"mode":"manual","force":true,"billing_month":"YYYY-MM"}.
//                      On-demand generation for a chosen month. Ignores the
//                      auto switch, the sealed guard, and the completeness gate:
//                      it bills whatever billable attendance exists right now.
//                      Never seals the month, so the cron can still finalise it.
//
// Both paths skip parents who already have an invoice for the month (no
// double-billing) and apply available credit balance FIFO.
//
// Request body (all optional):
//   mode          "auto" | "manual"   (default "auto")
//   force         boolean             (default false)
//   billing_month "YYYY-MM"           (default = previous calendar month)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Attendance statuses that result in a charge to the parent.
// Per PRD 5.4: only Present and Paid Trial are billable.
const BILLABLE = new Set(["present", "trial_paid"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

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

  // ── Parse options ─────────────────────────────────────────────────────────
  let opts: { mode?: string; force?: boolean; billing_month?: string } = {};
  try {
    opts = await req.json();
  } catch {
    // empty body → defaults (auto mode, previous month)
  }
  const mode = opts.mode === "manual" ? "manual" : "auto";
  const force = opts.force === true;

  // Billing month: explicit YYYY-MM, else previous calendar month.
  let billingMonth: string;
  if (opts.billing_month && /^\d{4}-\d{2}$/.test(opts.billing_month)) {
    billingMonth = opts.billing_month;
  } else {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    billingMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
      return json({
        billing_month: billingMonth,
        status: "auto_disabled",
        message:
          "Automatic invoice generation is turned off. Use manual generation from the admin panel.",
      });
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
      return json({
        billing_month: billingMonth,
        status: "already_complete",
        message:
          "Invoices for this billing month were previously finalised. Skipping.",
      });
    }
  }

  // ── Process each active class ─────────────────────────────────────────────
  const { data: classes, error: clsErr } = await supabase
    .from("classes")
    .select("id, title, price_per_lesson")
    .eq("is_active", true);

  if (clsErr) return json({ error: clsErr.message }, 500);

  const log: unknown[] = [];
  let classesIncomplete = 0; // classes skipped because attendance not fully marked
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

    if (!complete && !force) {
      classesIncomplete++;
      log.push({
        class_id: cls.id,
        title: cls.title,
        skipped: "incomplete_attendance",
      });
      continue;
    }

    // ── Build parent → invoice items ────────────────────────────────────────
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

    // ── Create invoices per parent ──────────────────────────────────────────
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

  // ── Seal the billing month (automatic, non-forced, fully-marked runs only) ─
  if (mode === "auto" && !force && classesIncomplete === 0) {
    await supabase.from("billing_periods").insert({
      billing_month: billingMonth,
      invoices_issued: invoicesCreated,
      notes:
        invoicesCreated === 0
          ? "No billable sessions found for this month."
          : `All ${invoicesCreated} invoice(s) generated successfully.`,
    });
  }

  return json({
    billing_month: billingMonth,
    mode,
    forced: force,
    invoices_created: invoicesCreated,
    classes_still_incomplete: classesIncomplete,
    status:
      mode === "manual"
        ? "manual run complete"
        : classesIncomplete === 0
        ? "complete — billing month sealed"
        : "partial — will retry tomorrow",
    results: log,
  });
});
