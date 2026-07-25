import { describe, it, expect } from "vitest";
import {
  nameTokens,
  namesMatch,
  findDuplicatePairs,
  type DupStudent,
} from "./duplicateStudents";

const kid = (over: Partial<DupStudent> & { id: string; full_name: string }): DupStudent => ({
  date_of_birth: null,
  parentId: null,
  lessons: 0,
  isActive: true,
  ...over,
});

describe("nameTokens", () => {
  it("lowercases, strips punctuation and drops single characters", () => {
    expect(nameTokens("Ethan  Tan-Wei M.")).toEqual(["ethan", "tan", "wei"]);
  });

  it("returns nothing for an empty or punctuation-only name", () => {
    expect(nameTokens("   ")).toEqual([]);
    expect(nameTokens("--")).toEqual([]);
  });
});

describe("namesMatch", () => {
  it("matches on the given name — the nickname case this exists for", () => {
    expect(namesMatch("Ethan", "Ethan Tan Wei Ming")).toBe(true);
  });

  it("matches a reordered rendering on two shared tokens", () => {
    expect(namesMatch("Tan Wei Ming Ethan", "Ethan Tan")).toBe(true);
  });

  // The rule that keeps this from becoming noise — and, on the parent-facing
  // side, from becoming a disclosure bug.
  it("does NOT match on a shared surname alone", () => {
    expect(namesMatch("Bernice Tan", "Ethan Tan")).toBe(false);
  });

  it("does not match unrelated names", () => {
    expect(namesMatch("Sophia Lim", "Ethan Tan")).toBe(false);
  });
});

describe("findDuplicatePairs", () => {
  it("pairs a coach-added row with the parent-added one", () => {
    const pairs = findDuplicatePairs([
      kid({ id: "coach", full_name: "Ethan Tan", lessons: 3 }),
      kid({ id: "parent", full_name: "Ethan Tan Wei Ming", date_of_birth: "2019-01-01", parentId: "p1" }),
    ]);
    expect(pairs).toHaveLength(1);
    // The row with the history must survive — merge_students refuses the
    // other direction, so suggesting it would be suggesting a refusal.
    expect(pairs[0].survivor.id).toBe("coach");
    expect(pairs[0].duplicate.id).toBe("parent");
  });

  it("ignores two children belonging to DIFFERENT families", () => {
    expect(
      findDuplicatePairs([
        kid({ id: "a", full_name: "Ethan Tan", parentId: "p1" }),
        kid({ id: "b", full_name: "Ethan Tan Wei Ming", parentId: "p2" }),
      ])
    ).toEqual([]);
  });

  // ⚠ The commonest duplicate of all, and an earlier `claimed: boolean`
  // version silently hid it: the parent claims the coach's record, then adds
  // the child again by hand. Both rows are claimed — by the SAME family.
  it("DOES pair two rows belonging to the same parent", () => {
    const pairs = findDuplicatePairs([
      kid({ id: "coach", full_name: "Ethan Tan Wei Ming", date_of_birth: "2019-01-01", parentId: "p1", lessons: 1 }),
      kid({ id: "typed", full_name: "Ethan Tan", date_of_birth: "2019-01-01", parentId: "p1" }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].survivor.id).toBe("coach");
  });

  it("ignores namesakes with genuinely different birthdays", () => {
    expect(
      findDuplicatePairs([
        kid({ id: "a", full_name: "Ethan Tan", date_of_birth: "2019-01-01" }),
        kid({ id: "b", full_name: "Ethan Tan", date_of_birth: "2020-06-06" }),
      ])
    ).toEqual([]);
  });

  // A missing date of birth is not a conflicting one — and it is the usual
  // shape, since that NULL is exactly what lets the duplicate form.
  it("still pairs when one side has no date of birth at all", () => {
    const pairs = findDuplicatePairs([
      kid({ id: "a", full_name: "Ethan Tan", date_of_birth: null, lessons: 2 }),
      kid({ id: "b", full_name: "Ethan Tan", date_of_birth: "2019-01-01", parentId: "p1" }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].survivor.id).toBe("a");
  });

  it("flags a pair that BOTH carry attendance as needing a human", () => {
    const pairs = findDuplicatePairs([
      kid({ id: "a", full_name: "Ethan Tan", lessons: 2 }),
      kid({ id: "b", full_name: "Ethan Tan Wei Ming", lessons: 1, parentId: "p1" }),
    ]);
    expect(pairs[0].needsHuman).toBe(true);
  });

  it("marks a pair with no attendance either side as direction-agnostic", () => {
    const pairs = findDuplicatePairs([
      kid({ id: "a", full_name: "Ethan Tan" }),
      kid({ id: "b", full_name: "Ethan Tan Wei Ming", parentId: "p1" }),
    ]);
    expect(pairs[0].eitherWay).toBe(true);
    expect(pairs[0].needsHuman).toBe(false);
  });

  // Reported from production 2026-07-26: the banner flagged a live record
  // against a test record the admin had already RETIRED by marking it
  // inactive — which is how you resolve a duplicate when there is no merge
  // tool. The banner has no dismiss, so that would have been permanent noise.
  it("never flags a record the business has marked INACTIVE", () => {
    expect(
      findDuplicatePairs([
        kid({ id: "live", full_name: "TestParent", parentId: "p1" }),
        kid({ id: "retired", full_name: "TestParent", isActive: false }),
      ])
    ).toEqual([]);
  });

  it("ignores a pair where BOTH have left", () => {
    expect(
      findDuplicatePairs([
        kid({ id: "a", full_name: "TestParent", isActive: false }),
        kid({ id: "b", full_name: "TestParent", isActive: false }),
      ])
    ).toEqual([]);
  });

  it("does not pair a row with itself", () => {
    expect(findDuplicatePairs([kid({ id: "a", full_name: "Ethan Tan" })])).toEqual([]);
  });
});
