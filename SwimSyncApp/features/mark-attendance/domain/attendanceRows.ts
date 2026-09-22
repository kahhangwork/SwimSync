// The pure half of the marking screen's load() (COACH_ATTENDANCE_REFACTOR_PLAN.md,
// Stage 2) — every body moved verbatim from app/(coach)/classes/[id]/attendance.tsx.
// No clock reads: `date` is always an argument (the plan's PROHIBITION), so the
// screen's two todayInSg() reads stay where they were.
import { toSgDate } from "@/lib/lessonDates";
import type { MarkableCheck } from "@/lib/attendanceWindow";
import type { AttState, DBStatus, StudentRow } from "../types";
import { formatDate, fromDBStatus, toDBStatus } from "./attendanceStatus";

// ── THE ROSTER FOR A DATE IS THE ROSTER AS IT WAS ON THAT DATE ──────────
// This used to filter on `is_active` alone, with no reference to `date` at
// all — so opening any past lesson showed TODAY'S roster. A child who
// joined last month appeared on a lesson from before they existed here,
// and because the save refuses until every student on screen has a status,
// the coach was FORCED to record attendance for a child who was not there.
//
// Both ends inclusive, matching EnrolmentSpan: a trial walk-in's enrolment
// opens and closes on its own date, and an exclusive end would drop them
// from the very screen that is marking them.
export function enrolledOn(enrolments: any[] | null | undefined, date: string): StudentRow[] {
  return (enrolments ?? [])
    .filter((e: any) => {
      const from = toSgDate(e.enrolled_at);
      const until = e.unenrolled_at ? toSgDate(e.unenrolled_at) : null;
      return from <= date && (until === null || date <= until);
    })
    .map((e: any) => ({
      id: e.students.id,
      full_name: e.students.full_name,
    }));
}

/** One of mergeRoster's three non-enrolled inputs: the joined `students` of an
 *  attendance, trial-booking or make-up-booking row, a null join dropped. The
 *  route called this chain inline three times; it is one function now, still
 *  called three times, in the same order. */
export function guestRows(rows: any[] | null | undefined): StudentRow[] {
  return (rows ?? [])
    .map((a: any) => a.students)
    .filter(Boolean)
    .map((s: any) => ({ id: s.id, full_name: s.full_name }));
}

// Pre-fill attendance from existing records (or default to present)
export function initialAttendance(
  roster: readonly StudentRow[],
  attData: any[] | null | undefined,
  sid: string | null
): Record<string, AttState> {
  const initAtt: Record<string, AttState> = {};
  if (sid) {
    for (const student of roster) {
      const existing = (attData ?? []).find(
        (a: any) => a.student_id === student.id
      );
      if (existing) {
        const parsed = fromDBStatus(existing.status as DBStatus);
        initAtt[student.id] = {
          top: parsed.top,
          sub: parsed.sub,
        };
      } else {
        initAtt[student.id] = { top: "unmarked", sub: null };
      }
    }
  } else {
    for (const student of roster) {
      initAtt[student.id] = { top: "unmarked", sub: null };
    }
  }
  return initAtt;
}

// The statuses AS LOADED, for the credit-note-email check in handleSave. A note
// can only be issued when a lesson LEAVES a billable status, so this is what lets
// the common save skip the edge-function round trip entirely.
export function loadedStatusesOf(
  initAtt: Record<string, AttState>
): Record<string, DBStatus | null> {
  return Object.fromEntries(
    Object.entries(initAtt).map(([id, st]) => [id, toDBStatus(st.top, st.sub)])
  );
}

/** session_shadow_coaches() rows -> the Coaches present list, pre-ticked. */
export function shadowRows(
  shadowRoster: any[] | null | undefined
): { coach_id: string; name: string; present: boolean }[] {
  return (shadowRoster ?? []).map((r: any) => ({
    coach_id: r.coach_id,
    name: r.full_name ?? "Unknown coach",
    present: !r.absent,
  }));
}

/** The notice for a lesson the admin cancelled in advance.
 *  ⚠ `classTitle` is whatever the CALLER passes, and the route passes the
 *  `classTitle` STATE from load()'s closure — the previous render's value, not
 *  this class's (setClassTitle has not re-rendered yet). A cold open therefore
 *  reads "this lesson". Preserved (rule 0); never visible today anyway, because
 *  the cancelled branch never sets `resolved` and the spinner holds (plan §6
 *  Stage 3, BACKLOG). */
export function cancelledBlock(
  classTitle: string,
  date: string,
  reason: string | null
): MarkableCheck {
  return {
    ok: false,
    title: "This lesson was cancelled",
    detail: `Your business's admin cancelled ${classTitle || "this lesson"} on ${formatDate(date)}${
      reason ? ` — ${reason}` : ""
    }. Nothing is marked for a cancelled lesson; if it is going ahead after all, ask them to restore it.`,
  };
}
