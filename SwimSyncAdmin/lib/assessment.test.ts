// The Assessment tab's pure core.
//
// THE TWO HIGHEST-VALUE BLOCKS IN THIS FILE are "the vacuity guard" and
// "promotion follows THIS round". Both were written from a /plan-review finding
// (docs/plans/GRADING_ADMIN_ONLY_PLAN.md, RISK 1 and RISK 7) BEFORE the code, and
// both are RED against the obvious implementation:
//
//   assessedThisRound = freshCount === total      // vacuously TRUE at 0 === 0
//   canPromote        = cells.every(c => c.done)  // vacuously TRUE over []
//
// Those two lines are what a reasonable person writes, and they would report
// "fully assessed" for a child with no level and offer to promote them out of a
// level they are not in — inside the tool built to stop children being skipped.
// If either block is ever deleted as redundant, restore it: the failure is
// silent on every screen.

import { describe, it, expect } from "vitest";
import {
  isFreshGrade,
  topGradeOf,
  buildStudentRow,
  groupRosterByLevel,
  roundProgress,
  canPromote,
  nextLevel,
  dedupeStroke,
  type GradeLevel,
  type Level,
  type RosterStudent,
  type StrokeCell,
} from "./assessment";

const SCALE: GradeLevel[] = [
  { id: "g1", rank: 1, label: "Developing" },
  { id: "g2", rank: 2, label: "Competent" },
  { id: "g3", rank: 3, label: "Mastered" },
];

const SINCE = "2026-09-01";
const FRESH = "2026-09-01T09:30:00Z";
const STALE = "2026-06-12T09:30:00Z";

const L2: Level = {
  id: "l2",
  label: "Water Confidence",
  sort_order: 2,
  skills: [
    { id: "s1", label: "Float", sort_order: 1 },
    { id: "s2", label: "Glide", sort_order: 2 },
  ],
};

const L3: Level = {
  id: "l3",
  label: "Front Crawl",
  sort_order: 3,
  skills: [{ id: "s9", label: "Arms", sort_order: 1 }],
};

/** A level that exists but teaches nothing yet — the second vacuity shape. */
const EMPTY_LEVEL: Level = {
  id: "l0",
  label: "Brand New Level",
  sort_order: 1,
  skills: [],
};

function child(
  id: string,
  level_id: string | null,
  progress: RosterStudent["progress"] = []
): RosterStudent {
  return { id, full_name: `Child ${id}`, level_id, progress };
}

describe("isFreshGrade", () => {
  it("counts a grade from the round's start day onwards", () => {
    expect(isFreshGrade(FRESH, SINCE)).toBe(true);
  });
  it("counts a grade from before the round as stale", () => {
    expect(isFreshGrade(STALE, SINCE)).toBe(false);
  });
  it("treats a missing timestamp as stale, never fresh", () => {
    expect(isFreshGrade(null, SINCE)).toBe(false);
    expect(isFreshGrade(undefined, SINCE)).toBe(false);
  });
  it("treats an unparseable timestamp as stale rather than throwing", () => {
    expect(isFreshGrade("not a date", SINCE)).toBe(false);
  });
  it("includes a grade recorded at the very start of the start day", () => {
    // Singapore midnight, spelled out. A zoneless literal here would be read in
    // the device's zone and so would not pin the boundary at all.
    expect(isFreshGrade("2026-09-01T00:00:00+08:00", SINCE)).toBe(true);
  });

  // ── THE ROUND BOUNDARY IS SINGAPORE MIDNIGHT, NOT THE DEVICE'S ─────────────
  // `since` is a Singapore calendar date (todayInSg(), or the date the assessor
  // typed). `graded_at` is a timestamptz — NOW() on the server. Comparing them
  // through a ZONELESS `${since}T00:00:00` means "midnight wherever this browser
  // happens to be", so west of Singapore the boundary lands LATER than the SGT
  // day it names, and grades made in the first hours of the Singapore day read
  // as a previous round's.
  //
  // That is not hypothetical: it reddened the nightly sweep on 2026-08-29, whose
  // runner is UTC and whose clock was 22:42Z — 06:42 the next morning in
  // Singapore. Six checks failed with today's grades rendering stale. §7.7's
  // axis, on a surface nobody had connected to it.
  it("puts the round boundary at SINGAPORE midnight, in every device zone", () => {
    const original = process.env.TZ;
    // 2026-08-29T22:42Z is 2026-08-30 06:42 in Singapore: graded TODAY.
    const gradedEarlySgMorning = "2026-08-29T22:42:00Z";
    for (const tz of [
      "UTC",
      "Asia/Singapore",
      "America/New_York",
      "Pacific/Midway",
      "Pacific/Auckland",
    ]) {
      process.env.TZ = tz;
      expect(isFreshGrade(gradedEarlySgMorning, "2026-08-30")).toBe(true);
      // ⚠ NOT belt-and-braces — this line catches the OPPOSITE failure, and is
      // the reason Pacific/Auckland is in the list. 15:59:59Z is one second
      // before Singapore midnight, so it belongs to the PREVIOUS round. East of
      // Singapore the zoneless boundary lands EARLY rather than late, and the
      // old code returned true here under Auckland alone — a pre-round grade
      // silently counted as this round's. Deleting this assertion would leave
      // half the bug untested and "call everything fresh" a passing fix.
      expect(isFreshGrade("2026-08-29T15:59:59Z", "2026-08-30")).toBe(false);
    }
    process.env.TZ = original;
  });
});

describe("topGradeOf", () => {
  it("is the highest rank regardless of array order", () => {
    expect(topGradeOf([SCALE[2], SCALE[0], SCALE[1]])?.id).toBe("g3");
  });
  it("is null for an empty scale", () => {
    expect(topGradeOf([])).toBeNull();
  });
});

describe("buildStudentRow", () => {
  it("pairs each skill with its grade, in teaching order", () => {
    const row = buildStudentRow(
      child("a", "l2", [
        { skill_id: "s2", grade_level_id: "g1", graded_at: FRESH },
        { skill_id: "s1", grade_level_id: "g3", graded_at: FRESH },
      ]),
      L2,
      SCALE,
      SINCE
    );
    expect(row.cells.map((c) => c.skill.id)).toEqual(["s1", "s2"]);
    expect(row.cells[0].grade?.label).toBe("Mastered");
    expect(row.cells[0].done).toBe(true);
    expect(row.cells[1].done).toBe(false);
  });

  it("marks a grade from a previous round stale, and keeps its date", () => {
    const row = buildStudentRow(
      child("a", "l2", [
        { skill_id: "s1", grade_level_id: "g2", graded_at: STALE },
      ]),
      L2,
      SCALE,
      SINCE
    );
    expect(row.cells[0].grade?.label).toBe("Competent");
    expect(row.cells[0].fresh).toBe(false);
    expect(row.cells[0].gradedAt).toBe(STALE);
    expect(row.freshCount).toBe(0);
  });

  it("reads a grade id the scale no longer holds as ungraded, not a crash", () => {
    const row = buildStudentRow(
      child("a", "l2", [
        { skill_id: "s1", grade_level_id: "deleted", graded_at: FRESH },
      ]),
      L2,
      SCALE,
      SINCE
    );
    expect(row.cells[0].grade).toBeNull();
    expect(row.cells[0].fresh).toBe(false);
  });

  it("ignores a progress row for a skill outside the current level", () => {
    const row = buildStudentRow(
      child("a", "l2", [
        { skill_id: "s9", grade_level_id: "g3", graded_at: FRESH },
      ]),
      L2,
      SCALE,
      SINCE
    );
    expect(row.cells).toHaveLength(2);
    expect(row.cells.every((c) => c.grade === null)).toBe(true);
  });

  it("is fully assessed only when every skill was graded this round", () => {
    const row = buildStudentRow(
      child("a", "l2", [
        { skill_id: "s1", grade_level_id: "g2", graded_at: FRESH },
        { skill_id: "s2", grade_level_id: "g1", graded_at: FRESH },
      ]),
      L2,
      SCALE,
      SINCE
    );
    expect(row.assessedThisRound).toBe(true);
    expect(row.freshCount).toBe(2);
  });

  it("is NOT assessed when a skill carries only a previous round's grade", () => {
    const row = buildStudentRow(
      child("a", "l2", [
        { skill_id: "s1", grade_level_id: "g2", graded_at: FRESH },
        { skill_id: "s2", grade_level_id: "g2", graded_at: STALE },
      ]),
      L2,
      SCALE,
      SINCE
    );
    expect(row.assessedThisRound).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ⚠ THE VACUITY GUARD (plan RISK 1) — RED against `freshCount === total`
// ════════════════════════════════════════════════════════════════════════════
// A child with nothing to grade must never read as assessed. Both shapes:
// no level at all, and a level that teaches no skills yet.
describe("a child with nothing to grade is never 'assessed'", () => {
  it("an UNLEVELLED child is not assessed, and is flagged noSkills", () => {
    const row = buildStudentRow(child("a", null), null, SCALE, SINCE);
    expect(row.total).toBe(0);
    expect(row.noSkills).toBe(true);
    // ⚠ `freshCount === total` would be 0 === 0 → true. It must be false.
    expect(row.assessedThisRound).toBe(false);
  });

  it("a child on a level with NO SKILLS is not assessed either", () => {
    const row = buildStudentRow(child("a", "l0"), EMPTY_LEVEL, SCALE, SINCE);
    expect(row.noSkills).toBe(true);
    expect(row.assessedThisRound).toBe(false);
  });

  it("an unlevelled child is never offered a promotion", () => {
    const row = buildStudentRow(child("a", null), null, SCALE, SINCE);
    // ⚠ `cells.every(c => c.done)` over [] would be true. It must be false.
    expect(canPromote(row)).toBe(false);
  });

  it("a child on an empty level is never offered a promotion", () => {
    const row = buildStudentRow(child("a", "l0"), EMPTY_LEVEL, SCALE, SINCE);
    expect(canPromote(row)).toBe(false);
  });

  it("blocked children are counted apart from assessed and outstanding", () => {
    const groups = groupRosterByLevel(
      [
        child("a", "l2", [
          { skill_id: "s1", grade_level_id: "g1", graded_at: FRESH },
          { skill_id: "s2", grade_level_id: "g1", graded_at: FRESH },
        ]),
        child("b", null),
      ],
      [L2],
      SCALE,
      SINCE
    );
    const p = roundProgress(groups);
    expect(p.totalStudents).toBe(2);
    expect(p.assessedStudents).toBe(1);
    expect(p.blockedStudents).toBe(1);
    // The unlevelled child contributes no skills, so the class is not
    // reported as 2 of 2 skills done and secretly missing a child.
    expect(p.totalSkills).toBe(2);
    expect(p.gradedSkills).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ⚠ PROMOTION FOLLOWS THIS ROUND (plan RISK 7) — RED against `every(c => c.done)`
// ════════════════════════════════════════════════════════════════════════════
describe("canPromote", () => {
  const allTopFresh = child("a", "l2", [
    { skill_id: "s1", grade_level_id: "g3", graded_at: FRESH },
    { skill_id: "s2", grade_level_id: "g3", graded_at: FRESH },
  ]);

  it("offers a move up when every skill is at the top grade, this round", () => {
    expect(canPromote(buildStudentRow(allTopFresh, L2, SCALE, SINCE))).toBe(true);
  });

  it("does NOT offer a move up off a PREVIOUS round's top grades", () => {
    const stale = child("a", "l2", [
      { skill_id: "s1", grade_level_id: "g3", graded_at: STALE },
      { skill_id: "s2", grade_level_id: "g3", graded_at: STALE },
    ]);
    // ⚠ `every(c => c.done)` ignores freshness and would return true — prompting
    // the assessor to move a child nobody has looked at today.
    expect(canPromote(buildStudentRow(stale, L2, SCALE, SINCE))).toBe(false);
  });

  it("does not offer a move up when one skill is short of the top", () => {
    const partial = child("a", "l2", [
      { skill_id: "s1", grade_level_id: "g3", graded_at: FRESH },
      { skill_id: "s2", grade_level_id: "g2", graded_at: FRESH },
    ]);
    expect(canPromote(buildStudentRow(partial, L2, SCALE, SINCE))).toBe(false);
  });

  it("re-opens a promotion when a HIGHER grade is added to the scale", () => {
    const wider = [...SCALE, { id: "g4", rank: 4, label: "Expert" }];
    // Same grades, but g3 is no longer the top — "done" is computed, never
    // stored, so the promotion must withdraw itself.
    expect(canPromote(buildStudentRow(allTopFresh, L2, wider, SINCE))).toBe(false);
  });
});

describe("a child promoted mid-round is not reported as unassessed", () => {
  it("flags promotedThisRound from a fresh grade on another level's skill", () => {
    // Assessed on Level 2 this morning, moved up to Level 3, not yet graded
    // there. Reading only Level 3's skills would show them as untouched.
    const moved = child("a", "l3", [
      { skill_id: "s1", grade_level_id: "g3", graded_at: FRESH },
      { skill_id: "s2", grade_level_id: "g3", graded_at: FRESH },
    ]);
    const row = buildStudentRow(moved, L3, SCALE, SINCE);
    expect(row.freshCount).toBe(0);
    expect(row.assessedThisRound).toBe(false);
    expect(row.promotedThisRound).toBe(true);
  });

  it("does not flag a child whose other-level grades are all stale", () => {
    const old = child("a", "l3", [
      { skill_id: "s1", grade_level_id: "g3", graded_at: STALE },
    ]);
    expect(buildStudentRow(old, L3, SCALE, SINCE).promotedThisRound).toBe(false);
  });
});

describe("groupRosterByLevel", () => {
  const roster = [
    child("zoe", "l2"),
    child("amy", "l2"),
    child("ben", "l3"),
    child("cal", null),
  ];

  it("makes one group per level present, in sort_order", () => {
    const groups = groupRosterByLevel(roster, [L3, L2], SCALE, SINCE);
    expect(groups.map((g) => g.level?.label)).toEqual([
      "Water Confidence",
      "Front Crawl",
      undefined, // the no-level bucket sorts last
    ]);
  });

  it("sorts children by name inside a group", () => {
    const groups = groupRosterByLevel(roster, [L2], SCALE, SINCE);
    expect(groups[0].rows.map((r) => r.student.full_name)).toEqual([
      "Child amy",
      "Child zoe",
    ]);
  });

  it("omits a level no child in this class is on", () => {
    const groups = groupRosterByLevel([child("a", "l2")], [L2, L3], SCALE, SINCE);
    expect(groups).toHaveLength(1);
    expect(groups[0].level?.id).toBe("l2");
  });

  it("omits the no-level bucket when every child has a level", () => {
    const groups = groupRosterByLevel([child("a", "l2")], [L2], SCALE, SINCE);
    expect(groups.every((g) => g.level !== null)).toBe(true);
  });

  it("keeps a child whose level_id points at a level that is gone", () => {
    // Dropping them from the roster would silently remove a child from the
    // assessment list — the same skipped-child failure by another route.
    const groups = groupRosterByLevel([child("a", "ghost")], [L2], SCALE, SINCE);
    expect(groups).toHaveLength(1);
    expect(groups[0].level).toBeNull();
    expect(groups[0].rows[0].noSkills).toBe(true);
  });
});

describe("nextLevel", () => {
  it("is the next level up by sort_order", () => {
    expect(nextLevel([L3, L2], "l2")?.id).toBe("l3");
  });
  it("is null at the highest level", () => {
    expect(nextLevel([L2, L3], "l3")).toBeNull();
  });
  it("is null for a child with no level", () => {
    expect(nextLevel([L2, L3], null)).toBeNull();
  });
  it("is null for a level id that no longer exists", () => {
    expect(nextLevel([L2, L3], "ghost")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ⚠ dedupeStroke (plan RISK 4a) — without this the whole paint stroke fails
// ════════════════════════════════════════════════════════════════════════════
describe("dedupeStroke", () => {
  const cell = (student_id: string, skill_id: string, grade_level_id: string): StrokeCell =>
    ({ student_id, skill_id, tenant_id: "t1", grade_level_id });

  it("keeps one row per (student, skill), last write winning", () => {
    const out = dedupeStroke([
      cell("a", "s1", "g1"),
      cell("a", "s2", "g1"),
      cell("a", "s1", "g3"), // the finger crossed s1 again
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.skill_id === "s1")?.grade_level_id).toBe("g3");
  });

  it("does not merge the same skill across different children", () => {
    const out = dedupeStroke([cell("a", "s1", "g1"), cell("b", "s1", "g1")]);
    expect(out).toHaveLength(2);
  });

  it("leaves an already-unique stroke untouched", () => {
    const input = [cell("a", "s1", "g1"), cell("a", "s2", "g2")];
    expect(dedupeStroke(input)).toEqual(input);
  });

  it("handles an empty stroke", () => {
    expect(dedupeStroke([])).toEqual([]);
  });
});
