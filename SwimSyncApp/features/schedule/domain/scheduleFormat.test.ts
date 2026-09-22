// CHARACTERISATION test (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 1): pins what the
// Schedule tab's formatters already did when they moved out of the route file.
// §7.25's prove-it-red rule does not apply — there is no fix, only a move.
import { formatTime, shortDate, dayHeading } from "./scheduleFormat";

describe("scheduleFormat (characterisation)", () => {
  it("formatTime: 24h 'HH:MM[:SS]' -> 12h with AM/PM, midnight and noon as 12, seconds dropped", () => {
    expect(formatTime("00:05")).toBe("12:05 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime("13:30:00")).toBe("1:30 PM");
    expect(formatTime("09:15:00")).toBe("9:15 AM");
  });

  it("shortDate: day + short month", () => {
    expect(shortDate("2026-09-21")).toBe("21 Sept");
  });

  it("dayHeading: short weekday + day + short month", () => {
    expect(dayHeading("2026-09-25")).toBe("Fri, 25 Sept");
  });

  it("prints the SG calendar date whatever the device timezone", () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(shortDate("2026-09-21")).toBe("21 Sept");
      expect(dayHeading("2026-09-25")).toBe("Fri, 25 Sept");
    } finally {
      process.env.TZ = prev;
    }
  });
});
