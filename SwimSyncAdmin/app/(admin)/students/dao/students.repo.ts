// The Students feature's PostgREST access — every `.from()` the page makes,
// and nothing else. Stage 2 of docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md.
//
// FAILURE MODE of this file (plan §3): RLS denial, an empty result, or the
// 1000-row PostgREST cap (`ROW_LIMIT`). Postgres functions live in
// students.rpc.ts and the server route in students.api.ts, because they fail
// differently and the tier above must be able to tell.
//
// NO LOGIC. Each function returns the raw supabase result — `{ data, error }`
// or `{ count, error }` — exactly as the page's inline call did, so every
// caller's handling is unchanged. The row → entity mapping (plan §4) moves
// here with slice 1 (Stage 4); until then it stays in page.tsx where it was.
//
// The comments on each query travelled with it. They explain WHY a select is
// shaped the way it is, and several of them are load-bearing (§7.28).

import { supabase } from "@/lib/supabase";
import { ilikeContains } from "@/lib/tableSearch";
import { ROW_LIMIT } from "../constants";
import type { SearchField } from "../types";

// ── Session ─────────────────────────────────────────────────────────────────

export const getCurrentUser = () => supabase.auth.getUser();

// ── The list ────────────────────────────────────────────────────────────────

/**
 * The page's one big query. `term` is already trimmed by the caller.
 *
 * ⚠ THE EMBED IS !inner ONLY WHILE SEARCHING BY PARENT. A plain (left) embed
 * does NOT let a filter on `parent_students.parents.profiles.full_name`
 * restrict the student rows — it returns every student with a null embed, a
 * silently WRONG answer (the plan's own worse-than-the-cap trap). !inner
 * makes the filter a real join. It also drops parentless children, which is
 * CORRECT for a parent-name search: a child with no parent cannot match one.
 * Left plain otherwise, so the default list keeps parentless children.
 * NOTE: while searching by parent, the embed is narrowed to the MATCHING
 * parent, so a two-parent child shows (and `parent_id` tracks) the searched
 * parent — intended for a parent search. Row actions are unaffected: the
 * Contact modal re-reads all parents fresh, and Invite only shows for a
 * child with NO parent (which a parent search cannot return).
 */
export function fetchStudents(term: string, searchField: SearchField) {
  const searchingParent = term !== "" && searchField === "parent";
  const parentEmbed = searchingParent
    ? "parent_students!inner(parents!inner(id, profiles!inner(full_name)))"
    : "parent_students(parents(id, profiles(full_name)))";

  let query = supabase
    .from("students")
    .select(`
        id, full_name, date_of_birth, level_id, assignment_status, is_active, inactivated_at,
        tenant_levels(id, label),
        ${parentEmbed},
        student_class_enrolments(
          is_active,
          classes(id, title, day_of_week, start_time, coaches(profiles(full_name)))
        )
      `)
    .order("full_name")
    .limit(ROW_LIMIT);

  // Scoped, in the DB: one column per field, as a bound `.ilike` parameter, so
  // a `, ( )` in a name is data, never grammar (`lib/tableSearch.ts`).
  if (term !== "") {
    query =
      searchField === "parent"
        ? query.ilike("parent_students.parents.profiles.full_name", ilikeContains(term))
        : query.ilike("full_name", ilikeContains(term));
  }

  return query;
}

/** Every attendance row's student_id — the caller counts lessons per child. */
export const fetchAttendanceStudentIds = () =>
  supabase.from("attendance").select("student_id");

// ── Enrolment ───────────────────────────────────────────────────────────────

export const insertEnrolment = (studentId: string, classId: string) =>
  supabase.from("student_class_enrolments").insert({
    student_id: studentId,
    class_id: classId,
    is_active: true,
  });

/** Only ever moves TOWARD assigned. close_student_enrolment() owns the other
 *  direction, and only when the last class goes. */
export const markAssigned = (studentId: string) =>
  supabase
    .from("students")
    .update({ assignment_status: "assigned" })
    .eq("id", studentId);

/** RLS already scopes a tenant_admin to their own business's classes. */
export const fetchActiveClasses = () =>
  supabase
    .from("classes")
    .select("id, title")
    .eq("is_active", true)
    .order("title");

// ── Levels & grading ────────────────────────────────────────────────────────

/** RLS scopes this to the caller's own business. Ordered by sort_order, not
 *  by label — a ladder sorted alphabetically puts "Advanced" above
 *  "Beginner", which is why sort_order exists at all. */
export const fetchLevels = () =>
  supabase
    .from("tenant_levels")
    .select("id, label")
    .order("sort_order")
    .order("label");

export const fetchLevelsWithSkills = () =>
  supabase
    .from("tenant_levels")
    .select("id, label, sort_order, tenant_level_skills(id, label, sort_order)")
    .order("sort_order");

export const fetchGradeScale = () =>
  supabase.from("skill_grade_levels").select("id, rank, label").order("rank");

export const fetchSkillProgress = (studentId: string) =>
  supabase
    .from("student_skill_progress")
    .select("student_id, skill_id, grade_level_id, graded_at")
    .eq("student_id", studentId);

export const updateStudentLevel = (studentId: string, levelId: string | null) =>
  supabase.from("students").update({ level_id: levelId }).eq("id", studentId);

// ── Contact ─────────────────────────────────────────────────────────────────

export const fetchStudentContact = (studentId: string) =>
  supabase
    .from("students")
    .select(
      `provisional_contact_name, provisional_contact_phone, provisional_contact_email,
         parent_students(parents(id, profiles(full_name, email, phone)))`
    )
    .eq("id", studentId)
    .single();

export const countPendingClaims = (studentId: string) =>
  supabase
    .from("student_claims")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("status", "pending");

/** ⚠ AN EXPLICIT THREE-KEY PAYLOAD, and the caller must keep it so. Never
 *  spread a row object in: a stray full_name silently rewrites a child's
 *  identity. The SANCTIONED way to change full_name is rename_student(). */
export const updateStudentContact = (
  studentId: string,
  contact: {
    provisional_contact_name: string | null;
    provisional_contact_phone: string | null;
    provisional_contact_email: string | null;
  }
) => supabase.from("students").update(contact).eq("id", studentId);

// ── Referrals (drawer) ──────────────────────────────────────────────────────

export const countReferredBy = (parentId: string) =>
  supabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referee_parent_id", parentId);

export const countConvertedReferrals = (parentId: string) =>
  supabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_parent_id", parentId)
    .eq("status", "converted");

// ── Tenant package settings (plan §10: belongs on Packages, extracted in place)

/** !tenant_id disambiguates: tenants also references profiles via
 *  owner_profile_id (20260806000100), so a bare embed is refused. */
export const fetchTenantPackageSettings = (userId: string | undefined) =>
  supabase
    .from("profiles")
    .select(
      "tenant_id, tenants!tenant_id(low_package_lessons, package_expiry_warning_days)"
    )
    .eq("id", userId)
    .single();

export const updateLowPackageLessons = (tenantId: string, value: number) =>
  supabase
    .from("tenants")
    .update({ low_package_lessons: value })
    .eq("id", tenantId);

export const updatePackageExpiryDays = (tenantId: string, value: number) =>
  supabase
    .from("tenants")
    .update({ package_expiry_warning_days: value })
    .eq("id", tenantId);
