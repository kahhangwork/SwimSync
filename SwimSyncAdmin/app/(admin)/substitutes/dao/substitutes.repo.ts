// dao/ — data access for the Substitutes page. Transport only (no React, no
// presentation — tierBoundaries check 2). The client is bound here; the page
// and hook never import @/lib/supabase (check 4).
//
// The three load-bearing rules (see the page header) live in HOW these are
// written: the main coach is ALWAYS written through assign_session_coach()
// (never insert/upsert — the partial unique index), and no lesson_session_id is
// ever handled on the write path (the RPC resolves-or-creates from class+date).
import { supabase } from "@/lib/supabase";
import type { SessionCoachRow } from "@/lib/sessionRoster";

/** Class + coach pickers. Inactive classes are included and labelled. */
export async function loadPickerData(): Promise<{
  classRows: unknown[];
  coachRows: unknown[];
  error: string | null;
}> {
  const [{ data: classData, error: classErr }, { data: coachData, error: coachErr }] =
    await Promise.all([
      supabase
        .from("classes")
        .select("id, title, day_of_week, is_active, coach_id, coaches(id, profiles(full_name))")
        .order("title"),
      supabase.from("coaches").select("id, profiles(full_name)"),
    ]);
  return {
    classRows: classData ?? [],
    coachRows: coachData ?? [],
    error: (classErr ?? coachErr)?.message ?? null,
  };
}

/** The month's existing session rows (the only source of an off-pattern extra). */
export async function loadMonthSessions(
  classId: string,
  start: string,
  end: string
): Promise<{ data: { id: string; session_date: string }[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from("lesson_sessions")
    .select("id, session_date")
    .eq("class_id", classId)
    .gte("session_date", start)
    .lte("session_date", end);
  return { data: data as { id: string; session_date: string }[] | null, error: error?.message ?? null };
}

/** Roster rows for the given sessions. */
export async function loadSessionCoaches(
  sessionIds: string[]
): Promise<{ data: SessionCoachRow[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from("session_coaches")
    .select("id, lesson_session_id, coach_id")
    .in("lesson_session_id", sessionIds);
  return { data: (data ?? null) as SessionCoachRow[] | null, error: error?.message ?? null };
}

/** Assign (or change) the main coach for a lesson. Resolves-or-creates the session. */
export async function assignSessionCoach(
  classId: string,
  date: string,
  coachId: string
): Promise<string | null> {
  const { error } = await supabase.rpc("assign_session_coach", {
    p_class_id: classId,
    p_session_date: date,
    p_coach_id: coachId,
  });
  return error?.message ?? null;
}

/** Clear an assigned roster row by its own id (an existing row always has one). */
export async function removeSessionCoach(rowId: string): Promise<string | null> {
  const { error } = await supabase.from("session_coaches").delete().eq("id", rowId);
  return error?.message ?? null;
}
