import { describe, it, expect } from "vitest";
import {
  assignableClassShadows,
  lessonDatesInMonth,
  buildLessonRosters,
  type SessionCoachRow,
  type LessonSessionRow,
} from "./sessionRoster";

// Coach A owns the class; B covers; T shadows.
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const T = "tttttttt-tttt-tttt-tttt-tttttttttttt";

const NAMES = new Map([
  [A, "Coach A"],
  [B, "Coach B"],
  [T, "Trainee T"],
]);

const CLASS = { classCoachId: A, classCoachName: "Coach A" };

/** July 2026: Tuesdays fall on the 7th, 14th, 21st and 28th. */
const JULY_TUESDAYS = ["2026-07-07", "2026-07-14", "2026-07-21", "2026-07-28"];

function build(
  sessions: LessonSessionRow[],
  rosterRows: SessionCoachRow[],
  dates: string[] = JULY_TUESDAYS
) {
  return buildLessonRosters({
    dates,
    dayOfWeek: "tuesday",
    sessions,
    rosterRows,
    coachNames: NAMES,
    ...CLASS,
  });
}

describe("lessonDatesInMonth", () => {
  it("lists the weekly pattern when nothing has been marked yet", () => {
    // The ordinary case for a FUTURE month, which is the month an admin
    // actually arranges cover in — and the one where no lesson_sessions row
    // exists for any lesson at all.
    expect(lessonDatesInMonth("tuesday", "2026-07", [])).toEqual(JULY_TUESDAYS);
  });

  it("includes an off-pattern lesson that exists only as a row", () => {
    // schedule_extra_lesson() waives the weekday rule, so a Saturday make-up
    // lesson of a Tuesday class is real and must be assignable. Pattern-only
    // enumeration is exactly what loses it.
    expect(lessonDatesInMonth("tuesday", "2026-07", ["2026-07-18"])).toEqual([
      "2026-07-07",
      "2026-07-14",
      "2026-07-18",
      "2026-07-21",
      "2026-07-28",
    ]);
  });

  it("does not double-list a pattern date that also has a row", () => {
    expect(lessonDatesInMonth("tuesday", "2026-07", ["2026-07-14"])).toEqual(
      JULY_TUESDAYS
    );
  });

  it("ignores an existing date outside the month", () => {
    // Defensive against a caller whose range filter was forgotten: a leaked
    // June row must not smear a June lesson into July's list, where assigning
    // against it would write a roster row the admin cannot see.
    expect(
      lessonDatesInMonth("tuesday", "2026-07", ["2026-06-30", "2026-08-04"])
    ).toEqual(JULY_TUESDAYS);
  });

  it("returns nothing for a malformed month rather than guessing one", () => {
    expect(lessonDatesInMonth("tuesday", "July", [])).toEqual([]);
    expect(lessonDatesInMonth("tuesday", "", ["2026-07-07"])).toEqual([]);
  });
});

describe("buildLessonRosters — the absence rule", () => {
  it("names the class's coach when there is no roster row", () => {
    const [lesson] = build([], []);
    expect(lesson.main).toEqual({
      coach_id: A,
      name: "Coach A",
      assigned: false,
      is_cover: false,
      row_id: null,
    });
  });

  it("still names the class's coach when the session row exists but is unrostered", () => {
    // A marked lesson has a lesson_sessions row and no session_coaches row —
    // the shape of nearly every lesson in the business the day this ships.
    const [lesson] = build([{ id: "s1", session_date: "2026-07-07" }], []);
    expect(lesson.main.assigned).toBe(false);
    expect(lesson.main.coach_id).toBe(A);
    expect(lesson.session_id).toBe("s1");
  });

  it("leaves session_id null for a lesson nobody has touched", () => {
    // NOT an error case: it is why assignment goes through
    // assign_session_coach(class, date, …), which resolves-or-creates.
    const [lesson] = build([], []);
    expect(lesson.session_id).toBeNull();
  });
});

describe("buildLessonRosters — a cover", () => {
  const sessions = [{ id: "s2", session_date: "2026-07-14" }];
  const mainRow: SessionCoachRow = {
    id: "r1",
    lesson_session_id: "s2",
    coach_id: B,
  };

  it("marks a roster main who is not the class's coach as a cover", () => {
    const lessons = build(sessions, [mainRow]);
    expect(lessons[1].main).toEqual({
      coach_id: B,
      name: "Coach B",
      assigned: true,
      is_cover: true,
      row_id: "r1",
    });
  });

  it("does NOT mark the class's own coach as a cover when explicitly assigned", () => {
    // An admin may pin the class's coach to a lesson. It is an assignment — it
    // can be cleared — but it is nobody's cover, and calling it one would tell
    // the admin a substitution happened that did not.
    const lessons = build(sessions, [{ ...mainRow, coach_id: A }]);
    expect(lessons[1].main.assigned).toBe(true);
    expect(lessons[1].main.is_cover).toBe(false);
  });

  it("confines the roster to its own lesson", () => {
    // The rows arrive for a whole month in one query. A roster keyed to the
    // wrong lesson would show a cover on every lesson of the class.
    const lessons = build(sessions, [mainRow]);
    expect(lessons.map((l) => l.main.coach_id)).toEqual([A, B, A, A]);
  });

  it("falls back to a placeholder name rather than blanking an unreadable coach", () => {
    const lessons = build(sessions, [
      { ...mainRow, coach_id: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
    ]);
    expect(lessons[1].main.name).toBe("Unknown coach");
  });
});

describe("buildLessonRosters — off-pattern lessons", () => {
  it("flags a lesson that is not on the class's weekday", () => {
    const lessons = build(
      [{ id: "s4", session_date: "2026-07-18" }],
      [],
      ["2026-07-14", "2026-07-18"]
    );
    expect(lessons[0].off_pattern).toBe(false);
    expect(lessons[1].off_pattern).toBe(true);
  });
});

describe("buildLessonRosters — session_coaches is the SUBSTITUTE table now", () => {
  // The three tests that used to live here covered per-lesson shadows and
  // `assignableShadows`. Both are gone: a shadow is a dated assignment to the
  // whole CLASS (`class_shadow_coaches`, 20260812000200) and this module never
  // sees one. What replaces them is the property that makes that safe — every
  // row this module reads is a substitute, so "the first row" IS the main.
  const sessions = [{ id: "s3", session_date: "2026-07-21" }];

  it("treats the single row for a lesson as its main, with no role to consult", () => {
    const lessons = build(sessions, [
      { id: "r2", lesson_session_id: "s3", coach_id: T },
    ]);
    expect(lessons[2].main.coach_id).toBe(T);
    expect(lessons[2].main.assigned).toBe(true);
    expect(lessons[2].main.is_cover).toBe(true);
    expect(lessons[2].main.row_id).toBe("r2");
  });

  it("exposes no shadow list at all — the shape is gone, not merely empty", () => {
    // An empty array would let a caller keep rendering a Shadowing column that
    // can never fill, which is how a dead surface survives a model change.
    const lessons = build(sessions, []);
    expect("shadows" in lessons[2]).toBe(false);
  });

  it("still falls back to the class's coach when the lesson has no row", () => {
    // The absence rule, unchanged and load-bearing: it is what makes a business
    // that has never assigned anybody see byte-identical behaviour.
    const lessons = build(sessions, []);
    expect(lessons[2].main.coach_id).toBe(A);
    expect(lessons[2].main.assigned).toBe(false);
  });
});

describe("assignableClassShadows", () => {
  const coaches = [
    { id: A, name: "Coach A" },
    { id: B, name: "Coach B" },
    { id: T, name: "Trainee T" },
  ];

  it("never offers the class's own coach", () => {
    // The refusal assign_class_shadow() raises, met before it can be. A coach
    // who both teaches and shadows a lesson is main by the absence rule and
    // shadow by a row — the lesson goes read-only AND drops off NEEDS MARKING.
    expect(assignableClassShadows(A, [], coaches).map((c) => c.id)).toEqual([
      B,
      T,
    ]);
  });

  it("excludes a coach who already has an ACTIVE assignment", () => {
    expect(assignableClassShadows(A, [T], coaches).map((c) => c.id)).toEqual([B]);
  });

  it("still offers a coach whose assignment has ENDED", () => {
    // The unique index only covers effective_to IS NULL, so re-assigning a
    // returning trainee is legal. Excluding them would invent a rule the
    // database does not have and make it impossible from the UI.
    expect(assignableClassShadows(A, [], coaches).map((c) => c.id)).toContain(T);
  });
});
