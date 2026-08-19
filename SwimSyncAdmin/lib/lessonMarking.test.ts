import { describe, it, expect } from "vitest";
import {
  optionsForKind,
  holidayTransitions,
  lessonMarkability,
  rowEditable,
  SET_ALL_OPTIONS,
} from "./lessonMarking";

describe("optionsForKind", () => {
  it("offers trial statuses only to trial guests; holiday to everyone (the admin is the one marking)", () => {
    expect(optionsForKind("enrolled")).toEqual(["present", "absent", "cancelled_rain", "cancelled_coach", "holiday"]);
    expect(optionsForKind("makeup")).toEqual(["present", "absent", "cancelled_rain", "cancelled_coach", "holiday"]);
    expect(optionsForKind("trial")).toContain("trial_paid");
    expect(optionsForKind("trial")).toContain("trial_free");
    expect(optionsForKind("trial")).toContain("holiday");
  });

  it("Set all never offers a trial status (not every row may take it)", () => {
    expect(SET_ALL_OPTIONS).not.toContain("trial_paid");
    expect(SET_ALL_OPTIONS).toContain("holiday");
  });
});

describe("holidayTransitions", () => {
  it("counts rows turning INTO holiday, not rows already holiday", () => {
    expect(
      holidayTransitions([
        { studentId: "a", kind: "enrolled", prev: "present", next: "holiday" },
        { studentId: "b", kind: "enrolled", prev: null, next: "holiday" },
        { studentId: "c", kind: "enrolled", prev: "holiday", next: "holiday" },
        { studentId: "d", kind: "enrolled", prev: "present", next: "absent" },
      ])
    ).toBe(2);
  });
});

describe("lessonMarkability", () => {
  const base = { today: "2026-08-19", classDayOfWeek: "monday" as const, classTitle: "Mon", windowFloor: "2026-07-01" };

  it("a future date is refused (cannot mark ahead)", () => {
    const r = lessonMarkability({ ...base, date: "2026-08-24", sessionExists: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.title).toMatch(/hasn't happened/);
  });

  it("a date below the floor is refused with the floor named", () => {
    const r = lessonMarkability({ ...base, date: "2026-06-01", sessionExists: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/2026-07-01/);
  });

  it("an off-weekday date with NO session is not a lesson; with a session (extra lesson) it is", () => {
    const off = lessonMarkability({ ...base, date: "2026-08-18", sessionExists: false });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.title).toMatch(/isn't a lesson day/);
    expect(lessonMarkability({ ...base, date: "2026-08-18", sessionExists: true }).ok).toBe(true);
  });

  it("a past Monday inside the window is markable", () => {
    expect(lessonMarkability({ ...base, date: "2026-08-17", sessionExists: false }).ok).toBe(true);
  });
});

describe("rowEditable", () => {
  it("an existing row is always a correction; a new row needs the date to be markable", () => {
    expect(rowEditable(true, false)).toBe(true);
    expect(rowEditable(false, true)).toBe(true);
    expect(rowEditable(false, false)).toBe(false);
  });
});
