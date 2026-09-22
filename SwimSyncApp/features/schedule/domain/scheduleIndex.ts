// The maps and flags the Schedule tab's load builds from its raw rows — the pure
// half of loadData (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 2). Every body is
// moved VERBATIM from app/(coach)/schedule/index.tsx; only the signatures and
// the returns are new. NO CLOCK here: nothing reads the date or the time.
import type { DbStatus } from "@/lib/attendanceSummary";
import { ROW_LIMIT } from "../constants";

/** The classes I am covering INTO — see the covered-classes read in loadData. */
export function coveredClassIdsOf(
  rosteredDates: Map<string, string[]>,
  ownedClassIds: Set<string>
): string[] {
  return [...rosteredDates.keys()].filter(
    (id) => !ownedClassIds.has(id)
  );
}

/** The classes I shadow, minus any I own or cover (a class appears once). */
export function shadowClassIdsOf(
  shadowRows: any[] | null,
  ownedClassIds: Set<string>,
  coveredClassIds: string[]
): string[] {
  return [
    ...new Set((shadowRows ?? []).map((r: any) => r.class_id as string)),
  ].filter((id) => !ownedClassIds.has(id) && !coveredClassIds.includes(id));
}

export type CoachClass = { cls: any; owned: boolean; shadowed: boolean };

export function coachClassesOf(
  ownedClasses: any[],
  coveredRes: { data: any[] | null },
  shadowRes: { data: any[] | null },
  shadowedClassIds: Set<string>
): CoachClass[] {
  /** Every class a card can come from, each carrying whether it is mine and
   *  whether I merely shadow it. The two flags are never both true — the
   *  database refuses a shadow assignment on a class the coach owns. */
  const coachClasses: { cls: any; owned: boolean; shadowed: boolean }[] = [
    ...ownedClasses.map((cls: any) => ({ cls, owned: true, shadowed: false })),
    ...((coveredRes.data ?? []) as any[]).map((cls: any) => ({
      cls,
      owned: false,
      shadowed: false,
    })),
    ...((shadowRes.data ?? []) as any[]).map((cls: any) => ({
      cls,
      owned: false,
      shadowed: shadowedClassIds.has(cls.id),
    })),
  ];
  return coachClasses;
}

export type SessionInfo = {
  id: string;
  /** Cancelled in advance by the admin (cancel_lesson): expects nobody
   *  enrolled, takes no marks (the DB trigger refuses — this is cosmetic). */
  cancelled: boolean;
  markedStudentIds: Set<string>;
  statusByStudent: Map<string, DbStatus>;
};

export function sessionIndex(windowSessions: any[]): {
  sessionByClassDate: Map<string, SessionInfo>;
  sessionDatesByClass: Map<string, string[]>;
} {
  // key: "<class_id>:<session_date>"
  const sessionByClassDate = new Map<
    string,
    {
      id: string;
      /** Cancelled in advance by the admin (cancel_lesson): expects nobody
       *  enrolled, takes no marks (the DB trigger refuses — this is cosmetic). */
      cancelled: boolean;
      markedStudentIds: Set<string>;
      statusByStudent: Map<string, DbStatus>;
    }
  >();
  // Dates that HAVE a session, per class. Needed because a lesson can exist
  // without being derivable from the class's weekday — an off-schedule lesson
  // scheduled by the admin (schedule_extra_lesson) is exactly that. Without
  // this the coach would never see it, while the billing engine's gate DOES
  // (its datesToCheck unions existing session dates), so the month would
  // stall with nothing anywhere saying why.
  const sessionDatesByClass = new Map<string, string[]>();
  windowSessions.forEach((s: any) => {
    sessionByClassDate.set(`${s.class_id}:${s.session_date}`, {
      id: s.id,
      cancelled: s.cancelled_at != null,
      markedStudentIds: new Set(
        (s.attendance ?? []).map((a: any) => a.student_id)
      ),
      statusByStudent: new Map(
        (s.attendance ?? []).map((a: any) => [a.student_id, a.status])
      ),
    });
    const dates = sessionDatesByClass.get(s.class_id as string) ?? [];
    dates.push(s.session_date as string);
    sessionDatesByClass.set(s.class_id as string, dates);
  });
  return { sessionByClassDate, sessionDatesByClass };
}

export function bookedIndex(
  bookingRows: any[],
  makeupRows: any[]
): Map<string, Map<string, string[]>> {
  const bookedByClassDate = new Map<string, Map<string, string[]>>();
  for (const b of [...bookingRows, ...makeupRows]) {
    const perClass =
      bookedByClassDate.get(b.class_id as string) ?? new Map<string, string[]>();
    const list = perClass.get(b.session_date as string) ?? [];
    list.push(b.student_id as string);
    perClass.set(b.session_date as string, list);
    bookedByClassDate.set(b.class_id as string, perClass);
  }
  return bookedByClassDate;
}

// A result that exactly fills its limit is indistinguishable from a
// truncated one, so treat it as truncated and SAY SO on screen rather than
// rendering a quietly short list that reads as "you are up to date".
export function isTruncated({
  windowSessions,
  bookingRows,
  makeupRows,
  rosterRes,
}: {
  windowSessions: any[];
  bookingRows: any[];
  makeupRows: any[];
  rosterRes: { data: any[] | null };
}): boolean {
  return (
    windowSessions.length >= ROW_LIMIT ||
      bookingRows.length >= ROW_LIMIT ||
      makeupRows.length >= ROW_LIMIT ||
      // The roster fetch is capped like the others, and a truncated one drops
      // lessons a substitute is expected to mark — the same silent shortfall,
      // one table further on. Counted on the RAW rows, not the parsed ones:
      // parsing drops a row whose lesson did not come back, which would hide
      // a response that really did fill its limit.
      (rosterRes.data?.length ?? 0) >= ROW_LIMIT
  );
}
