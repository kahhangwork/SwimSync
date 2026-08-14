import { describe, it, expect } from "vitest";
import {
  attributeLessons,
  resolveShadows,
  type LessonRef,
  type ClassRateRow,
  type SubstituteRow,
  type ClassShadowRow,
  type AbsenceRow,
} from "./lessonAttribution";

// Coaches
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // the class's terms coach
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"; // a substitute / new owner
const S = "cccccccc-cccc-cccc-cccc-cccccccccccc"; // a shadow

// Class + lessons
const CLS = "11111111-1111-1111-1111-111111111111";
const L1 = "s1"; // 2026-07-14
const L2 = "s2"; // 2026-07-21

const lessons: LessonRef[] = [
  { lesson_session_id: L1, class_id: CLS, session_date: "2026-07-14" },
  { lesson_session_id: L2, class_id: CLS, session_date: "2026-07-21" },
];

// A→B handover on 2026-08-01, floor-dated seed for July.
const ratesNoHandover: ClassRateRow[] = [
  { class_id: CLS, effective_from: "2000-01-01", paid_coach_id: A },
];
const ratesHandover: ClassRateRow[] = [
  { class_id: CLS, effective_from: "2000-01-01", paid_coach_id: A },
  { class_id: CLS, effective_from: "2026-08-01", paid_coach_id: B },
];

function attr(over: {
  lessons?: LessonRef[];
  substitutes?: SubstituteRow[];
  classRates?: ClassRateRow[];
  shadows?: ClassShadowRow[];
  absences?: AbsenceRow[];
}) {
  return attributeLessons({
    lessons: over.lessons ?? lessons,
    substitutes: over.substitutes ?? [],
    classRates: over.classRates ?? ratesNoHandover,
    shadows: over.shadows ?? [],
    absences: over.absences ?? [],
  });
}

describe("attributeLessons — the MONEY axis (§7.152)", () => {
  it("RISK 9: with no substitutes, no shadows and no handover, the main is the terms coach — identical to today's access-axis render", () => {
    // Production's exact state (§3 DORMANT): zero session_coaches, zero
    // class_shadow_coaches, and no class handed over, so the floor rate's
    // paid_coach_id equals classes.coach_id. The fix must be invisible here.
    const map = attr({});
    expect(map.get(L1)!.main_coach_id).toBe(A);
    expect(map.get(L2)!.main_coach_id).toBe(A);
    expect(map.get(L1)!.is_cover).toBe(false);
    expect(map.get(L1)!.shadow_coach_ids).toEqual([]);
  });

  it("a July lesson is still paid to A after the class is handed to B in August — the whole point of the dated axis", () => {
    // classes.coach_id would name B on every July lesson; the money axis does
    // not. A class handed over must not re-price its unpaid history.
    const map = attr({ classRates: ratesHandover });
    expect(map.get(L1)!.main_coach_id).toBe(A); // 2026-07-14, before the handover
    expect(map.get(L2)!.main_coach_id).toBe(A); // 2026-07-21, before the handover
  });

  it("an August lesson under the same handover is paid to B", () => {
    const aug: LessonRef[] = [
      { lesson_session_id: "s3", class_id: CLS, session_date: "2026-08-11" },
    ];
    const map = attr({ lessons: aug, classRates: ratesHandover });
    expect(map.get("s3")!.main_coach_id).toBe(B);
  });

  it("a named substitute is the main, and reads as a cover", () => {
    const subs: SubstituteRow[] = [{ lesson_session_id: L1, coach_id: B }];
    const map = attr({ substitutes: subs });
    expect(map.get(L1)!.main_coach_id).toBe(B);
    expect(map.get(L1)!.is_cover).toBe(true);
    // The other lesson is untouched.
    expect(map.get(L2)!.main_coach_id).toBe(A);
    expect(map.get(L2)!.is_cover).toBe(false);
  });

  it("a substitute who IS the terms coach is not a cover", () => {
    // Self-substitution: same person, no decision to surface.
    const subs: SubstituteRow[] = [{ lesson_session_id: L1, coach_id: A }];
    const map = attr({ substitutes: subs });
    expect(map.get(L1)!.main_coach_id).toBe(A);
    expect(map.get(L1)!.is_cover).toBe(false);
  });

  it("a shadow active on the date is an additive second line, never the main", () => {
    const shadows: ClassShadowRow[] = [
      { class_id: CLS, coach_id: S, effective_from: "2026-07-01", effective_to: null },
    ];
    const map = attr({ shadows });
    expect(map.get(L1)!.main_coach_id).toBe(A);
    expect(map.get(L1)!.shadow_coach_ids).toEqual([S]);
    expect(map.get(L2)!.shadow_coach_ids).toEqual([S]);
  });

  it("a shadow marked absent for a lesson is not attributed to it", () => {
    const shadows: ClassShadowRow[] = [
      { class_id: CLS, coach_id: S, effective_from: "2026-07-01", effective_to: null },
    ];
    const absences: AbsenceRow[] = [{ lesson_session_id: L1, coach_id: S }];
    const map = attr({ shadows, absences });
    expect(map.get(L1)!.shadow_coach_ids).toEqual([]); // absent from L1
    expect(map.get(L2)!.shadow_coach_ids).toEqual([S]); // present at L2
  });

  it("a shadow assignment outside its date window does not attribute", () => {
    const shadows: ClassShadowRow[] = [
      { class_id: CLS, coach_id: S, effective_from: "2026-07-20", effective_to: null },
    ];
    const map = attr({ shadows });
    expect(map.get(L1)!.shadow_coach_ids).toEqual([]); // 07-14 is before 07-20
    expect(map.get(L2)!.shadow_coach_ids).toEqual([S]); // 07-21 is on/after
  });

  it("RISK 2: a coach who is BOTH the substitute and an active shadow resolves to the substitute, and is not listed twice", () => {
    // The ordering coach_attribution_kind() documents as load-bearing: a coach
    // can shadow the class all term and cover one lesson of it, and the database
    // pays them the substitute rate for that lesson. Labelling them a shadow
    // beside the substitute's amount would describe the money wrongly.
    const subs: SubstituteRow[] = [{ lesson_session_id: L1, coach_id: S }];
    const shadows: ClassShadowRow[] = [
      { class_id: CLS, coach_id: S, effective_from: "2026-07-01", effective_to: null },
    ];
    const map = attr({ substitutes: subs, shadows });
    expect(map.get(L1)!.main_coach_id).toBe(S);
    expect(map.get(L1)!.is_cover).toBe(true); // S is not the terms coach (A)
    expect(map.get(L1)!.shadow_coach_ids).toEqual([]); // not listed as its own shadow
  });

  it("a lesson whose class has no rate on/before its date has no main (loud null, not a guess)", () => {
    const early: LessonRef[] = [
      { lesson_session_id: "s9", class_id: CLS, session_date: "1999-01-01" },
    ];
    const map = attr({ lessons: early });
    expect(map.get("s9")!.main_coach_id).toBeNull();
  });
});

describe("resolveShadows — the single home for the shadow arm (shared with the wages page)", () => {
  it("returns coach→lessons and lesson→coaches views that agree", () => {
    const shadows: ClassShadowRow[] = [
      { class_id: CLS, coach_id: S, effective_from: "2026-07-01", effective_to: null },
    ];
    const { shadowedByCoach, shadowsByLesson } = resolveShadows({
      lessons,
      shadows,
      absences: [],
    });
    expect([...(shadowedByCoach.get(S) ?? [])].sort()).toEqual([L1, L2]);
    expect(shadowsByLesson.get(L1)).toEqual([S]);
    expect(shadowsByLesson.get(L2)).toEqual([S]);
  });

  it("does NOT filter a substitute out — that ordering belongs to each caller", () => {
    // The wages page's lineKind() checks its own roster row before the shadow
    // set, so resolveShadows must keep a coach's shadow lessons even when they
    // are also that lesson's substitute. Filtering here would drop wages data.
    const shadows: ClassShadowRow[] = [
      { class_id: CLS, coach_id: S, effective_from: "2026-07-01", effective_to: null },
    ];
    const { shadowsByLesson } = resolveShadows({
      lessons,
      shadows,
      absences: [],
    });
    // Substitutes are not even an input here — proof the filtering is not this
    // function's job.
    expect(shadowsByLesson.get(L1)).toEqual([S]);
  });

  it("honours the effective_to bound and the absence set", () => {
    const shadows: ClassShadowRow[] = [
      { class_id: CLS, coach_id: S, effective_from: "2026-07-01", effective_to: "2026-07-14" },
    ];
    const { shadowsByLesson } = resolveShadows({
      lessons,
      shadows,
      absences: [{ lesson_session_id: L1, coach_id: S }],
    });
    expect(shadowsByLesson.get(L1)).toBeUndefined(); // absent
    expect(shadowsByLesson.get(L2)).toBeUndefined(); // after effective_to
  });
});
