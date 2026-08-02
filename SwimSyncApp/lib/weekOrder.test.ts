import {
  groupByWeekday,
  weekdayLabel,
  WEEK_ORDER,
  type WeekdayGroup,
} from "./weekOrder";
import type { DayOfWeek } from "./lessonDates";

type Cls = { id: string; day_of_week: string };

const cls = (id: string, day: string): Cls => ({ id, day_of_week: day });
const dayOf = (c: Cls) => c.day_of_week;

/** One class on every day of the week, so a rotation is fully observable. */
const ONE_PER_DAY: Cls[] = WEEK_ORDER.map((d) => cls(d, d));

const days = (groups: WeekdayGroup<Cls>[]) => groups.map((g) => g.day);

describe("groupByWeekday — rotation", () => {
  // ⚠ THE POINT OF THIS FILE. `day_of_week` is a string, and the obvious
  // implementations of "sort the week" — Array.sort(), or trusting a Map's
  // insertion order — give ALPHABETICAL order: friday, monday, saturday,
  // sunday, thursday, tuesday, wednesday. A coach reading that believes their
  // Friday class is next when it is five days away.
  it.each(WEEK_ORDER)("today=%s leads, and the week wraps from there", (today) => {
    const result = days(groupByWeekday(ONE_PER_DAY, dayOf, today));

    expect(result).toHaveLength(7);
    expect(result[0]).toBe(today);

    const start = WEEK_ORDER.indexOf(today);
    expect(result).toEqual([
      ...WEEK_ORDER.slice(start),
      ...WEEK_ORDER.slice(0, start),
    ]);
  });

  it("sunday-today wraps to the START of the week, not to alphabetical order", () => {
    const result = days(groupByWeekday(ONE_PER_DAY, dayOf, "sunday"));

    expect(result).toEqual([
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ]);
    // The failure this guards against, spelled out.
    expect(result).not.toEqual([...WEEK_ORDER].sort());
    expect(result[1]).not.toBe("friday");
  });

  it("marks exactly one group as today", () => {
    const groups = groupByWeekday(ONE_PER_DAY, dayOf, "thursday");
    expect(groups.filter((g) => g.isToday)).toHaveLength(1);
    expect(groups.find((g) => g.isToday)?.day).toBe("thursday");
  });

  it("marks NO group as today when the coach teaches nothing today", () => {
    const groups = groupByWeekday(
      [cls("a", "tuesday"), cls("b", "saturday")],
      dayOf,
      "sunday"
    );
    expect(groups.some((g) => g.isToday)).toBe(false);
    // Still rotated: Tuesday is nearer to Sunday than Saturday going forward.
    expect(days(groups)).toEqual(["tuesday", "saturday"]);
  });
});

describe("groupByWeekday — grouping", () => {
  it("omits days with no classes", () => {
    const groups = groupByWeekday(
      [cls("a", "tuesday"), cls("b", "tuesday"), cls("c", "saturday")],
      dayOf,
      "tuesday"
    );
    expect(days(groups)).toEqual(["tuesday", "saturday"]);
    expect(groups[0].items.map((c) => c.id)).toEqual(["a", "b"]);
  });

  // The query orders by start_time; regrouping must not disturb that, or the
  // 8:45 class renders under the 9:30 one.
  it("preserves input order within a day", () => {
    const groups = groupByWeekday(
      [cls("845", "saturday"), cls("930", "saturday"), cls("1100", "saturday")],
      dayOf,
      "saturday"
    );
    expect(groups[0].items.map((c) => c.id)).toEqual(["845", "930", "1100"]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupByWeekday([], dayOf, "monday")).toEqual([]);
  });
});

describe("groupByWeekday — degraded inputs must not lose a class", () => {
  // A class is the coach's livelihood. Dropping one because its weekday failed
  // a string match would be silent, and the coach would simply never see it.
  it("keeps a class whose weekday is not recognised, sorting it last", () => {
    const groups = groupByWeekday(
      [cls("good", "monday"), cls("odd", "someday")],
      dayOf,
      "monday"
    );
    expect(days(groups)).toEqual(["monday", "someday"]);
    expect(groups.flatMap((g) => g.items.map((c) => c.id))).toEqual([
      "good",
      "odd",
    ]);
  });

  it("falls back to plain week order when today is unknown", () => {
    const groups = groupByWeekday(ONE_PER_DAY, dayOf, null);
    expect(days(groups)).toEqual(WEEK_ORDER);
    expect(groups.some((g) => g.isToday)).toBe(false);
  });
});

describe("WEEK_ORDER", () => {
  // Pins the agreement with the Postgres enum's declaration order
  // (20260309000100_initial_schema.sql:15). The classes query depends on
  // `.order("day_of_week")` sorting this way; if the enum is ever redeclared,
  // this test is the thing that should fail.
  it("is monday-first, matching the day_of_week enum", () => {
    expect(WEEK_ORDER).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
  });

  it("is exhaustive over DayOfWeek", () => {
    const every: Record<DayOfWeek, true> = {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
      sunday: true,
    };
    expect([...WEEK_ORDER].sort()).toEqual(Object.keys(every).sort());
  });
});

describe("weekdayLabel", () => {
  it("capitalises for display", () => {
    expect(weekdayLabel("monday")).toBe("Monday");
    expect(weekdayLabel("someday")).toBe("Someday");
    expect(weekdayLabel("")).toBe("");
  });
});
