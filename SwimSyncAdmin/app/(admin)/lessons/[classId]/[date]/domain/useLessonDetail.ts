"use client";

// The admin lesson page's SPINE: the one load effect, every value it loads, the
// attendance draft it seeds, and the values derived from them. Stage 2 of
// docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md — the effect body moved verbatim.
//
// ⚠ Plan §5 RISK 2 — keep all of these exactly as they are:
//   • fetchMarkableFloor() starts BEFORE the Promise.all and is awaited LAST;
//   • `stale` is checked after each of the three awaits;
//   • the error chain is `??` over EIGHT results in this order, and the tenants,
//     students, getSession and session-scoped reads are deliberately unchecked;
//   • setLoading(true) on EVERY reload — the page unmounts everything below its
//     loading switch (§7.249), so no state may move into a ui/ component;
//   • `today` / `validDate` are plain per-render expressions — never memoised
//     (a frozen `today` would freeze isFuture/markability across SGT midnight).

import { useCallback, useEffect, useMemo, useState } from "react";
import { dayOfWeekOf, todayInSg } from "@/lib/lessonDates";
import { isFull } from "@/lib/calendarLessons";
import { attributeLessons, termsCoachOn, type AbsenceRow, type ClassRateRow, type ClassShadowRow, type SubstituteRow } from "@/lib/lessonAttribution";
import { fetchMarkableFloor, loadLessonReads, loadSessionReads } from "../dao/lessonDetail.repo";
import { lessonMarkability, type DbStatus } from "./lessonMarking";
import { buildRoster, classInfoFrom, coachListFrom, eligibleKidsFrom, trialKidsFrom } from "./lessonDetailRows";
import type { ClassInfo, CoachOpt, EligibleKid, RosterRow } from "../types";

export function useLessonDetail(classId: string, date: string) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cls, setCls] = useState<ClassInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Set when the admin cancelled this lesson in advance (cancel_lesson). */
  const [cancelled, setCancelled] = useState<{ reason: string | null } | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [draft, setDraft] = useState<Record<string, DbStatus | null>>({});
  const [coaches, setCoaches] = useState<CoachOpt[]>([]);
  const [attr, setAttr] = useState<{ mainId: string | null; isCover: boolean; subRowId: string | null; shadowIds: string[] } | null>(null);
  const [termsCoachId, setTermsCoachId] = useState<string | null>(null);
  const [floor, setFloor] = useState<string | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [holidayDays, setHolidayDays] = useState<number>(7);
  const [kids, setKids] = useState<EligibleKid[]>([]);
  const [trialKids, setTrialKids] = useState<{ id: string; full_name: string }[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  const today = todayInSg();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!validDate) {
      setLoading(false);
      setLoadError("That date isn't valid.");
      return;
    }
    let stale = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      const floorP = fetchMarkableFloor();
      const [{ data: sess }, clsRes, sessionRes, coachesRes, enrolRes, trialsRes, makeupsRes, ratesRes, shadowsRes, tenantRes, kidsRes] =
        await loadLessonReads(classId, date);
      if (stale) return;

      const firstErr = clsRes.error ?? sessionRes.error ?? coachesRes.error ?? enrolRes.error ?? trialsRes.error ?? makeupsRes.error ?? ratesRes.error ?? shadowsRes.error;
      if (firstErr) {
        setLoadError(firstErr.message);
        setLoading(false);
        return;
      }
      if (!clsRes.data) {
        setLoadError("That class does not exist, or is not in your business.");
        setLoading(false);
        return;
      }

      const c: any = clsRes.data;
      const info: ClassInfo = classInfoFrom(c);
      setCls(info);
      setActorId(sess.session?.user.id ?? null);
      setHolidayDays(Number(tenantRes.data?.holiday_extension_days ?? 7));
      const sid = (sessionRes.data?.id as string | undefined) ?? null;
      setSessionId(sid);
      const sessRow = sessionRes.data as { cancelled_at?: string | null; cancellation_reason?: string | null } | null;
      setCancelled(sessRow?.cancelled_at ? { reason: sessRow.cancellation_reason ?? null } : null);

      const coachList: CoachOpt[] = coachListFrom((coachesRes.data ?? []) as any[]);
      setCoaches(coachList);

      // Attendance + substitute only exist when the session does.
      let marks = new Map<string, DbStatus>();
      let subs: SubstituteRow[] = [];
      let subRowId: string | null = null;
      let absences: AbsenceRow[] = [];
      if (sid) {
        const [attRes, subRes, absRes] = await loadSessionReads(sid);
        if (stale) return;
        marks = new Map(((attRes.data ?? []) as any[]).map((a) => [a.student_id, a.status as DbStatus]));
        subs = ((subRes.data ?? []) as any[]).map((s) => ({ lesson_session_id: s.lesson_session_id, coach_id: s.coach_id }));
        subRowId = ((subRes.data ?? []) as any[])[0]?.id ?? null;
        absences = (absRes.data ?? []) as AbsenceRow[];
      }

      // Who is expected: the SAME union the billing gate uses.
      const rows: RosterRow[] = buildRoster({
        date,
        enrolments: (enrolRes.data ?? []) as any[],
        trials: (trialsRes.data ?? []) as any[],
        makeups: (makeupsRes.data ?? []) as any[],
        marks,
      });
      setRoster(rows);
      setDraft(Object.fromEntries(rows.map((r) => [r.studentId, r.prev])));

      const a = attributeLessons({
        lessons: [{ lesson_session_id: sid ?? "pending", class_id: classId, session_date: date }],
        substitutes: subs,
        classRates: (ratesRes.data ?? []) as ClassRateRow[],
        shadows: (shadowsRes.data ?? []) as ClassShadowRow[],
        absences,
      }).get(sid ?? "pending");
      setAttr({ mainId: a?.main_coach_id ?? null, isCover: a?.is_cover ?? false, subRowId, shadowIds: a?.shadow_coach_ids ?? [] });
      setTermsCoachId(termsCoachOn((ratesRes.data ?? []) as ClassRateRow[], classId, date));

      const kidRows = (kidsRes.data ?? []) as any[];
      setKids(eligibleKidsFrom(kidRows));
      setTrialKids(trialKidsFrom(kidRows));

      setFloor(await floorP);
      if (stale) return;
      setLoading(false);
    })();
    return () => {
      stale = true;
    };
  }, [classId, date, validDate, reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  // ── Derived ─────────────────────────────────────────────────────────────
  const markability = useMemo(
    () =>
      cls
        ? lessonMarkability({ date, today, classDayOfWeek: cls.day_of_week, classTitle: cls.title, sessionExists: sessionId !== null, windowFloor: floor })
        : null,
    [cls, date, today, sessionId, floor]
  );
  const newRowsAllowed = markability?.ok ?? false;
  const notALesson = !!cls && !sessionId && dayOfWeekOf(date) !== cls.day_of_week;
  const isFuture = date > today;

  const enrolledCount = roster.filter((r) => r.expected && r.bookingId === null).length;
  const guestCount = roster.filter((r) => r.expected && r.bookingId !== null).length;
  const full = !!cls && isFull(enrolledCount, guestCount, cls.capacity);

  const dirty = roster.some((r) => (draft[r.studentId] ?? null) !== r.prev);
  const mainName = coaches.find((c) => c.id === attr?.mainId)?.name ?? "—";

  return {
    loading,
    loadError,
    cls,
    sessionId,
    cancelled,
    roster,
    draft,
    setDraft,
    coaches,
    attr,
    termsCoachId,
    actorId,
    holidayDays,
    kids,
    trialKids,
    reload,
    today,
    markability,
    newRowsAllowed,
    notALesson,
    isFuture,
    enrolledCount,
    guestCount,
    full,
    dirty,
    mainName,
  };
}
