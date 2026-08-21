// Who TAUGHT a lesson — the money-axis answer, for the Attendance audit page.
//
// ⚠ THIS MODULE READS `classes.coach_id` NOWHERE, AND MUST NOT START. That
// column is the ACCESS axis: mutable and undated, it says who teaches the class
// *now*, not who taught it in July. This page exists to reconcile a payout, so
// it speaks the MONEY axis, and the two disagree on purpose (§7.152).
//
// `20260812000200`'s header states the split (lines 23-24):
//   ACCESS — the roster + classes.coach_id
//   MONEY  — class_rate_on().paid_coach_id + "was I a shadow ON THAT DATE?"
// and `20260719000800` exists because the two were once one query: handing a
// class from A to B on 1 August re-priced A's entire unpaid July history to B —
// coach A dropped to $0 and coach B was paid for lessons they never taught. The
// access-side twin of this file is `lib/sessionRoster.ts`, which DOES read
// classes.coach_id and is correct to. The money-side sibling is
// `lib/payoutItems.ts`, whose header says the same thing.
//
// WHO TAUGHT, in the order coach_attribution_kind() fixes (20260812000200 §7):
//   1. SUBSTITUTE — a `session_coaches` row names a coach for this one lesson.
//   2. TERMS      — nobody covering; the class's terms paid a coach on that
//                   date (class_rate_on(): latest effective_from <= date).
//   3. SHADOW     — a class shadow on that date, not marked absent. A shadow is
//                   NEVER the main; it is an additive second line, and it is
//                   dropped when the same coach is already the main (substitute
//                   beats shadow — a coach can be both).
//
// Pure — no Supabase, no React. The caller fetches the rows and passes them in.

/** A `class_rates` row — the MONEY axis. `paid_coach_id` is who earns a lesson
 *  of this class on/after `effective_from`. Every class has a floor-dated
 *  ('2000-01-01') row, so a resolvable lesson always finds one (20260719000700). */
export type ClassRateRow = {
  class_id: string;
  effective_from: string;
  paid_coach_id: string;
};

/** A `session_coaches` row — the SUBSTITUTE named for one lesson. At most one
 *  per lesson (`one_substitute_per_session`), so it holds no `role`. */
export type SubstituteRow = {
  lesson_session_id: string;
  coach_id: string;
};

/** A `class_shadow_coaches` row — a dated assignment of a shadow to a whole
 *  class. Not a per-lesson row; which lessons it covers is resolved by date. */
export type ClassShadowRow = {
  class_id: string;
  coach_id: string;
  effective_from: string;
  /** Null while the assignment is open-ended. */
  effective_to: string | null;
};

/** A `session_coach_absences` row — a shadow who did NOT attend one lesson, and
 *  is therefore not paid or attributed for it. */
export type AbsenceRow = {
  lesson_session_id: string;
  coach_id: string;
};

/** One lesson to attribute: its own id, its class, and its date. */
export type LessonRef = {
  lesson_session_id: string;
  class_id: string;
  session_date: string;
};

export type LessonAttribution = {
  /** The coach who taught it — substitute if named, else the terms coach on
   *  that date. Null only when neither is resolvable (a class with no rate on
   *  or before the date, which the floor row makes unreachable in practice). */
  main_coach_id: string | null;
  /** A substitute was named, AND they are not the terms coach — a genuine
   *  cover, shown as a decision rather than a quietly different name. */
  is_cover: boolean;
  /** Class shadows active on the date and not absent, excluding whoever is the
   *  main (a substitute who also shadows is the main, never listed twice). */
  shadow_coach_ids: string[];
};

/**
 * The class's paid coach on a date — `class_rate_on()`'s body verbatim: the
 * latest rate with `effective_from <= date`. Reads `paid_coach_id`, never
 * `classes.coach_id`.
 */
export function termsCoachOn(
  rates: readonly ClassRateRow[],
  classId: string,
  date: string
): string | null {
  let best: ClassRateRow | null = null;
  for (const r of rates) {
    if (r.class_id !== classId) continue;
    if (r.effective_from > date) continue;
    // "YYYY-MM-DD" sorts lexically in date order.
    if (!best || r.effective_from > best.effective_from) best = r;
  }
  return best?.paid_coach_id ?? null;
}

/**
 * The SHADOW arm, resolved once for the whole client. This is the single home
 * for "which lessons was each coach an assigned class shadow on?" — the same
 * dated, absence-aware rule `coach_attribution_kind()` applies server-side, and
 * the same loop the wages page used to inline. A shadow assignment covers a
 * lesson when the lesson's class matches, its date is inside the assignment's
 * window, and no absence was recorded for that (lesson, coach).
 *
 * Returns BOTH views so the two consumers each take the one they need:
 *   • `shadowedByCoach` — coach → lesson ids, for the wages payout breakdown.
 *   • `shadowsByLesson` — lesson id → coach ids, for the attendance second line.
 *
 * ⚠ A SUBSTITUTE IS NOT FILTERED OUT HERE. The substitute-beats-shadow ordering
 * is applied by each caller on top of this: `payoutItems.ts` checks its own
 * roster row first, and `attributeLessons()` drops the main from its shadow
 * list. Filtering here would change the wages page's meaning.
 */
export function resolveShadows(input: {
  lessons: readonly LessonRef[];
  shadows: readonly ClassShadowRow[];
  absences: readonly AbsenceRow[];
}): {
  shadowedByCoach: Map<string, Set<string>>;
  shadowsByLesson: Map<string, string[]>;
} {
  const { lessons, shadows, absences } = input;

  const absent = new Set(
    absences.map((a) => `${a.lesson_session_id}:${a.coach_id}`)
  );

  const shadowedByCoach = new Map<string, Set<string>>();
  const shadowsByLesson = new Map<string, string[]>();

  for (const ls of lessons) {
    for (const s of shadows) {
      if (s.class_id !== ls.class_id) continue;
      const d = ls.session_date;
      if (d < s.effective_from) continue;
      if (s.effective_to && d > s.effective_to) continue;
      if (absent.has(`${ls.lesson_session_id}:${s.coach_id}`)) continue;

      const set = shadowedByCoach.get(s.coach_id) ?? new Set<string>();
      set.add(ls.lesson_session_id);
      shadowedByCoach.set(s.coach_id, set);

      // Deduped at source, like `shadowedByCoach` above: two overlapping shadow
      // rows for the same coach (an ended one plus a later one) can both match a
      // lesson, and a direct consumer of this map should not see the coach twice.
      const list = shadowsByLesson.get(ls.lesson_session_id) ?? [];
      if (!list.includes(s.coach_id)) list.push(s.coach_id);
      shadowsByLesson.set(ls.lesson_session_id, list);
    }
  }

  return { shadowedByCoach, shadowsByLesson };
}

/**
 * Attribute a set of lessons: who taught each, whether it was a cover, and who
 * shadowed. Keyed by `lesson_session_id`, so the Attendance page can look up
 * every one of its per-student rows from one resolution.
 */
export function attributeLessons(input: {
  lessons: readonly LessonRef[];
  substitutes: readonly SubstituteRow[];
  classRates: readonly ClassRateRow[];
  shadows: readonly ClassShadowRow[];
  absences: readonly AbsenceRow[];
}): Map<string, LessonAttribution> {
  const { lessons, substitutes, classRates, shadows, absences } = input;

  const { shadowsByLesson } = resolveShadows({ lessons, shadows, absences });

  const subByLesson = new Map<string, string>();
  for (const s of substitutes) subByLesson.set(s.lesson_session_id, s.coach_id);

  const out = new Map<string, LessonAttribution>();
  for (const lesson of lessons) {
    const termsCoachId = termsCoachOn(
      classRates,
      lesson.class_id,
      lesson.session_date
    );
    const subCoachId = subByLesson.get(lesson.lesson_session_id) ?? null;

    // Substitute beats terms — they taught it.
    const mainCoachId = subCoachId ?? termsCoachId;
    const isCover = subCoachId != null && subCoachId !== termsCoachId;

    const rawShadows = shadowsByLesson.get(lesson.lesson_session_id) ?? [];
    // Dedupe, then drop the main: a coach who both shadows the class and is the
    // lesson's substitute is the main (substitute beats shadow) and must not
    // also read as a shadow beside their own name.
    const shadowIds = [...new Set(rawShadows)].filter(
      (c) => c !== mainCoachId
    );

    out.set(lesson.lesson_session_id, {
      main_coach_id: mainCoachId,
      is_cover: isCover,
      shadow_coach_ids: shadowIds,
    });
  }

  return out;
}
