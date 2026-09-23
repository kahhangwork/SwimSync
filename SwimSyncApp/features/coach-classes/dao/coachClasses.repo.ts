// Every PostgREST read the coach Classes tab makes (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H). Raw builders, byte-identical to the chains they replaced in
// app/(coach)/classes/index.tsx.
//
// ⚠ `.order("day_of_week")` sorts in WEEK order only because the Postgres enum is
// declared Monday-first — see WEEK_ORDER in domain/weekOrder.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

type Session = { id: string };

export const fetchCoach = (session: Session) =>
  supabase
    .from("coaches")
    .select("id")
    .eq("profile_id", session.id)
    .single();

export const fetchCoachClasses = (coachId: string) =>
  supabase
    .from("classes")
    .select(`
        id,
        title,
        day_of_week,
        start_time,
        end_time,
        location_id,
        locations(name),
        price_per_lesson,
        student_class_enrolments(id, is_active)
      `)
    .eq("coach_id", coachId)
    .eq("is_active", true)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });
