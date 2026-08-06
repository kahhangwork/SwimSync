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
  it("is the 1st of last month with no server floor", () => {
    expect(markableWindowStart("2026-07-25")).toBe("2026-06-01");
  });

  it("rolls back across a year boundary", () => {
    expect(markableWindowStart("2026-01-10")).toBe("2025-12-01");
  });

  // The business's own floor (markable_window_start, 20260806000200). Applied
  // as a minimum, so it can only ever OPEN dates — never close one the calendar
  // rule allowed. A client stricter than the database is a bug the client
  // invented; these four cases are what stop that shape existing.

  it("takes the business's floor when it reaches further back", () => {
    expect(markableWindowStart("2026-10-05", "2026-08-01")).toBe("2026-08-01");
  });

  it("IGNORES a server floor later than the calendar rule", () => {
    expect(markableWindowStart("2026-07-25", "2026-07-01")).toBe("2026-06-01");
  });

  it("falls back to the calendar rule on null (the fetch failed)", () => {
    expect(markableWindowStart("2026-07-25", null)).toBe("2026-06-01");
  });

  it("falls back to the calendar rule on undefined (not yet loaded)", () => {
    expect(markableWindowStart("2026-07-25", undefined)).toBe("2026-06-01");
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

  // ── windowFloor: the business's own floor reaches the screen ──────────────

  it("allows a lesson the CALENDAR rule would close, when the business's floor is lower", () => {
    // 5 Oct 2026, marking a Saturday in August — the deadlock case. Refused
    // before 20260806000200; allowed now because August was never sealed.
    const out = checkMarkableDate({
      ...base,
      today: "2026-10-05",
      date: "2026-08-15",
      windowFloor: "2026-08-01",
    });
    expect(out.ok).toBe(true);
  });

  it("still refuses below the business's own floor, naming it", () => {
    const out = checkMarkableDate({
      ...base,
      today: "2026-10-05",
      date: "2026-07-18",
      windowFloor: "2026-08-01",
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.detail).toContain("2026-08-01");
  });

  it("is never STRICTER than the calendar rule, whatever windowFloor says", () => {
    // A floor later than the calendar rule must not close a date that a client
    // without the parameter would have allowed.
    const out = checkMarkableDate({
      ...base,
      date: "2026-06-06",
      windowFloor: "2026-07-01",
    });
    expect(out.ok).toBe(true);
  });
});
