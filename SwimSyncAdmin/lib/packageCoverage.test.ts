import { describe, expect, it } from "vitest";
import {
  coverageByStudent,
  familyLabel,
  familyLessonsByParent,
} from "./packageCoverage";

const row = (over: Record<string, unknown> = {}) => ({
  student_id: "s1",
  parent_id: "p1",
  tenant_id: "t1",
  coverage: "package",
  lessons_remaining: 8,
  low: true,
  package_id: "pkg1",
  package_name: "8 Group",
  expires_on: "2026-12-01",
  ...over,
});

describe("coverageByStudent", () => {
  it("indexes rows by student_id, carrying the low + covering-package fields", () => {
    const map = coverageByStudent([
      row(),
      row({
        student_id: "s2",
        coverage: "ad_hoc",
        lessons_remaining: null,
        low: false,
        package_id: null,
        package_name: null,
        expires_on: null,
      }),
    ]);
    expect(map.get("s1")).toEqual({
      parentId: "p1",
      tenantId: "t1",
      coverage: "package",
      lessonsRemaining: 8,
      low: true,
      packageId: "pkg1",
      packageName: "8 Group",
      expiresOn: "2026-12-01",
    });
    expect(map.get("s2")?.coverage).toBe("ad_hoc");
    expect(map.get("s2")?.low).toBe(false);
    expect(map.get("s2")?.lessonsRemaining).toBeNull();
  });

  it("low defaults to false when the field is absent or not boolean-true", () => {
    const map = coverageByStudent([row({ low: undefined }), row({ student_id: "s3", low: "yes" })]);
    expect(map.get("s1")?.low).toBe(false);
    expect(map.get("s3")?.low).toBe(false);
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

// ⚠ RISK 10 — isRunningLow() was DELETED (one definition of "low", in SQL). Its
// former tests are gone with it; the Students filter now reads coverage.low,
// pinned by coverageByStudent above and by verify-packages.mjs end-to-end.

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
