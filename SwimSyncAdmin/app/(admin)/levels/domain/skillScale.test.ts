import { describe, it, expect } from "vitest";
import { nextRank, describeDeleteError } from "./skillScale";

describe("nextRank", () => {
  it("is 1 for an empty scale", () => {
    expect(nextRank([])).toBe(1);
  });
  it("is one past the current top, ignoring array order and gaps", () => {
    expect(nextRank([{ rank: 1 }, { rank: 3 }, { rank: 2 }])).toBe(4);
  });
  it("does not assume ranks are contiguous", () => {
    expect(nextRank([{ rank: 5 }])).toBe(6);
  });
});

describe("describeDeleteError", () => {
  it("explains a grade level in use, and points at renaming", () => {
    const msg = describeDeleteError({ code: "23503" }, "grade");
    expect(msg).toMatch(/graded/i);
    expect(msg).toMatch(/rename/i);
    expect(msg).toMatch(/records are kept/i);
  });
  it("explains a skill in use", () => {
    const msg = describeDeleteError({ code: "23503" }, "skill");
    expect(msg).toMatch(/skill/i);
    expect(msg).toMatch(/records are kept/i);
  });
  it("explains a level in use via one of its skills", () => {
    const msg = describeDeleteError({ code: "23503" }, "level");
    expect(msg).toMatch(/one of this level's skills/i);
    expect(msg).toMatch(/records are kept/i);
  });
  it("falls back to a generic message for any other error", () => {
    expect(describeDeleteError({ code: "500" }, "skill")).toBe(
      "Could not remove that skill. Please try again."
    );
    expect(describeDeleteError(null, "level")).toBe(
      "Could not remove that level. Please try again."
    );
    expect(describeDeleteError(undefined, "grade")).toBe(
      "Could not remove that grade. Please try again."
    );
  });
  it("never claims records are kept when the failure is not the FK guard", () => {
    expect(describeDeleteError({ code: "42501" }, "skill")).not.toMatch(
      /records are kept/i
    );
  });
});
