import {
  summariseSkillProgress,
  cycleGrade,
  topGrade,
  type GradeLevel,
  type LevelSkill,
  type ProgressRow,
} from "./skillProgress";

const SCALE: GradeLevel[] = [
  { id: "g1", rank: 1, label: "Developing" },
  { id: "g2", rank: 2, label: "Competent" },
  { id: "g3", rank: 3, label: "Mastered" },
];

const SKILLS: LevelSkill[] = [
  { id: "s1", label: "Aeroplane Kick", sort_order: 1 },
  { id: "s2", label: "Basic bubbles", sort_order: 2 },
  { id: "s3", label: "Torpedo Glide", sort_order: 3 },
];

describe("topGrade", () => {
  it("returns the highest-rank grade", () => {
    expect(topGrade(SCALE)?.id).toBe("g3");
  });
  it("is null for an empty scale", () => {
    expect(topGrade([])).toBeNull();
  });
  it("ignores scale order, keying on rank not position", () => {
    const shuffled = [SCALE[2], SCALE[0], SCALE[1]];
    expect(topGrade(shuffled)?.id).toBe("g3");
  });
});

describe("summariseSkillProgress", () => {
  it("pairs skills with grades and counts those at the top rank", () => {
    const progress: ProgressRow[] = [
      { skill_id: "s1", grade_level_id: "g3" }, // Mastered — done
      { skill_id: "s2", grade_level_id: "g1" }, // Developing — not done
    ];
    const r = summariseSkillProgress(SKILLS, progress, SCALE);
    expect(r.total).toBe(3);
    expect(r.doneCount).toBe(1);
    expect(r.topGradeLabel).toBe("Mastered");
    expect(r.skills.map((s) => s.grade?.label ?? null)).toEqual([
      "Mastered",
      "Developing",
      null,
    ]);
    expect(r.skills.map((s) => s.done)).toEqual([true, false, false]);
  });

  it("orders skills by sort_order, then label — never by input order", () => {
    const jumbled: LevelSkill[] = [
      { id: "s3", label: "Torpedo Glide", sort_order: 3 },
      { id: "s1", label: "Aeroplane Kick", sort_order: 1 },
      { id: "s2", label: "Basic bubbles", sort_order: 2 },
    ];
    const r = summariseSkillProgress(jumbled, [], SCALE);
    expect(r.skills.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it('"done" tracks the TOP rank — adding a higher grade re-opens a skill', () => {
    const progress: ProgressRow[] = [{ skill_id: "s1", grade_level_id: "g3" }];
    // With g3 as top, s1 is done.
    expect(summariseSkillProgress(SKILLS, progress, SCALE).doneCount).toBe(1);
    // Add a rank-4 grade: g3 is no longer the top, so s1 re-opens.
    const bigger = [...SCALE, { id: "g4", rank: 4, label: "Expert" }];
    const r = summariseSkillProgress(SKILLS, progress, bigger);
    expect(r.topGradeLabel).toBe("Expert");
    expect(r.doneCount).toBe(0);
    expect(r.skills[0].done).toBe(false);
    expect(r.skills[0].grade?.label).toBe("Mastered"); // still graded, just not done
  });

  it("ignores a progress row for a skill not on the level", () => {
    const progress: ProgressRow[] = [{ skill_id: "gone", grade_level_id: "g3" }];
    const r = summariseSkillProgress(SKILLS, progress, SCALE);
    expect(r.doneCount).toBe(0);
    expect(r.skills.every((s) => s.grade == null)).toBe(true);
  });

  it("reads an unknown grade id as ungraded rather than throwing", () => {
    const progress: ProgressRow[] = [{ skill_id: "s1", grade_level_id: "stale" }];
    const r = summariseSkillProgress(SKILLS, progress, SCALE);
    expect(r.skills[0].grade).toBeNull();
    expect(r.skills[0].done).toBe(false);
  });

  it("an empty scale means no top label and nothing done", () => {
    const progress: ProgressRow[] = [{ skill_id: "s1", grade_level_id: "g3" }];
    const r = summariseSkillProgress(SKILLS, progress, []);
    expect(r.topGradeLabel).toBeNull();
    expect(r.doneCount).toBe(0);
  });

  it("an empty skill list is a clean zero, not a crash", () => {
    const r = summariseSkillProgress([], [], SCALE);
    expect(r).toMatchObject({ total: 0, doneCount: 0, topGradeLabel: "Mastered" });
    expect(r.skills).toEqual([]);
  });
});

describe("cycleGrade", () => {
  it("ungraded → lowest rank", () => {
    expect(cycleGrade(null, SCALE)?.id).toBe("g1");
  });
  it("steps up one rank at a time", () => {
    expect(cycleGrade(SCALE[0], SCALE)?.id).toBe("g2");
    expect(cycleGrade(SCALE[1], SCALE)?.id).toBe("g3");
  });
  it("wraps the top rank back to ungraded", () => {
    expect(cycleGrade(SCALE[2], SCALE)).toBeNull();
  });
  it("keys on rank, not scale array order", () => {
    const shuffled = [SCALE[2], SCALE[0], SCALE[1]];
    expect(cycleGrade(null, shuffled)?.id).toBe("g1");
    expect(cycleGrade(SCALE[0], shuffled)?.id).toBe("g2");
  });
  it("a grade no longer in the scale restarts the cycle", () => {
    const stale: GradeLevel = { id: "gX", rank: 9, label: "Old" };
    expect(cycleGrade(stale, SCALE)?.id).toBe("g1");
  });
  it("an empty scale cannot be cycled", () => {
    expect(cycleGrade(null, [])).toBeNull();
  });
});
