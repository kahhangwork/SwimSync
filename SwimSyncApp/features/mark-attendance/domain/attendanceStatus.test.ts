// CHARACTERISATION test (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 1): pins what the
// marking screen's status mapping and date formatter already did when they moved
// out of the route file. §7.25's prove-it-red rule does not apply — there is no
// fix, only a move.
import { formatDate, fromDBStatus, toDBStatus } from "./attendanceStatus";
import type { DBStatus } from "../types";

describe("attendanceStatus (characterisation)", () => {
  it("every settable DBStatus round-trips fromDBStatus -> toDBStatus", () => {
    const settable: DBStatus[] = [
      "present", "absent", "cancelled_rain", "cancelled_coach", "trial_paid", "trial_free",
    ];
    for (const st of settable) {
      const { top, sub } = fromDBStatus(st);
      expect(toDBStatus(top, sub)).toBe(st);
    }
  });

  it("holiday reads in but maps back to null — toDBStatus has no holiday arm (the coach never writes it)", () => {
    expect(fromDBStatus("holiday")).toEqual({ top: "holiday", sub: null });
    expect(toDBStatus("holiday", null)).toBeNull();
  });

  it("unmarked -> null", () => {
    expect(toDBStatus("unmarked", null)).toBeNull();
  });

  it("present/absent ignore sub", () => {
    expect(toDBStatus("present", "rain")).toBe("present");
    expect(toDBStatus("absent", "paid")).toBe("absent");
  });

  it("cancelled/trial with a null or mismatched sub -> null (the save's 'select a sub-type' toast)", () => {
    expect(toDBStatus("cancelled", null)).toBeNull();
    expect(toDBStatus("cancelled", "paid")).toBeNull();
    expect(toDBStatus("trial", null)).toBeNull();
    expect(toDBStatus("trial", "rain")).toBeNull();
  });

  it("formatDate: short weekday + day + short month + year, SG calendar date", () => {
    expect(formatDate("2026-09-05")).toBe("Sat, 5 Sept 2026");
  });

  it("formatDate: an unparseable date degrades to itself", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});
