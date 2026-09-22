// Every PostgREST read the coach Schedule tab makes (COACH_SCHEDULE_REFACTOR_PLAN.md,
// Stage 3). Each returns the RAW builder — no mapping, no error handling, no
// await — so the hook's Promise.all / await sites and its `data`-only reads are
// exactly what they were. Every chain is byte-identical to the one it replaced
// in app/(coach)/schedule/index.tsx, terminal included; the parameters carry
// the names the chains already used, so not one character inside them changed.
//
// ⚠ THE RANGE ARGUMENTS ARE THE CALLER'S. The hook passes [rangeStart, rangeEnd]
// — the UNION of the floor-scoped backlog and the visible week — and NEVER the
// week alone (the ⚠ BOUND THESE comment at the call site says why: §7.18).
//
// dao/ is transport only (fence check 2).

import { supabase } from "@/lib/supabase";
import { ROW_LIMIT, CLASS_SELECT } from "../constants";

type Coach = { id: string };

export const fetchCoach = (session: { id: string }) =>
  supabase.from("coaches").select("id").eq("profile_id", session.id).single();

export const fetchOwnedClasses = (coach: Coach) =>
  supabase
    .from("classes")
    .select(CLASS_SELECT)
    .eq("coach_id", coach.id)
    .eq("is_active", true)
    .order("start_time", { ascending: true });

// ⚠ BOUNDED BY THE SESSION'S DATE, THROUGH THE EMBED. `!inner` is what
// makes a filter on the embedded table narrow the parent rows rather than
// just the embed, and without it every assignment a coach has ever had
// comes back to be discarded on the device.
export const fetchRosterRows = (coach: Coach, rangeStart: string, rangeEnd: string) =>
  supabase
    .from("session_coaches")
    .select("lesson_session_id, lesson_sessions!inner(id, class_id, session_date)")
    .eq("coach_id", coach.id)
    .gte("lesson_sessions.session_date", rangeStart)
    .lte("lesson_sessions.session_date", rangeEnd)
    .limit(ROW_LIMIT);

// The classes I am covering INTO — same columns as my own, and deliberately
// WITHOUT `.eq("is_active", true)` (the call site's comment says why, §8i).
export const fetchCoveredClasses = (coveredClassIds: string[]) =>
  supabase.from("classes").select(CLASS_SELECT).in("id", coveredClassIds);

// ⚠ ACTIVE TODAY, not "on the lesson's date" — see the call site (20260812000200 §4).
export const fetchShadowAssignments = (coach: Coach, todayDate: string) =>
  supabase
    .from("class_shadow_coaches")
    .select("class_id, effective_from, effective_to")
    .eq("coach_id", coach.id)
    .lte("effective_from", todayDate)
    .or(`effective_to.is.null,effective_to.gte.${todayDate}`)
    .limit(ROW_LIMIT);

export const fetchShadowedClasses = (shadowClassIds: string[]) =>
  supabase.from("classes").select(CLASS_SELECT).in("id", shadowClassIds);

export const fetchWindowSessions = (classIds: string[], rangeStart: string, rangeEnd: string) =>
  supabase
    .from("lesson_sessions")
    .select("id, class_id, session_date, cancelled_at, attendance(student_id, status)")
    .in("class_id", classIds)
    .gte("session_date", rangeStart)
    .lte("session_date", rangeEnd)
    .limit(ROW_LIMIT);

export const fetchTrialBookings = (classIds: string[], rangeStart: string, rangeEnd: string) =>
  supabase
    .from("trial_bookings")
    .select("class_id, student_id, session_date")
    .is("cancelled_at", null)
    .in("class_id", classIds)
    .gte("session_date", rangeStart)
    .lte("session_date", rangeEnd)
    .limit(ROW_LIMIT);

export const fetchMakeupBookings = (classIds: string[], rangeStart: string, rangeEnd: string) =>
  supabase
    .from("makeup_bookings")
    .select("class_id, student_id, session_date")
    .is("cancelled_at", null)
    .in("class_id", classIds)
    .gte("session_date", rangeStart)
    .lte("session_date", rangeEnd)
    .limit(ROW_LIMIT);
