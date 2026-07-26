import { describe, it, expect } from "vitest";
import {
  formatActiveStudents,
  inactiveNote,
  describeLevelRemoval,
} from "./studentCounts";

describe("formatActiveStudents", () => {
  it("names the active count, and stays silent about zero inactive", () => {
    // Production today: 15 active, 0 inactive. The number was already right by
    // coincidence; what changes is that it now MEANS active.
    expect(formatActiveStudents(15, 0)).toBe("15 active students");
    expect(formatActiveStudents(0, 0)).toBe("0 active students");
  });

  it("appends the inactive count once there is one", () => {
    expect(formatActiveStudents(14, 1)).toBe("14 active students · 1 inactive");
    expect(formatActiveStudents(14, 2)).toBe("14 active students · 2 inactive");
  });

  it("keeps the active figure first even when everyone has left", () => {
    // The headline stays "how many are swimming" — 0 — rather than leading with
    // the 3 who are gone.
    expect(formatActiveStudents(0, 3)).toBe("0 active students · 3 inactive");
  });

  it("says 'student' for one", () => {
    expect(formatActiveStudents(1, 0)).toBe("1 active student");
    expect(formatActiveStudents(1, 1)).toBe("1 active student · 1 inactive");
  });
});

describe("inactiveNote", () => {
  it("is empty at zero, so the caller needs no conditional", () => {
    expect(inactiveNote(0)).toBe("");
  });

  it("composes onto the caller's own text", () => {
    // The Dashboard appends this to "Across all coaches" instead of replacing
    // it — the count is business-wide, not per-coach, and that is worth keeping.
    expect(`Across all coaches${inactiveNote(2)}`).toBe(
      "Across all coaches · 2 inactive"
    );
    expect(`Across all coaches${inactiveNote(0)}`).toBe("Across all coaches");
  });
});

describe("describeLevelRemoval", () => {
  /**
   * THIS IS A DESTRUCTIVE-ACTION GUARD, NOT A DISPLAY STRING.
   *
   * `students.level_id` is ON DELETE SET NULL, so removing a level always
   * succeeds and blanks the level for everyone pointing at it. The Students
   * column beside this modal shows ACTIVE children; this sentence must describe
   * ALL of them, or it tells the admin nobody is affected while children who
   * have left silently lose a level nothing records.
   */
  it("only claims nobody when the level is genuinely empty", () => {
    expect(describeLevelRemoval(0, 0)).toBe("No students are on this level.");
  });

  it("NEVER says nobody when only inactive children hold the level", () => {
    // The bug this function exists to prevent. An active-only count would have
    // returned "No students are on this level." here.
    const msg = describeLevelRemoval(0, 2);
    expect(msg).not.toBe("No students are on this level.");
    expect(msg).toContain("2 inactive students");
  });

  it("names inactive children explicitly, because the column reads 0", () => {
    expect(describeLevelRemoval(0, 1)).toContain("1 inactive student");
    expect(describeLevelRemoval(0, 1)).not.toContain("inactive students");
  });

  it("reads plainly when every child on the level is active", () => {
    // Unchanged from the original copy — an admin with no departed children must
    // not see new jargon.
    expect(describeLevelRemoval(4, 0)).toBe(
      "4 students will simply have no level. Nobody is removed from a class, and no history changes."
    );
    expect(describeLevelRemoval(1, 0)).toContain("1 student will");
  });

  it("gives the total AND the inactive share when the level holds both", () => {
    expect(describeLevelRemoval(4, 2)).toContain("6 students (2 of them inactive)");
  });

  it("always promises that nothing else changes", () => {
    // The reassurance is the load-bearing half: SET NULL touches the level and
    // nothing else, and an admin who fears losing a class roster will not click.
    for (const [a, i] of [[4, 0], [0, 2], [4, 2], [1, 1]]) {
      expect(describeLevelRemoval(a, i)).toContain("no history changes");
    }
  });
});
