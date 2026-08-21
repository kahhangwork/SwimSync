import {
  computeUpcomingLessons,
  UPCOMING_HORIZON_DAYS,
  type UpcomingEnrolment,
  type UpcomingExplicit,
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

  it("tags projected weekly rows with kind 'class'", () => {
    const out = computeUpcomingLessons([mondayClass], MONDAY, new Set());
    expect(out.every((u) => u.kind === "class")).toBe(true);
  });

  describe("make-ups and extra lessons (explicit rows)", () => {
    const makeup: UpcomingExplicit = {
      class_id: "cB", // a DIFFERENT (host) class — a make-up guests elsewhere
      class_title: "Saturday Squad",
      session_date: "2026-08-20", // Thu, not the child's Monday class
      time_label: "10:00 AM – 11:00 AM",
    };
    const extra: UpcomingExplicit = {
      class_id: "c1", // the child's OWN class, off-schedule date
      class_title: "Toddler 2",
      session_date: "2026-08-19", // Wed, not a Monday
      time_label: "5:00 PM – 6:00 PM",
    };

    it("includes a booked make-up, tagged kind 'makeup'", () => {
      const out = computeUpcomingLessons([mondayClass], MONDAY, new Set(), [makeup]);
      const row = out.find((u) => u.session_date === "2026-08-20");
      expect(row).toMatchObject({ kind: "makeup", class_title: "Saturday Squad" });
    });

    it("includes an off-schedule extra lesson, tagged kind 'extra'", () => {
      const out = computeUpcomingLessons([mondayClass], MONDAY, new Set(), [], [extra]);
      const row = out.find((u) => u.session_date === "2026-08-19");
      expect(row).toMatchObject({ kind: "extra", class_title: "Toddler 2" });
    });

    it("excludes explicit rows in the past or beyond the horizon", () => {
      const past: UpcomingExplicit = { ...extra, session_date: "2026-08-16" }; // before MONDAY
      const far: UpcomingExplicit = { ...extra, session_date: "2026-09-15" }; // horizon is 09-14
      const out = computeUpcomingLessons([], MONDAY, new Set(), [past], [far]);
      expect(out).toEqual([]);
    });

    it("INCLUDES explicit rows exactly on `today` and on the horizon edge (bounds are inclusive)", () => {
      const onToday: UpcomingExplicit = { ...makeup, class_id: "cT", session_date: MONDAY };
      const onEdge: UpcomingExplicit = { ...extra, session_date: "2026-09-14" }; // MONDAY + 28
      const out = computeUpcomingLessons([], MONDAY, new Set(), [onToday], [onEdge]);
      expect(out.map((u) => u.session_date)).toEqual([MONDAY, "2026-09-14"]);
    });

    // ⚠ RISK 6 precedence WITHIN explicit rows: make-ups are pushed before extras,
    // so a make-up wins a same-(class,date) collision with an extra.
    it("RISK 6: a make-up beats an extra on the same (class, date) — one row, kind 'makeup'", () => {
      const mk: UpcomingExplicit = {
        class_id: "cX",
        class_title: "Clinic",
        session_date: "2026-08-19",
        time_label: "",
      };
      const ex: UpcomingExplicit = { ...mk };
      const out = computeUpcomingLessons([], MONDAY, new Set(), [mk], [ex]);
      const onDate = out.filter((u) => u.class_id === "cX" && u.session_date === "2026-08-19");
      expect(onDate).toHaveLength(1);
      expect(onDate[0].kind).toBe("makeup");
    });

    it("does NOT holiday-subtract explicit rows — evidence is not clamped by the guess", () => {
      // The extra lesson is on 2026-08-19; even if that date is a declared holiday,
      // an explicitly-scheduled lesson is evidence it runs.
      const out = computeUpcomingLessons(
        [mondayClass],
        MONDAY,
        new Set(["2026-08-19"]),
        [],
        [extra],
      );
      expect(out.some((u) => u.session_date === "2026-08-19" && u.kind === "extra")).toBe(true);
    });

    // ⚠ RISK 6 — explicit rows are pushed BEFORE the projection, so an explicit
    // row WINS a (class, date) collision. Proven by asserting the surviving row's kind.
    it("RISK 6: an extra on the same (class, date) as a projected weekly lesson wins — one row, kind 'extra'", () => {
      const collide: UpcomingExplicit = {
        class_id: "c1",
        class_title: "Toddler 2",
        session_date: "2026-08-17", // exactly the projected Monday
        time_label: "5:00 PM – 6:00 PM",
      };
      const out = computeUpcomingLessons([mondayClass], MONDAY, new Set(), [], [collide]);
      const onDate = out.filter((u) => u.class_id === "c1" && u.session_date === "2026-08-17");
      expect(onDate).toHaveLength(1);
      expect(onDate[0].kind).toBe("extra");
    });

    // ⚠ RISK 6 — a make-up keys on its HOST class, so it never dedups against the
    // child's own class on the same date: two rows is correct, assert it deliberately.
    it("RISK 6: a make-up in another class on the same date as the own-class lesson yields TWO rows", () => {
      const sameDayMakeup: UpcomingExplicit = {
        class_id: "cB",
        class_title: "Saturday Squad",
        session_date: "2026-08-17", // same day as the child's own Monday class
        time_label: "",
      };
      const out = computeUpcomingLessons([mondayClass], MONDAY, new Set(), [sameDayMakeup]);
      const onDate = out.filter((u) => u.session_date === "2026-08-17");
      expect(onDate).toHaveLength(2);
      expect(onDate.map((u) => u.kind).sort()).toEqual(["class", "makeup"]);
    });
  });
});
