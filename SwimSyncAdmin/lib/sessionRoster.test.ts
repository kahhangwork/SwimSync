import { describe, it, expect } from "vitest";
import {
  lessonDatesInMonth,
  buildLessonRosters,
  assignableShadows,
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
    expect(lesson.shadows).toEqual([]);
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
    role: "main",
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

describe("buildLessonRosters — shadows", () => {
  const sessions = [{ id: "s3", session_date: "2026-07-21" }];

  it("lists shadows separately from the main and sorts them by name", () => {
    const lessons = build(sessions, [
      { id: "r2", lesson_session_id: "s3", coach_id: T, role: "shadow" },
      { id: "r3", lesson_session_id: "s3", coach_id: B, role: "shadow" },
    ]);
    expect(lessons[2].main.assigned).toBe(false);
    expect(lessons[2].shadows.map((s) => s.name)).toEqual([
      "Coach B",
      "Trainee T",
    ]);
    expect(lessons[2].shadows[0].row_id).toBe("r3");
  });

  it("keeps a shadow out of the main slot even when there is no main row", () => {
    // The absence rule answers "who marks this lesson", and a shadow never
    // does (decision 6: trainees see only). A shadow promoted into the main
    // slot by a fallback that merely took "the first roster row" would hand
    // them the write gate on screen while the database refuses it.
    const lessons = build(sessions, [
      { id: "r4", lesson_session_id: "s3", coach_id: T, role: "shadow" },
    ]);
    expect(lessons[2].main.coach_id).toBe(A);
    expect(lessons[2].main.assigned).toBe(false);
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

describe("assignableShadows", () => {
  const coaches = [
    { id: A, name: "Coach A" },
    { id: B, name: "Coach B" },
    { id: T, name: "Trainee T" },
  ];

  it("excludes the assigned main and the existing shadows", () => {
    const [lesson] = build(
      [{ id: "s5", session_date: "2026-07-07" }],
      [
        { id: "r5", lesson_session_id: "s5", coach_id: B, role: "main" },
        { id: "r6", lesson_session_id: "s5", coach_id: T, role: "shadow" },
      ]
    );
    expect(assignableShadows(lesson, coaches).map((c) => c.id)).toEqual([A]);
  });

  it("excludes a FALLBACK main, who has no roster row to match on", () => {
    // The regression this function exists to prevent. Filtering by roster row
    // instead of by coach id offers the class's own coach as a shadow of their
    // own lesson, producing a session that calls one person both main (by the
    // absence rule) and shadow (by an actual row).
    const [lesson] = build([], []);
    expect(assignableShadows(lesson, coaches).map((c) => c.id)).toEqual([B, T]);
  });

  it("offers the class's coach as a shadow of somebody else's cover", () => {
    // A real arrangement — a coach back from leave watching their own class —
    // and the database has no rule against it.
    const [lesson] = build(
      [{ id: "s6", session_date: "2026-07-07" }],
      [{ id: "r7", lesson_session_id: "s6", coach_id: B, role: "main" }]
    );
    expect(assignableShadows(lesson, coaches).map((c) => c.id)).toEqual([A, T]);
  });
});
