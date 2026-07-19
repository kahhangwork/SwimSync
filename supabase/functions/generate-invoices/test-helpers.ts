// Test helpers for the generate-invoices integration tests.
// These run against the LOCAL Supabase stack (supabase start) using a
// service-role client (bypasses RLS) to seed and assert. Each scenario creates
// its own coach/parent/class with unique ids and tears itself down, so tests
// don't collide and leave the DB as they found it.
//
// Env: SUPABASE_URL (default local) + SERVICE_ROLE_KEY (from `supabase status`).
// The provided ./test.sh wrapper exports both automatically.

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { APP_TIMEZONE, dateInTimeZone, expectedLessonDates } from "./dates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

if (!SERVICE_ROLE_KEY) {
  throw new Error(
    "SERVICE_ROLE_KEY is required. Run via ./test.sh, or export it from `supabase status -o env`."
  );
}

export function svc(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type Scenario = {
  db: SupabaseClient;
  tag: string;
  coachId: string;
  coachProfileId: string;
  tenantId: string;
  classId: string;
  parentId: string;
  parentProfileId: string;
  studentId: string;
  /** Second class, only when newScenario({ secondClass }) was used. */
  classId2?: string;
  /** Second child (same parent), enrolled in classId2. Must be a separate
   *  student: one student in two classes violates the one-active-enrolment
   *  constraint. */
  studentId2?: string;
  /** Create a lesson session on the given YYYY-MM-DD; returns its id.
   *  Defaults to the primary class. */
  addSession: (date: string, classId?: string) => Promise<string>;
  /** Insert or update a student's attendance for a session (an UPDATE on an
   *  already-invoiced session fires the credit-note trigger, like the app).
   *  Defaults to the primary student. */
  mark: (sessionId: string, status: string, studentId?: string) => Promise<void>;
  /** Change a class's terms from a date — a new effective-dated class_rates
   *  row, which is the ONLY thing that changes what a lesson costs or who is
   *  paid for it. Writing classes.price_per_lesson directly is display-only
   *  and deliberately has no effect on billing (20260719000700). */
  setRate: (
    opts: { from: string; price?: number; paidCoachId?: string; classId?: string },
  ) => Promise<void>;
  /** Current pooled credit balance for the parent. */
  creditBalance: () => Promise<number>;
  /** Per-tenant credit balance (the source of truth). */
  tenantCreditBalance: () => Promise<number>;
  /** Mark every still-unsessioned expected lesson in a month as cancelled_rain,
   *  so the month passes the completeness gate without changing gross. */
  completeMonth: (
    billingMonth: string,
    classId?: string,
    now?: Date
  ) => Promise<void>;
  teardown: () => Promise<void>;
};

async function createRoleUser(
  db: SupabaseClient,
  email: string,
  role: "coach" | "parent",
  fullName: string,
  extra?: Record<string, unknown>
): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: "password123",
    email_confirm: true,
    user_metadata: { full_name: fullName, role, ...(extra ?? {}) },
  });
  if (error || !data.user) {
    throw new Error(`createUser(${role}) failed: ${error?.message}`);
  }
  return data.user.id;
}

/**
 * Seed a coach + class + parent + one enrolled child. Price defaults to $30.
 *
 * Pass `secondClass` to additionally seed a SECOND class (same coach) and a
 * SECOND child under the SAME parent, enrolled in it — the shape needed to
 * exercise the multi-class-parent billing path.
 */
export async function newScenario(
  opts: {
    price?: number;
    secondClass?: { price?: number };
    /** Backdate the enrolment (YYYY-MM-DD). Enrolments default to NOW(), and
     *  expected-lesson derivation is floored at the earliest enrolment — so a
     *  test billing a PAST month sees zero expected lessons unless the
     *  enrolment predates that month. Only tests that exercise the
     *  expected-vs-marked gate need this. */
    enrolledAt?: string;
    /** Class weekday; expected-lesson dates derive from it. Default saturday. */
    dayOfWeek?: string;
  } = {}
): Promise<Scenario> {
  const db = svc();
  const price = opts.price ?? 30;
  const tag = crypto.randomUUID().slice(0, 8);
  const dayOfWeek = opts.dayOfWeek ?? "saturday";
  const enrolExtra = opts.enrolledAt ? { enrolled_at: opts.enrolledAt } : {};

  // Each scenario gets its OWN tenant. Coaches now require one (the auth
  // trigger refuses to guess), and a shared tenant would let scenarios see each
  // other once the engine becomes tenant-scoped in phase 2.
  const { data: tenantRow, error: tenantErr } = await db
    .from("tenants")
    .insert({
      slug: `test-${tag}`,
      display_name: `Test Tenant ${tag}`,
      join_code: `SWIM-${tag.slice(0, 4).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (tenantErr || !tenantRow) {
    throw new Error(`tenant insert failed: ${tenantErr?.message}`);
  }
  const tenantId = tenantRow.id as string;

  // Coach (trigger creates profiles + coaches row)
  const coachProfileId = await createRoleUser(
    db,
    `coach-${tag}@test.local`,
    "coach",
    `Coach ${tag}`,
    { tenant_id: tenantId }
  );
  const { data: coachRow } = await db
    .from("coaches")
    .select("id")
    .eq("profile_id", coachProfileId)
    .single();
  const coachId = coachRow!.id as string;

  // Class owned by the coach
  const { data: cls } = await db
    .from("classes")
    .insert({
      coach_id: coachId,
      title: `Class ${tag}`,
      day_of_week: dayOfWeek,
      start_time: "10:00",
      end_time: "11:00",
      location_name: "Test Pool",
      price_per_lesson: price,
    })
    .select("id")
    .single();
  const classId = cls!.id as string;

  // Parent (trigger creates profiles + parents row) + child + enrolment
  const parentProfileId = await createRoleUser(
    db,
    `parent-${tag}@test.local`,
    "parent",
    `Parent ${tag}`
  );
  const { data: parentRow } = await db
    .from("parents")
    .select("id")
    .eq("profile_id", parentProfileId)
    .single();
  const parentId = parentRow!.id as string;

  const { data: stu } = await db
    .from("students")
    .insert({
      full_name: `Kid ${tag}`,
      assignment_status: "assigned",
      is_active: true,
      tenant_id: tenantId,
    })
    .select("id")
    .single();
  const studentId = stu!.id as string;

  await db.from("parent_students").insert({
    parent_id: parentId,
    student_id: studentId,
  });
  await db.from("student_class_enrolments").insert({
    student_id: studentId,
    class_id: classId,
    is_active: true,
    ...enrolExtra,
  });

  // Tracked as arrays so teardown deletes every seeded row. A leaked class is
  // not a local problem: generateInvoices scans ALL active classes with no
  // scoping, so it would pollute every later test in the suite.
  const classIds: string[] = [classId];
  const studentIds: string[] = [studentId];

  let classId2: string | undefined;
  let studentId2: string | undefined;

  if (opts.secondClass) {
    const { data: cls2 } = await db
      .from("classes")
      .insert({
        coach_id: coachId,
        title: `Class2 ${tag}`,
        day_of_week: "sunday",
        start_time: "10:00",
        end_time: "11:00",
        location_name: "Test Pool",
        price_per_lesson: opts.secondClass.price ?? price,
      })
      .select("id")
      .single();
    classId2 = cls2!.id as string;
    classIds.push(classId2);

    const { data: stu2 } = await db
      .from("students")
      .insert({
        full_name: `Kid2 ${tag}`,
        assignment_status: "assigned",
        is_active: true,
        tenant_id: tenantId,
      })
      .select("id")
      .single();
    studentId2 = stu2!.id as string;
    studentIds.push(studentId2);

    // Same parent — that is the whole point of the fixture.
    await db.from("parent_students").insert({
      parent_id: parentId,
      student_id: studentId2,
    });
    await db.from("student_class_enrolments").insert({
      student_id: studentId2,
      class_id: classId2,
      is_active: true,
      ...enrolExtra,
    });
  }

  const sessionIds: string[] = [];
  // Billing months this scenario could seal. Any run that finishes a month now
  // writes billing_periods — including manual ones — and teardown() does not
  // otherwise touch that table, so a leftover row makes the NEXT run of the
  // suite short-circuit on "already_complete". Derived from session dates so
  // tests get this for free.
  const billingMonths = new Set<string>();

  async function addSession(
    date: string,
    forClassId?: string
  ): Promise<string> {
    billingMonths.add(date.slice(0, 7));
    const { data: s, error } = await db
      .from("lesson_sessions")
      .insert({
        class_id: forClassId ?? classId,
        session_date: date,
        status: "completed",
      })
      .select("id")
      .single();
    if (error || !s) throw new Error(`addSession failed: ${error?.message}`);
    sessionIds.push(s.id as string);
    return s.id as string;
  }

  async function mark(
    sessionId: string,
    status: string,
    forStudentId?: string
  ): Promise<void> {
    const { error } = await db.from("attendance").upsert(
      {
        lesson_session_id: sessionId,
        student_id: forStudentId ?? studentId,
        status,
        marked_by: coachProfileId,
      },
      { onConflict: "lesson_session_id,student_id" }
    );
    if (error) throw new Error(`mark failed: ${error.message}`);
  }

  /**
   * Mark every lesson the class was DUE in `billingMonth` that has no session
   * yet as `cancelled_rain` — non-billable, so it satisfies the completeness
   * gate without changing any gross amount.
   *
   * Needed because the engine now derives expected lesson dates from the class
   * weekday: a fixture that creates one session in a month where the class met
   * four times is an INCOMPLETE month and is correctly blocked. Tests that are
   * about something else (run day, credit carry-forward) use this to say "the
   * rest of the month happened and was rained off", keeping their assertions
   * about the one lesson they care about.
   */
  async function completeMonth(
    billingMonth: string,
    forClassId?: string,
    now: Date = new Date()
  ): Promise<void> {
    const cid = forClassId ?? classId;

    // EVERY actively-enrolled student, not just the scenario's own: the
    // completeness gate requires a row for each of them, so a test that adds an
    // extra student to the class would otherwise be left with an incomplete
    // month and be correctly blocked.
    const { data: enrolled } = await db
      .from("student_class_enrolments")
      .select("student_id")
      .eq("class_id", cid)
      .eq("is_active", true);
    const students = (enrolled ?? []).map((e) => e.student_id as string);

    const { data: cls } = await db
      .from("classes")
      .select("day_of_week")
      .eq("id", cid)
      .single();

    const [y, m] = billingMonth.split("-").map(Number);
    const monthStart = `${billingMonth}-01`;
    const monthEnd = `${billingMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

    const { data: enrolRows } = await db
      .from("student_class_enrolments")
      .select("enrolled_at")
      .eq("class_id", cid);
    const earliest = (enrolRows ?? [])
      .map((e) => String(e.enrolled_at).slice(0, 10))
      .sort()[0];

    // MUST use the same clock the engine will run at. A test billing a future
    // month passes `now` to generateInvoices; completing the month against the
    // real clock would derive zero expected lessons and leave the fixture
    // incomplete in exactly the way the gate now catches.
    const today = dateInTimeZone(now, APP_TIMEZONE);
    const from = earliest && earliest > monthStart ? earliest : monthStart;
    const to = today < monthEnd ? today : monthEnd;

    const { data: existing } = await db
      .from("lesson_sessions")
      .select("session_date")
      .eq("class_id", cid)
      .gte("session_date", monthStart)
      .lte("session_date", monthEnd);
    const have = new Set((existing ?? []).map((s) => s.session_date as string));

    for (const date of expectedLessonDates(String(cls!.day_of_week), from, to)) {
      if (have.has(date)) continue;
      const sid = await addSession(date, cid);
      for (const stu of students) await mark(sid, "cancelled_rain", stu);
    }
  }

  /** Credit held for this parent BY THIS TENANT — the real source of truth. */
  async function tenantCreditBalance(): Promise<number> {
    const { data } = await db
      .from("parent_tenant_balances")
      .select("credit_balance")
      .eq("parent_id", parentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return Number(data?.credit_balance ?? 0);
  }

  /** Alias kept so existing tests read naturally. Credit is per (parent,
   *  tenant) now — the pooled parents.credit_balance column is gone. */
  async function creditBalance(): Promise<number> {
    return await tenantCreditBalance();
  }

  /** Insert new effective-dated terms for a class. Carries forward whatever is
   *  currently in force for anything not being changed, so a price change does
   *  not silently reassign the coach (or vice versa). */
  async function setRate(opts: {
    from: string;
    price?: number;
    paidCoachId?: string;
    classId?: string;
  }): Promise<void> {
    const cid = opts.classId ?? classId;

    const { data: current } = await db
      .from("class_rates")
      .select("price_per_lesson, paid_coach_id")
      .eq("class_id", cid)
      .lte("effective_from", opts.from)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await db.from("class_rates").upsert({
      class_id: cid,
      effective_from: opts.from,
      price_per_lesson: opts.price ?? Number(current?.price_per_lesson),
      paid_coach_id: opts.paidCoachId ?? current?.paid_coach_id ?? coachId,
    }, { onConflict: "class_id,effective_from" });

    if (error) throw new Error(`setRate: ${error.message}`);
  }

  /**
   * Remove everything this scenario created, in dependency order.
   *
   * ORDER IS LOAD-BEARING and was wrong once: billing rows were swept AFTER
   * lesson_sessions and classes, so an invoice_item still referencing a session
   * blocked the session delete, which blocked the class delete, which blocked
   * the coach, which blocked the auth user — and the tenant was left behind.
   * All of it failed SILENTLY because no error was checked.
   *
   * A leaked tenant is not a local mess: generateInvoices with no tenant_id
   * loops EVERY tenant, so leftovers become rows a later run processes.
   *
   * Sweeps are BY TENANT wherever possible, not by the ids this scenario
   * tracked — the cross-tenant fixtures deliberately create rows owned by
   * another scenario's parent inside this tenant.
   */
  async function teardown(): Promise<void> {
    // 1. Billing first — invoice_items reference lesson_sessions.
    const { data: tNotes } = await db
      .from("credit_notes").select("id").eq("tenant_id", tenantId);
    const noteIds = (tNotes ?? []).map((r) => r.id as string);
    if (noteIds.length) {
      await db.from("credit_applications").delete().in("credit_note_id", noteIds);
      await db.from("credit_notes").delete().in("id", noteIds);
    }

    const { data: tInvoices } = await db
      .from("invoices").select("id").eq("tenant_id", tenantId);
    const invoiceIds = (tInvoices ?? []).map((r) => r.id as string);
    if (invoiceIds.length) {
      await db.from("credit_applications").delete().in("invoice_id", invoiceIds);
      await db.from("payment_records").delete().in("invoice_id", invoiceIds);
      await db.from("invoice_items").delete().in("invoice_id", invoiceIds);
      await db.from("invoices").delete().in("id", invoiceIds);
    }
    // Any invoice of this parent that somehow escaped the tenant sweep.
    await db.from("invoices").delete().eq("parent_id", parentId);

    // 2. Students of this tenant (tracked + strays added by a test).
    const { data: tStudents } = await db
      .from("students").select("id").eq("tenant_id", tenantId);
    const studentSweep = [
      ...new Set([...(tStudents ?? []).map((r) => r.id as string), ...studentIds]),
    ];

    // 3. Attendance + sessions, by class so untracked sessions go too.
    const { data: tClasses } = await db
      .from("classes").select("id").eq("tenant_id", tenantId);
    const classSweep = [
      ...new Set([...(tClasses ?? []).map((r) => r.id as string), ...classIds]),
    ];

    if (classSweep.length) {
      const { data: tSessions } = await db
        .from("lesson_sessions").select("id").in("class_id", classSweep);
      const sessionSweep = [
        ...new Set([...(tSessions ?? []).map((r) => r.id as string), ...sessionIds]),
      ];
      if (sessionSweep.length) {
        await db.from("attendance").delete().in("lesson_session_id", sessionSweep);
        await db.from("lesson_sessions").delete().in("id", sessionSweep);
      }
      await db.from("student_class_enrolments").delete().in("class_id", classSweep);
    }

    if (studentSweep.length) {
      await db.from("student_class_enrolments").delete().in("student_id", studentSweep);
      await db.from("parent_students").delete().in("student_id", studentSweep);
      await db.from("students").delete().in("id", studentSweep);
    }

    if (classSweep.length) {
      await db.from("classes").delete().in("id", classSweep);
    }

    // 4. Tenant-scoped bookkeeping.
    await db.from("parent_tenant_balances").delete().eq("tenant_id", tenantId);
    await db.from("parent_tenants").delete().eq("tenant_id", tenantId);
    await db.from("audit_log").delete().eq("tenant_id", tenantId);
    await db.from("billing_periods").delete().eq("tenant_id", tenantId);
    if (billingMonths.size) {
      await db.from("billing_periods").delete().in("billing_month", [...billingMonths]);
    }

    // 5. Users, then the tenant. BOTH errors are checked — silence here is how
    //    the leak went unnoticed in the first place.
    const { error: pErr } = await db.auth.admin.deleteUser(parentProfileId);
    const { error: cErr } = await db.auth.admin.deleteUser(coachProfileId);
    if (pErr || cErr) {
      throw new Error(
        `teardown could not remove users for tenant ${tenantId}: ${pErr?.message ?? ""} ${cErr?.message ?? ""}`
      );
    }

    const { error: tErr } = await db.from("tenants").delete().eq("id", tenantId);
    if (tErr) {
      throw new Error(
        `teardown left tenant ${tenantId} behind: ${tErr.message}. Something still references it.`
      );
    }
  }

  return {
    db,
    tag,
    coachId,
    coachProfileId,
    tenantId,
    classId,
    parentId,
    parentProfileId,
    studentId,
    classId2,
    studentId2,
    addSession,
    mark,
    setRate,
    creditBalance,
    tenantCreditBalance,
    completeMonth,
    teardown,
  };
}

/** Read an invoice row for a parent/month. */
/**
 * Read a parent's invoice for a month.
 *
 * `tenantId` is optional but MATTERS once a parent deals with more than one
 * business: there is now one invoice per parent PER TENANT per month, so an
 * unscoped maybeSingle() sees two rows and returns null. Pass it in any test
 * where the parent spans tenants.
 */
export async function getInvoice(
  db: SupabaseClient,
  parentId: string,
  billingMonth: string,
  tenantId?: string
) {
  let q = db
    .from("invoices")
    .select("id, gross_amount, credit_applied, net_amount, status")
    .eq("parent_id", parentId)
    .eq("billing_month", billingMonth);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    gross: Number(data.gross_amount),
    credit_applied: Number(data.credit_applied),
    net: Number(data.net_amount),
    status: data.status as string,
  };
}

/**
 * Ledger invariants that must always hold after credit is applied:
 *   • each invoice's gross_amount == SUM(its invoice_items)
 *   • each invoice's credit_applied == SUM(credit_applications for it)
 *   • SUM(parent_tenant_balances) == SUM(note.amount − applied) across notes
 * Returns { ok, details } so tests can assert and print on failure.
 */
export async function checkInvariants(db: SupabaseClient, parentId: string) {
  const problems: string[] = [];

  const { data: invoices } = await db
    .from("invoices")
    .select("id, gross_amount, credit_applied")
    .eq("parent_id", parentId);
  for (const inv of invoices ?? []) {
    // Gross must equal the line items backing it. This is what catches a
    // parent's second class being dropped: the invoice exists and looks
    // plausible, but its items don't add up to what was actually attended.
    const { data: lineItems } = await db
      .from("invoice_items")
      .select("amount")
      .eq("invoice_id", inv.id);
    const itemsSum = (lineItems ?? []).reduce((s, i) => s + Number(i.amount), 0);
    if (Math.abs(itemsSum - Number(inv.gross_amount)) > 0.001) {
      problems.push(
        `invoice ${inv.id}: gross_amount=${inv.gross_amount} but SUM(invoice_items)=${itemsSum}`
      );
    }

    const { data: apps } = await db
      .from("credit_applications")
      .select("amount")
      .eq("invoice_id", inv.id);
    const sum = (apps ?? []).reduce((s, a) => s + Number(a.amount), 0);
    if (Math.abs(sum - Number(inv.credit_applied)) > 0.001) {
      problems.push(
        `invoice ${inv.id}: credit_applied=${inv.credit_applied} but SUM(applications)=${sum}`
      );
    }
  }

  const { data: notes } = await db
    .from("credit_notes")
    .select("id, amount")
    .eq("parent_id", parentId);
  let sumRemaining = 0;
  for (const n of notes ?? []) {
    const { data: apps } = await db
      .from("credit_applications")
      .select("amount")
      .eq("credit_note_id", n.id);
    const used = (apps ?? []).reduce((s, a) => s + Number(a.amount), 0);
    sumRemaining += Number(n.amount) - used;
  }
  // Credit balances are per (parent, tenant). Summing them across the parent's
  // tenants is the right comparison against SUM(remaining across notes), which
  // is also across all their notes — the per-tenant split is asserted directly
  // by the cross-tenant credit test in core.test.ts.
  const { data: balances } = await db
    .from("parent_tenant_balances")
    .select("credit_balance")
    .eq("parent_id", parentId);
  const balance = (balances ?? []).reduce(
    (s, b) => s + Number(b.credit_balance),
    0
  );
  if (Math.abs(balance - sumRemaining) > 0.001) {
    problems.push(
      `SUM(parent_tenant_balances)=${balance} but SUM(remaining across notes)=${sumRemaining}`
    );
  }

  return { ok: problems.length === 0, problems };
}
