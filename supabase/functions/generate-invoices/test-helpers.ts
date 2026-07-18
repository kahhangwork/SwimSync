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
  /** Current pooled credit balance for the parent. */
  creditBalance: () => Promise<number>;
  teardown: () => Promise<void>;
};

async function createRoleUser(
  db: SupabaseClient,
  email: string,
  role: "coach" | "parent",
  fullName: string
): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: "password123",
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
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
  opts: { price?: number; secondClass?: { price?: number } } = {}
): Promise<Scenario> {
  const db = svc();
  const price = opts.price ?? 30;
  const tag = crypto.randomUUID().slice(0, 8);

  // Coach (trigger creates profiles + coaches row)
  const coachProfileId = await createRoleUser(
    db,
    `coach-${tag}@test.local`,
    "coach",
    `Coach ${tag}`
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
      day_of_week: "saturday",
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
    });
  }

  const sessionIds: string[] = [];

  async function addSession(
    date: string,
    forClassId?: string
  ): Promise<string> {
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

  async function creditBalance(): Promise<number> {
    const { data } = await db
      .from("parents")
      .select("credit_balance")
      .eq("id", parentId)
      .single();
    return Number(data?.credit_balance ?? 0);
  }

  async function teardown(): Promise<void> {
    // Children first, then the auth users (cascades profiles → parents/coaches).
    const { data: noteRows } = await db
      .from("credit_notes")
      .select("id")
      .eq("parent_id", parentId);
    const noteIds = (noteRows ?? []).map((r) => r.id);
    if (noteIds.length) {
      await db.from("credit_applications").delete().in("credit_note_id", noteIds);
      await db.from("credit_notes").delete().in("id", noteIds);
    }
    await db.from("invoices").delete().eq("parent_id", parentId); // cascades items + apps
    if (sessionIds.length) {
      await db.from("attendance").delete().in("lesson_session_id", sessionIds);
      await db.from("lesson_sessions").delete().in("id", sessionIds);
    }
    await db.from("student_class_enrolments").delete().in("class_id", classIds);
    await db.from("parent_students").delete().in("student_id", studentIds);
    await db.from("students").delete().in("id", studentIds);
    await db.from("classes").delete().in("id", classIds);
    await db.auth.admin.deleteUser(parentProfileId);
    await db.auth.admin.deleteUser(coachProfileId);
  }

  return {
    db,
    tag,
    coachId,
    coachProfileId,
    classId,
    parentId,
    parentProfileId,
    studentId,
    classId2,
    studentId2,
    addSession,
    mark,
    creditBalance,
    teardown,
  };
}

/** Read an invoice row for a parent/month. */
export async function getInvoice(
  db: SupabaseClient,
  parentId: string,
  billingMonth: string
) {
  const { data } = await db
    .from("invoices")
    .select("id, gross_amount, credit_applied, net_amount, status")
    .eq("parent_id", parentId)
    .eq("billing_month", billingMonth)
    .maybeSingle();
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
 *   • parent's credit_balance == SUM(note.amount − applied) across their notes
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
  const { data: parent } = await db
    .from("parents")
    .select("credit_balance")
    .eq("id", parentId)
    .single();
  const balance = Number(parent?.credit_balance ?? 0);
  if (Math.abs(balance - sumRemaining) > 0.001) {
    problems.push(
      `credit_balance=${balance} but SUM(remaining across notes)=${sumRemaining}`
    );
  }

  return { ok: problems.length === 0, problems };
}
