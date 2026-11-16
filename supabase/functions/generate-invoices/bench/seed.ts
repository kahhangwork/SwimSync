// Deterministic "realistic month" seed for timing + equivalence of generate-invoices.
// Built on test-helpers' newScenario (own tenant, own teardown). Everything that
// influences ordering is deterministic: parent ids are rewritten to fixed uuids
// (phase 2 iterates parents sorted by id; invoice reference numbers follow it).
//
// Shape (per tenant), with C classes × S students:
//   • every class weekly, all October dates sessioned + marked
//   • mostly present; ~1 in 7 absent; one date per class rained off
//   • every 5th family has a second child in the next class (multi-class invoice)
//   • 2 families carry CREDIT from a corrected September lesson (FIFO draw path)
//   • 1 family holds a PACKAGE that draws at marking (drawn-lesson filter path)
//   • 1 paid TRIAL (category-priced) and 1 MAKE-UP guest (home-class priced)
//   • 1 class repriced mid-month (effective-dated rate path)
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import { expectedLessonDates } from "../dates.ts";
import {
  newScenario,
  monthEnded,
  type Scenario,
} from "../test-helpers.ts";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export const MONTH = "2026-10";
export const PREV = "2026-09";

export type Seeded = {
  s: Scenario;
  now: Date;
  labels: Map<string, string>; // uuid → stable label
  cleanup: () => Promise<void>;
};

function fixedParentId(i: number): string {
  return `beec0000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}
/** Fixed student ids too: the engine orders two lines on the same date and
 *  class by student_id, so random ids would let two seeds order siblings
 *  differently — a seed artifact a before/after comparison would misread. */
function fixedStudentId(family: number, kid: number): string {
  return `beec1000-0000-4000-8000-${String(family).padStart(9, "0")}${String(kid).padStart(3, "0")}`;
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// deno-lint-ignore no-explicit-any
type GenFn = (db: SupabaseClient, opts: any) => Promise<any>;

export async function seedMonth(
  opts: { classes: number; perClass: number; generate: GenFn },
): Promise<Seeded> {
  const win = monthEnded(MONTH);
  const s = await newScenario({ price: 30, billing: win, enrolledAt: `${MONTH}-01`, dayOfWeek: "saturday" });
  const db = s.db;
  const labels = new Map<string, string>();
  const extraUsers: string[] = [];

  // The scenario's own parent/child/class become family 0 in class 0.
  const classIds: string[] = [s.classId];
  const classDays: string[] = ["saturday"];
  labels.set(s.classId, "C00");
  await must(db.from("classes").update({ title: "C00 Saturday" }).eq("id", s.classId), "rename c0");
  await s.setRate({ from: `${PREV}-01`, price: 30 });

  for (let c = 1; c < opts.classes; c++) {
    const day = DAYS[c % 7];
    const cls = await must(
      db.from("classes").insert({
        coach_id: s.coachId,
        title: `C${String(c).padStart(2, "0")} ${day}`,
        day_of_week: day,
        start_time: `${String(8 + (c % 10)).padStart(2, "0")}:00`,
        end_time: `${String(9 + (c % 10)).padStart(2, "0")}:00`,
        location_id: s.locationId,
        price_per_lesson: 25 + (c % 4) * 5,
        category_id: c % 3 === 0 ? s.categoryId2 : s.categoryId,
      }).select("id").single(),
      "class",
    ) as { id: string };
    classIds.push(cls.id);
    classDays.push(day);
    labels.set(cls.id, `C${String(c).padStart(2, "0")}`);
    await s.setRate({ from: `${PREV}-01`, price: 25 + (c % 4) * 5, classId: cls.id });
  }
  // Class 1 is repriced mid-month.
  if (classIds.length > 1) await s.setRate({ from: `${MONTH}-15`, price: 42, classId: classIds[1] });

  // ── Families ───────────────────────────────────────────────────────────
  // parentIds[i] is family i; family 0 is the scenario's own.
  const parentIds: string[] = [];
  const families: { parentId: string; kids: { studentId: string; classIdx: number }[] }[] = [];

  // Rewrite family 0's parent id to the fixed one (no references yet except parent_students).
  {
    const fixed = fixedParentId(0);
    await must(db.from("parent_students").delete().eq("parent_id", s.parentId), "unlink p0");
    await must(db.from("parents").update({ id: fixed }).eq("id", s.parentId), "fix p0 id");
    await must(db.from("parent_students").insert({ parent_id: fixed, student_id: s.studentId }), "relink p0");
    (s as { parentId: string }).parentId = fixed;
    parentIds.push(fixed);
    families.push({ parentId: fixed, kids: [{ studentId: s.studentId, classIdx: 0 }] });
    labels.set(fixed, "P000");
    labels.set(s.studentId, "P000-K0");
    await must(db.from("students").update({ full_name: "Kid P000-K0" }).eq("id", s.studentId), "rename k0");
  }

  const total = opts.classes * opts.perClass;
  for (let i = 1; i < total; i++) {
    const tag = `${s.tag}-${i}`;
    const { data: u, error } = await db.auth.admin.createUser({
      email: `bench-p${i}-${s.tag}@test.local`,
      password: "password123",
      email_confirm: true,
      user_metadata: { full_name: `Parent P${String(i).padStart(3, "0")}`, role: "parent" },
    });
    if (error || !u.user) throw new Error(`createUser ${tag}: ${error?.message}`);
    extraUsers.push(u.user.id);
    const fixed = fixedParentId(i);
    await must(db.from("parents").update({ id: fixed }).eq("profile_id", u.user.id), "fix parent id");
    parentIds.push(fixed);
    const plabel = `P${String(i).padStart(3, "0")}`;
    labels.set(fixed, plabel);
    families.push({ parentId: fixed, kids: [] });

    const classIdx = i % opts.classes;
    const kidCount = i % 5 === 0 && opts.classes > 1 ? 2 : 1;
    for (let k = 0; k < kidCount; k++) {
      const ci = (classIdx + k) % opts.classes;
      const stu = await must(
        db.from("students").insert({
          id: fixedStudentId(i, k),
          full_name: `Kid ${plabel}-K${k}`,
          assignment_status: "assigned",
          is_active: true,
          tenant_id: s.tenantId,
        }).select("id").single(),
        "student",
      ) as { id: string };
      labels.set(stu.id, `${plabel}-K${k}`);
      await must(db.from("parent_students").insert({ parent_id: fixed, student_id: stu.id }), "ps");
      families[i].kids.push({ studentId: stu.id, classIdx: ci });
    }
  }

  // Credit families: 1 and 2 (enrolled from September in their class).
  const creditFamilies = new Set([1, 2].filter((f) => f < families.length));
  for (let f = 0; f < families.length; f++) {
    for (const kid of families[f].kids) {
      if (f === 0) continue; // scenario already enrolled family 0
      await must(
        db.from("student_class_enrolments").insert({
          student_id: kid.studentId,
          class_id: classIds[kid.classIdx],
          is_active: true,
          enrolled_at: creditFamilies.has(f) ? `${PREV}-01` : `${MONTH}-01`,
        }),
        "enrol",
      );
    }
  }

  // ── September: only the credit families' class(es) have expected lessons.
  // Bill and seal it, then correct one lesson each → credit notes.
  const prevWin = monthEnded(PREV);
  const creditClassIdx = new Set<number>();
  for (const f of creditFamilies) for (const k of families[f].kids) creditClassIdx.add(k.classIdx);
  const prevSessions: { sid: string; studentId: string }[] = [];
  for (const ci of creditClassIdx) {
    for (const d of expectedLessonDates(classDays[ci], `${PREV}-01`, `${PREV}-30`)) {
      const sid = await s.addSession(d, classIds[ci]);
      // Every student enrolled in this class from September must be marked.
      for (const f of creditFamilies) {
        for (const k of families[f].kids) {
          if (k.classIdx !== ci) continue;
          await s.mark(sid, "present", k.studentId);
          prevSessions.push({ sid, studentId: k.studentId });
        }
      }
    }
  }
  if (creditFamilies.size) {
    const r = await opts.generate(db, { tenant_id: s.tenantId, mode: "manual", billing_month: PREV, now: prevWin.now });
    if (!String(r.status).startsWith("complete")) throw new Error(`Sept seed run: ${r.status} ${r.message ?? ""}`);
    // One correction per credit family → one credit note each.
    const done = new Set<string>();
    for (const p of prevSessions) {
      if (done.has(p.studentId)) continue;
      done.add(p.studentId);
      await s.mark(p.sid, "absent", p.studentId);
    }
  }

  // ── Package for family 3: draws at marking. ─────────────────────────────
  if (families.length > 3) {
    const prod = await must(
      db.from("package_products").insert({
        tenant_id: s.tenantId,
        name: `Bench 10 @ 28 (${s.tag})`,
        category_id: null,
        lesson_count: 10,
        rate_per_lesson: 28,
        validity_weeks: 52,
      }).select("id").single(),
      "package product",
    ) as { id: string };
    await must(
      db.from("parent_packages").insert({
        tenant_id: s.tenantId,
        parent_id: families[3].parentId,
        product_id: prod.id,
        status: "active",
        confirmed_at: `${MONTH}-01T04:00:00Z`,
        start_date: `${MONTH}-01`,
      }),
      "parent package",
    );
  }

  // ── Trial (category-priced) and make-up guest. ─────────────────────────
  await s.setTrialRate(s.categoryId, 18, `${PREV}-01`);
  let trialStudent: string | null = null;
  if (families.length > 4) {
    const stu = await must(
      db.from("students").insert({
        id: fixedStudentId(4, 999),
        full_name: `Kid P004-TRIAL`,
        assignment_status: "assigned",
        is_active: true,
        tenant_id: s.tenantId,
      }).select("id").single(),
      "trial student",
    ) as { id: string };
    trialStudent = stu.id;
    labels.set(stu.id, "P004-TRIAL");
    await must(db.from("parent_students").insert({ parent_id: families[4].parentId, student_id: stu.id }), "trial ps");
  }

  // ── October: session every expected date, mark everyone. ───────────────
  const classStudents = classIds.map(() => [] as string[]);
  for (const f of families) for (const k of f.kids) classStudents[k.classIdx].push(k.studentId);

  let markN = 0;
  for (let ci = 0; ci < classIds.length; ci++) {
    const dates = expectedLessonDates(classDays[ci], `${MONTH}-01`, `${MONTH}-31`);
    for (let di = 0; di < dates.length; di++) {
      const d = dates[di];
      const sid = await s.addSession(d, classIds[ci]);
      labels.set(sid, `${labels.get(classIds[ci])}@${d}`);
      const rained = di === 2 && ci % 2 === 1;
      for (const st of classStudents[ci]) {
        markN++;
        const status = rained ? "cancelled_rain" : markN % 7 === 0 ? "absent" : "present";
        await s.mark(sid, status, st);
      }
      // Trial on class 0's second lesson.
      if (ci === 0 && di === 1 && trialStudent) {
        await s.bookTrial(trialStudent, d, { classId: classIds[0] });
        await s.mark(sid, "trial_paid", trialStudent);
      }
      // Make-up: family 6's first kid guests into class 0's third lesson.
      if (ci === 0 && di === 2 && families.length > 6 && families[6].kids[0].classIdx !== 0) {
        const g = families[6].kids[0];
        await s.bookMakeup(g.studentId, d, { homeClassId: classIds[g.classIdx], classId: classIds[0] });
        await s.mark(sid, "present", g.studentId);
      }
    }
  }

  async function cleanup() {
    await db.from("package_applications").delete().in(
      "parent_package_id",
      ((await db.from("parent_packages").select("id").eq("tenant_id", s.tenantId)).data ?? []).map((r) => r.id),
    );
    await db.from("parent_packages").delete().eq("tenant_id", s.tenantId);
    await db.from("package_products").delete().eq("tenant_id", s.tenantId);
    await db.from("billing_runs").delete().eq("tenant_id", s.tenantId);
    await purgeTenantBulk(db, s.tenantId);
    // Credit + invoices for EVERY family (teardown only sweeps by tenant, which covers these).
    await s.teardown();
    for (const id of extraUsers) {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) console.error(`deleteUser ${id}: ${error.message}`);
    }
  }

  return { s, now: win.now, labels, cleanup };
}

/** Chunked delete of everything big in a tenant, so teardown's unchunked .in()
 *  lists stay short. Safe to run on a half-seeded or leaked tenant. */
export async function purgeTenantBulk(db: SupabaseClient, tenantId: string): Promise<void> {
  const chunk = async (table: string, col: string, ids: string[]) => {
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await db.from(table).delete().in(col, ids.slice(i, i + 100));
      if (error) throw new Error(`purge ${table}: ${error.message}`);
    }
  };
  const ids = async (table: string, col = "tenant_id", val = tenantId, sel = "id") =>
    // deno-lint-ignore no-explicit-any
    ((await db.from(table).select(sel).eq(col, val)).data ?? [] as any[]).map((r: any) => r[sel] as string);
  await db.from("makeup_bookings").delete().eq("tenant_id", tenantId);
  await db.from("trial_bookings").delete().eq("tenant_id", tenantId);
  const notes = await ids("credit_notes");
  await chunk("credit_applications", "credit_note_id", notes);
  await chunk("credit_notes", "id", notes);
  const invs = await ids("invoices");
  await chunk("credit_applications", "invoice_id", invs);
  await chunk("payment_records", "invoice_id", invs);
  await chunk("invoice_items", "invoice_id", invs);
  await chunk("invoices", "id", invs);
  const pkgs = await ids("parent_packages");
  await chunk("package_applications", "parent_package_id", pkgs);
  await db.from("parent_packages").delete().eq("tenant_id", tenantId);
  await db.from("package_products").delete().eq("tenant_id", tenantId);
  await db.from("billing_runs").delete().eq("tenant_id", tenantId);
  const classes = await ids("classes");
  const sessions: string[] = [];
  for (const c of classes) sessions.push(...(await ids("lesson_sessions", "class_id", c)));
  await chunk("attendance", "lesson_session_id", sessions);
  await chunk("lesson_sessions", "id", sessions);
  await chunk("student_class_enrolments", "class_id", classes);
  const students = await ids("students");
  await chunk("student_class_enrolments", "student_id", students);
  await chunk("parent_students", "student_id", students);
  await chunk("students", "id", students);
}
