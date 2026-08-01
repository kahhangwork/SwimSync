import {
  coverageByStudent,
  describeCoverage,
  type StudentCoverage,
} from "./packageCoverage";

const row = (over: Record<string, unknown> = {}) => ({
  student_id: "s1",
  parent_id: "p1",
  tenant_id: "t1",
  coverage: "package",
  lessons_remaining: 8,
  ...over,
});

describe("coverageByStudent", () => {
  it("indexes rows by student_id", () => {
    const map = coverageByStudent([
      row(),
      row({ student_id: "s2", coverage: "ad_hoc", lessons_remaining: null }),
    ]);
    expect(map.get("s1")).toEqual({
      parentId: "p1",
      tenantId: "t1",
      coverage: "package",
      lessonsRemaining: 8,
    });
    expect(map.get("s2")?.coverage).toBe("ad_hoc");
  });

  // ⚠ FAIL-SAFE IS "NO BADGE", NEVER A CRASH. The home screen and the child
  // profile pass the RPC's data straight in; on the day the RPC errors this
  // is what keeps those screens rendering.
  it("returns an empty map for null / undefined / non-array input", () => {
    expect(coverageByStudent(null).size).toBe(0);
    expect(coverageByStudent(undefined).size).toBe(0);
    expect(coverageByStudent("boom").size).toBe(0);
  });

  it("skips malformed rows rather than throwing", () => {
    const map = coverageByStudent([
      null,
      42,
      row({ coverage: "yes" }),
      row({ student_id: 7 }),
      row({ student_id: "ok" }),
    ]);
    expect([...map.keys()]).toEqual(["ok"]);
  });
});

describe("describeCoverage (the child profile's Balances line)", () => {
  const cov = (
    coverage: StudentCoverage["coverage"],
    lessonsRemaining: number | null
  ): StudentCoverage => ({
    parentId: "p1",
    tenantId: "t1",
    coverage,
    lessonsRemaining,
  });

  it("spells out the family-shared package count", () => {
    expect(describeCoverage(cov("package", 8))).toBe(
      "Package — 8 lessons left · shared across the family"
    );
  });

  it("singularises one lesson", () => {
    expect(describeCoverage(cov("package", 1))).toBe(
      "Package — 1 lesson left · shared across the family"
    );
  });

  // ⚠ Exhausted ≠ ad hoc: 0 left is a package family needing a top-up.
  it("an exhausted package still reads as a package", () => {
    expect(describeCoverage(cov("package", 0))).toBe(
      "Package — 0 lessons left · shared across the family"
    );
  });

  it("labels ad-hoc explicitly — absence is never the signal", () => {
    expect(describeCoverage(cov("ad_hoc", null))).toBe(
      "Ad-hoc — billed per lesson"
    );
  });

  it("mixed names both halves (unreachable today, honest if it ever isn't)", () => {
    expect(describeCoverage(cov("mixed", 4))).toBe(
      "Mixed — 4 lessons left · some classes bill per lesson"
    );
  });

  it("returns null with no coverage row, so the line simply doesn't render", () => {
    expect(describeCoverage(undefined)).toBeNull();
  });
});
