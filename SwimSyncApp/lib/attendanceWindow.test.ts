// jest-expo provides describe/it/expect globally (see lessonDates.test.ts).
import { checkMarkableDate, markableWindowStart } from "./attendanceWindow";

const SAT = "saturday" as const;

/** The common case: a real lesson date this week, no session yet. */
const base = {
  today: "2026-07-25", // a Saturday
  classDayOfWeek: SAT,
  classTitle: "Saturday Beginners",
  sessionExists: false,
};

describe("markableWindowStart", () => {
  it("is the 1st of last month", () => {
    expect(markableWindowStart("2026-07-25")).toBe("2026-06-01");
  });

  it("rolls back across a year boundary", () => {
    expect(markableWindowStart("2026-01-10")).toBe("2025-12-01");
  });
});

describe("checkMarkableDate", () => {
  it("allows a lesson on the class's own weekday inside the window", () => {
    expect(checkMarkableDate({ ...base, date: "2026-07-18" }).ok).toBe(true);
    expect(checkMarkableDate({ ...base, date: "2026-07-25" }).ok).toBe(true);
  });

  it("refuses a future lesson", () => {
    // Saturday next week — a real lesson day, but it has not happened.
    const out = checkMarkableDate({ ...base, date: "2026-08-01" });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.title).toBe("That lesson hasn't happened yet");
  });

  it("refuses a lesson below the window floor", () => {
    // A Saturday, so this isolates the window rule from the weekday rule.
    const out = checkMarkableDate({ ...base, date: "2026-05-30" });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.title).toBe("That lesson is closed");
    // The floor is named, so the coach knows how far back they CAN go.
    expect(out.ok === false && out.detail).toContain("2026-06-01");
  });

  it("allows the exact floor date", () => {
    // 2026-06-06 is the first Saturday on or after the 1st of June.
    expect(checkMarkableDate({ ...base, date: "2026-06-06" }).ok).toBe(true);
  });

  it("refuses a day the class does not run", () => {
    // Friday, inside the window.
    const out = checkMarkableDate({ ...base, date: "2026-07-24" });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.title).toBe("That isn't a lesson day");
    // Points at the remedy rather than dead-ending.
    expect(out.ok === false && out.detail).toContain("extra lesson");
  });

  // THE OFF-SCHEDULE CASE. An admin-scheduled makeup is not on the class's
  // weekday by definition, so re-deriving the weekday here would refuse to mark
  // the very lessons the override exists to create. An existing session is the
  // authorisation — which is exactly why the database's attendance trigger
  // checks the window and NOT the weekday.
  it("allows a non-lesson day when the session already exists", () => {
    const out = checkMarkableDate({
      ...base,
      date: "2026-07-24",
      sessionExists: true,
    });
    expect(out.ok).toBe(true);
  });

  it("still refuses an out-of-window date even when the session exists", () => {
    // An old session is real, but marking a NEW row on it would record a
    // lesson that can never bill. Corrections go through the credit-note flow.
    const out = checkMarkableDate({
      ...base,
      date: "2026-03-14",
      sessionExists: true,
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.title).toBe("That lesson is closed");
  });

  it("refuses a malformed date rather than passing it to the database", () => {
    const out = checkMarkableDate({ ...base, date: "not-a-date" });
    expect(out.ok).toBe(false);
  });
});
