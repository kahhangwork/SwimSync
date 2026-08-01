import { describe, expect, it } from "vitest";
import {
  coverageByStudent,
  familyLabel,
  familyLessonsByParent,
  isRunningLow,
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
    expect(map.get("s2")?.lessonsRemaining).toBeNull();
  });

  // ⚠ FAIL-SAFE IS "NO CHIP", NEVER A CRASH. Every page passes the RPC's
  // data straight in; on the day the RPC errors this function is what stands
  // between "chips absent" and twelve broken screens.
  it("returns an empty map for null / undefined / non-array input", () => {
    expect(coverageByStudent(null).size).toBe(0);
    expect(coverageByStudent(undefined).size).toBe(0);
    expect(coverageByStudent("boom").size).toBe(0);
    expect(coverageByStudent({ rows: [] }).size).toBe(0);
  });

  it("skips malformed rows rather than throwing", () => {
    const map = coverageByStudent([
      null,
      42,
      row({ coverage: "yes" }), // unknown verdict
      row({ student_id: 7 }), // wrong type
      row({ student_id: "ok" }),
    ]);
    expect([...map.keys()]).toEqual(["ok"]);
  });

  it("treats a non-numeric lessons_remaining as null", () => {
    const map = coverageByStudent([row({ lessons_remaining: "8" })]);
    expect(map.get("s1")?.lessonsRemaining).toBeNull();
  });
});

describe("isRunningLow (the Students-page filter)", () => {
  const cov = (
    coverage: StudentCoverage["coverage"],
    lessonsRemaining: number | null
  ): StudentCoverage => ({
    parentId: "p1",
    tenantId: "t1",
    coverage,
    lessonsRemaining,
  });

  it("flags a covered child at or below the threshold", () => {
    expect(isRunningLow(cov("package", 2), 2)).toBe(true);
    expect(isRunningLow(cov("package", 3), 2)).toBe(false);
  });

  // The rule the old by-parent sum broke: a child whose class the package
  // cannot pay for must never be flagged — no pool is not an empty pool.
  it("never flags an ad_hoc child, whatever the threshold", () => {
    expect(isRunningLow(cov("ad_hoc", null), 99)).toBe(false);
  });

  it("an EXHAUSTED package (0 left) is low — that family needs the reminder", () => {
    expect(isRunningLow(cov("package", 0), 2)).toBe(true);
  });

  it("no coverage row, or no threshold, means not low", () => {
    expect(isRunningLow(undefined, 2)).toBe(false);
    expect(isRunningLow(cov("package", 1), null)).toBe(false);
  });
});

describe("familyLessonsByParent (family-grain surfaces)", () => {
  const live = (over: Record<string, unknown> = {}) => ({
    parent_id: "p1",
    expires_on: "2099-01-01",
    live_lessons_remaining: 5,
    ...over,
  });

  it("sums a parent's packages", () => {
    const map = familyLessonsByParent([live(), live({ live_lessons_remaining: 3 })], "2026-08-01");
    expect(map.get("p1")).toBe(8);
  });

  // package_live_balances() returns date-expired rows whose status is still
  // 'active' — the same server-side filter the RPC applies must apply here.
  it("excludes a date-expired package", () => {
    const map = familyLessonsByParent(
      [live({ expires_on: "2026-07-31" })],
      "2026-08-01"
    );
    expect(map.has("p1")).toBe(false);
  });

  it("a package expiring TODAY still counts", () => {
    const map = familyLessonsByParent(
      [live({ expires_on: "2026-08-01" })],
      "2026-08-01"
    );
    expect(map.get("p1")).toBe(5);
  });

  it("tolerates garbage input", () => {
    expect(familyLessonsByParent(null, "2026-08-01").size).toBe(0);
    expect(familyLessonsByParent([null, 1, {}], "2026-08-01").size).toBe(0);
  });
});

describe("familyLabel", () => {
  it("labels a package-holding family with the summed count", () => {
    const byParent = new Map([["p1", 8]]);
    expect(familyLabel(byParent, "p1")).toEqual({
      coverage: "package",
      lessonsRemaining: 8,
    });
  });

  it("labels everyone else ad_hoc — explicit both ways", () => {
    expect(familyLabel(new Map(), "p1")).toEqual({
      coverage: "ad_hoc",
      lessonsRemaining: null,
    });
    expect(familyLabel(new Map([["p1", 8]]), null)).toEqual({
      coverage: "ad_hoc",
      lessonsRemaining: null,
    });
  });
});
