import { describe, it, expect } from "vitest";
import {
  describeCandidate,
  partitionCandidates,
  type RosterCandidate,
} from "./rosterDuplicates";

function cand(over: Partial<RosterCandidate>): RosterCandidate {
  return {
    student_id: "s1",
    full_name: "Anya Gundecha",
    parent_name: null,
    is_active: true,
    reason: "name",
    last_lesson: null,
    ...over,
  };
}

describe("describeCandidate", () => {
  it("names the claiming parent — the signal the family is already onboarded", () => {
    expect(describeCandidate(cand({ parent_name: "Priya" }))).toBe(
      "claimed by Priya",
    );
  });

  it("says unclaimed when nobody has claimed the child", () => {
    expect(describeCandidate(cand({ parent_name: null }))).toBe("unclaimed");
  });

  it("flags an inactive returning-family record after the claim state", () => {
    expect(
      describeCandidate(cand({ parent_name: "Priya", is_active: false })),
    ).toBe("claimed by Priya · inactive");
  });

  it("appends the last lesson as recognition context, last", () => {
    expect(
      describeCandidate(
        cand({ parent_name: null, is_active: false, last_lesson: "2026-08-12" }),
      ),
    ).toBe("unclaimed · inactive · last lesson 2026-08-12");
  });
});

describe("partitionCandidates", () => {
  it("puts phone hits in strong and name hits in weak, preserving order", () => {
    const list = [
      cand({ student_id: "p1", reason: "phone" }),
      cand({ student_id: "n1", reason: "name" }),
      cand({ student_id: "p2", reason: "phone" }),
      cand({ student_id: "n2", reason: "name" }),
    ];
    const { strong, weak } = partitionCandidates(list);
    expect(strong.map((c) => c.student_id)).toEqual(["p1", "p2"]);
    expect(weak.map((c) => c.student_id)).toEqual(["n1", "n2"]);
  });

  it("handles an all-weak list (the mom/dad name-only case) with no strong group", () => {
    const { strong, weak } = partitionCandidates([cand({ reason: "name" })]);
    expect(strong).toHaveLength(0);
    expect(weak).toHaveLength(1);
  });
});
