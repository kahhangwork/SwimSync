import {
  computeUpcomingLessons,
  UPCOMING_HORIZON_DAYS,
  type UpcomingEnrolment,
} from "./upcomingLessons";

// 2026-08-17 is a Monday. A Monday class projected from here lands on
// 08-17, 08-24, 08-31, 09-07, 09-14 (09-14 is exactly +28, the horizon edge).
const MONDAY = "2026-08-17";

const mondayClass: UpcomingEnrolment = {
  class_id: "c1",
  day_of_week: "monday",
  class_title: "Toddler 2",
  time_label: "5:00 PM – 6:00 PM",
};

describe("computeUpcomingLessons", () => {
  it("projects a class's weekday across the ~4-week horizon, sorted ascending", () => {
    const out = computeUpcomingLessons([mondayClass], MONDAY, new Set());
    expect(out.map((u) => u.session_date)).toEqual([
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
    ]);
    expect(out[0]).toMatchObject({ class_title: "Toddler 2", time_label: "5:00 PM – 6:00 PM" });
  });

  it("⚠ RISK 4 — removes dates that fall on a tenant public holiday", () => {
    // National Day observed etc. — the business closed the pool on 08-31.
    const out = computeUpcomingLessons([mondayClass], MONDAY, new Set(["2026-08-31"]));
    expect(out.map((u) => u.session_date)).toEqual([
      "2026-08-17",
      "2026-08-24",
      "2026-09-07",
      "2026-09-14",
    ]);
    expect(out.some((u) => u.session_date === "2026-08-31")).toBe(false);
  });

  it("merges two classes and dedupes per (class, date), keeping both same-day classes", () => {
    const alsoMonday: UpcomingEnrolment = {
      class_id: "c2",
      day_of_week: "monday",
      class_title: "Stroke Clinic",
      time_label: "",
    };
    const out = computeUpcomingLessons([mondayClass, alsoMonday], MONDAY, new Set());
    // Same date, two different classes → both kept (10 rows), still date-sorted.
    expect(out).toHaveLength(10);
    expect(out.filter((u) => u.session_date === "2026-08-17")).toHaveLength(2);
  });

  it("returns nothing when the child has no active enrolments", () => {
    expect(computeUpcomingLessons([], MONDAY, new Set())).toEqual([]);
  });

  it("uses a 28-day horizon", () => {
    expect(UPCOMING_HORIZON_DAYS).toBe(28);
  });
});
