// Data access for the Classes page — every PostgREST `.from()` this page makes,
// as a thin function returning the raw builder ({ data, error } awaited by the
// caller). No mapping, no logic: the page's error handling and the shapes it
// reads must not change by one character. Mapping lives in domain/classRows.ts;
// orchestration (Promise.all, the clock) lives in the hooks.
import { supabase } from "@/lib/supabase";
import { ROW_LIMIT } from "../constants";

// ⚠ RETIRED CLASSES ARE LOADED, AND THAT IS LOAD-BEARING, NOT COSMETIC.
// This used to be `.eq("is_active", true)`. Since the invoice engine stopped
// skipping inactive classes, one of them CAN block a billing month — and the
// coach class list and the coach Schedule tab both still filter `is_active`,
// so this page is the only screen in the product that can show such a class
// at all. Filter it here and `reactivate_class()` has nowhere to be called
// from: the month blocks, nobody can see why, and there is no override on the
// block by design. Retired rows are hidden behind a UI toggle, never by the
// query. (⚠ RISK 3 — the SHAPE of this query is pinned by
// domain/classesQueryShape.test.ts; do NOT add an is_active filter here.)
export function loadClasses() {
  return supabase
    .from("classes")
    .select(
      "id, coach_id, title, day_of_week, start_time, end_time, location_id, price_per_lesson, category_id, capacity, colour, is_active, deactivated_at, coaches(profiles(full_name)), locations(name), class_categories(default_capacity), student_class_enrolments(id, is_active)"
    )
    .order("day_of_week")
    .order("start_time")
    .limit(ROW_LIMIT);
}

export function loadCoaches() {
  return supabase.from("coaches").select("id, profiles(full_name)");
}

// The shadow-rate read, folded into loadCoaches() by the hook via Promise.all.
export function loadShadowRates() {
  return supabase
    .from("coach_rates")
    .select("coach_id, effective_from")
    .eq("role", "shadow");
}

export function loadCategories() {
  return supabase
    .from("class_categories")
    .select("id, name, default_capacity")
    .order("name");
}

// Every location for the business (RLS-scoped), archived included — the form
// picker needs an archived one to represent a reactivated class's current
// value (RISK 6), and the name lookup covers retired classes sitting on an
// archived location. Ordered the way the picker shows them.
export function loadLocations() {
  return supabase
    .from("locations")
    .select("id, name, address, archived_at")
    .order("sort_order")
    .order("name");
}

// ⚠ THE ROSTER IS FETCHED SEPARATELY FROM THE CLASS LIST, ON PURPOSE.
// PostgREST returns null for the ENTIRE select when one embed fails — a policy
// gap, an ambiguous relationship, a typo in the nesting. Bolting these joins
// onto loadClasses()'s select would mean any of those blanks every class from
// this page, rather than degrading one drawer. So the class list keeps the
// query it has always had, and the roster is its own two reads. See §7.52.
export function loadEnrolments() {
  return supabase
    .from("student_class_enrolments")
    .select(
      "class_id, is_active, enrolled_at, student_id, students(full_name, tenant_levels(label))"
    )
    .eq("is_active", true);
}

// Cancelled and past bookings are excluded here AND again in buildClassRoster —
// the count must not include a guest who is not coming, and one definition of
// "upcoming" (>= today, in SGT) is already shared with the coach roster and
// Unassigned Children. `today` is a PARAMETER (⚠ RISK 6 / §7.7): the dao reads
// no clock — the hook reads the SGT date once and passes it in.
export function loadUpcomingBookings(today: string) {
  return supabase
    .from("trial_bookings")
    .select(
      "class_id, session_date, student_id, cancelled_at, students(full_name, tenant_levels(label))"
    )
    .is("cancelled_at", null)
    .gte("session_date", today);
}

// The drawer's shadow list for one class. ENDED assignments are returned too
// (the hook renders them) — an ended one still explains money.
export function loadShadows(classId: string) {
  return supabase
    .from("class_shadow_coaches")
    .select("id, coach_id, effective_from, effective_to")
    .eq("class_id", classId)
    .order("effective_from", { ascending: false });
}

// Create a class — a plain insert (the seed trigger gives it floor-dated terms).
// The caller passes the whole row including `is_active: true`; the dao adds
// nothing. Editing goes through set_class_terms (classes.rpc.ts), never here.
export function insertClass(row: Record<string, unknown>) {
  return supabase.from("classes").insert(row);
}

// The plain UPDATE for the three NON-terms fields (category/capacity/colour) —
// SCOPE and display, not money, so NOT effective-dated and NOT in set_class_terms.
// ONE statement for all three: one failure mode, one "Saved, but…" message.
export function updateClassMeta(
  id: string,
  fields: { category_id: string | null; capacity: number | null; colour: string | null }
) {
  return supabase.from("classes").update(fields).eq("id", id);
}
