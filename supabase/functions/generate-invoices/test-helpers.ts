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
  /** Create a lesson session on the given YYYY-MM-DD; returns its id. */
  addSession: (date: string) => Promise<string>;
  /** Insert or update this student's attendance for a session (an UPDATE on an
   *  already-invoiced session fires the credit-note trigger, like the app). */
  mark: (sessionId: string, status: string) => Promise<void>;
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

/** Seed a coach + class + parent + one enrolled child. Price defaults to $30. */
export async function newScenario(
  opts: { price?: number } = {}
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

  const sessionIds: string[] = [];

  async function addSession(date: string): Promise<string> {
    const { data: s, error } = await db
      .from("lesson_sessions")
      .insert({ class_id: classId, session_date: date, status: "completed" })
      .select("id")
      .single();
    if (error || !s) throw new Error(`addSession failed: ${error?.message}`);
    sessionIds.push(s.id as string);
    return s.id as string;
  }

  async function mark(sessionId: string, status: string): Promise<void> {
    const { error } = await db.from("attendance").upsert(
      {
        lesson_session_id: sessionId,
        student_id: studentId,
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
    await db.from("student_class_enrolments").delete().eq("class_id", classId);
    await db.from("parent_students").delete().eq("student_id", studentId);
    await db.from("students").delete().eq("id", studentId);
    await db.from("classes").delete().eq("id", classId);
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
 *   • each invoice's credit_applied == SUM(credit_applications for it)
 *   • parent's credit_balance == SUM(note.amount − applied) across their notes
 * Returns { ok, details } so tests can assert and print on failure.
 */
export async function checkInvariants(db: SupabaseClient, parentId: string) {
  const problems: string[] = [];

  const { data: invoices } = await db
    .from("invoices")
    .select("id, credit_applied")
    .eq("parent_id", parentId);
  for (const inv of invoices ?? []) {
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
