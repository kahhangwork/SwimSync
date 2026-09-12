// The Students feature's Postgres functions. Stage 3 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md.
//
// ⚠ THESE ARE NOT DATA ACCESS. They are business logic that lives in Postgres:
// multi-table atomic writes behind RLS, audit triggers, and the billing
// guards. They sit in their own file, apart from students.repo.ts, so that
// nobody ever reimplements one "for clarity" in TypeScript — in this codebase
// that is precisely how an override lands on a guard CLAUDE.md says must never
// have one.
//
//   The domain tier may ORCHESTRATE an rpc. It may never REPLACE one.
//
// FAILURE MODE of this file (plan §3): `permission denied` after a migration
// that forgot its GRANT (§7.87), or the function's own guard refusing the
// write with a sentence written for the admin to read. Surface those messages
// verbatim; do not reword them.
//
// NO LOGIC. Each function returns the raw `{ data, error }` the page's inline
// call did.

import { supabase } from "@/lib/supabase";
import * as studentStatus from "@/lib/studentStatus";

// ── Shared helpers from lib/studentStatus.ts, bound to this client ───────────
// The lib copy is drift-pinned to SwimSyncApp and takes the client as an
// argument so both apps can share it. Binding it here keeps the client out of
// every tier above dao/.

export const familyActiveChildren = (studentId: string) =>
  studentStatus.familyActiveChildren(supabase, studentId);

export const setStudentsActive = (studentIds: string[], active: boolean) =>
  studentStatus.setStudentsActive(supabase, studentIds, active);

export const removeFromClass = (studentId: string, classId: string) =>
  studentStatus.removeFromClass(supabase, studentId, classId);

/** Folds `duplicate` into `survivor`. Refuses the direction that would lose
 *  attendance history — offer only the direction it accepts. */
export const mergeStudents = (survivorId: string, duplicateId: string) =>
  supabase.rpc("merge_students", {
    p_survivor_id: survivorId,
    p_duplicate_id: duplicateId,
  });

/** The admin's ONLY sanctioned way to set a child's name. Never a raw
 *  `.update({ full_name })` — see updateStudentContact's payload note. */
export const renameStudent = (studentId: string, newName: string) =>
  supabase.rpc("rename_student", {
    p_student_id: studentId,
    p_new_name: newName,
  });

/** Per-child package verdict, category- and expiry-aware, computed in SQL. */
export const fetchPackageCoverage = () =>
  supabase.rpc("student_package_coverage");

/** Advisory duplicate check before an add. The caller FAILS OPEN on any
 *  error — students_identity_uniq is the real floor. */
export const findRosterDuplicates = (args: {
  p_tenant_id: string | null;
  p_full_name: string;
  p_phone: string | null;
  p_dob: string | null;
}) => supabase.rpc("find_roster_duplicates", args);

/** Creates a child with no parent yet, and an OPEN 'ongoing' enrolment dated
 *  from now — so the completeness gate expects them from today, not before. */
export const addUnclaimedStudent = (args: {
  p_class_id: string;
  p_full_name: string;
  p_kind: "ongoing";
  p_date_of_birth: string | null;
  p_contact_phone: string | null;
  p_contact_email: string | null;
}) => supabase.rpc("add_unclaimed_student", args);
