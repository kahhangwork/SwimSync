// Every PostgREST read and write the parent Home tab makes
// (docs/refactor/BATCH_FGH_PLAN.md, App L-F). Each returns the RAW builder — no
// mapping, no error handling, no await — so the hook's await / Promise.all sites
// and its `data`-only reads are exactly what they were. Every chain is
// byte-identical to the one it replaced in app/(parent)/home/index.tsx.
//
// dao/ is transport only (fence check 2).

import { supabase } from "@/lib/supabase";
import type { DataOf, RlsNullable } from "@/lib/database.overrides";
import { todayInSg } from "@/lib/lessonDates";

type Session = { id: string };

// Fetch parent record with children and their enrolments
export const fetchParentHome = (session: Session) =>
  supabase
    .from("parents")
    .select(`
        id,
        parent_tenant_balances(credit_balance),
        parent_students(
          students(
            id,
            full_name,
            assignment_status,
            is_active,
            student_class_enrolments(
              is_active,
              classes(
                day_of_week,
                start_time,
                end_time,
                locations(name),
                coaches(
                  profiles(full_name)
                )
              )
            )
          )
        )
      `)
    .eq("profile_id", session.id)
    .single();

export const fetchUpcomingTrials = (ids: string[]) =>
  supabase
    .from("trial_bookings")
    .select("student_id, session_date, classes(title)")
    .in("student_id", ids)
    .is("cancelled_at", null)
    .gte("session_date", todayInSg())
    .order("session_date");

// Make-ups too: an enrolled child guesting one lesson in another
// class. WHEN and WHERE is the whole question the family has.
export const fetchUpcomingMakeups = (ids: string[]) =>
  supabase
    .from("makeup_bookings")
    .select(
      "student_id, session_date, classes!makeup_bookings_class_id_fkey(title)"
    )
    .in("student_id", ids)
    .is("cancelled_at", null)
    .gte("session_date", todayInSg())
    .order("session_date");

// Fetch total outstanding invoices for this parent
export const fetchOutstandingInvoices = (parentId: string) =>
  supabase
    .from("invoices")
    .select("net_amount")
    .eq("parent_id", parentId)
    .eq("status", "outstanding");

export const fetchOpenClaims = (parentId: string) =>
  supabase
    .from("student_claims")
    .select("id, claimed_name, status, created_at")
    .eq("parent_id", parentId)
    .in("status", ["pending", "declined"])
    // Without this a declined claim's notice is PERMANENT — there was no
    // dismissal and no time bound, so "your coach checked" became a fixture
    // of the home screen forever. Reported from production 2026-07-26.
    .is("dismissed_at", null)
    .order("created_at", { ascending: false });

export const fetchSignupJoinCode = (session: Session) =>
  supabase
    .from("parents")
    .select("id, signup_join_code")
    .eq("profile_id", session.id)
    .single();

export const clearSignupJoinCode = (parentId: string) =>
  supabase.from("parents").update({ signup_join_code: null }).eq("id", parentId);

// ── Row types, derived from the selects above (Wave 8) ──────────────────────
// Every to-one embed is a LEFT join RLS can null (§7.344): a link's student, an
// enrolment's class, the class's location and coach, the coach's profile, a booking's
// class. Widened `| null` here; the reads in domain/homeRows keep every `?.`/`??`.
type HomeData = DataOf<typeof fetchParentHome>;
type HomeStudent = NonNullable<HomeData["parent_students"][number]["students"]>;
type HomeEnrolment = HomeStudent["student_class_enrolments"][number];
type HomeClass = NonNullable<HomeEnrolment["classes"]>;
export type HomeClassRow = Omit<RlsNullable<HomeClass, "locations">, "coaches"> & {
  coaches: RlsNullable<NonNullable<HomeClass["coaches"]>, "profiles"> | null;
};
export type HomeStudentRow = Omit<HomeStudent, "student_class_enrolments"> & {
  student_class_enrolments: (Omit<HomeEnrolment, "classes"> & { classes: HomeClassRow | null })[];
};
export type ParentHomeRow = Omit<HomeData, "parent_students"> & {
  parent_students: { students: HomeStudentRow | null }[];
};
export type HomeBookingRow =
  | RlsNullable<DataOf<typeof fetchUpcomingTrials>[number], "classes">
  | RlsNullable<DataOf<typeof fetchUpcomingMakeups>[number], "classes">;
export type HomeOutstandingRow = DataOf<typeof fetchOutstandingInvoices>[number];
