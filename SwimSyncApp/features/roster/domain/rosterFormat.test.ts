// CHARACTERISATION test (COACH_ROSTER_REFACTOR_PLAN.md, Stage 1): pins what the
// roster screen's formatters already did when they moved out of the route file.
// §7.25's prove-it-red rule does not apply — there is no fix, only a move.
import { formatTime, formatDate, capitalize } from "./rosterFormat";

describe("rosterFormat (characterisation)", () => {
  it("formatTime: 24h 'HH:MM[:SS]' -> 12h with AM/PM, midnight and noon as 12", () => {
    expect(formatTime("00:05:00")).toBe("12:05 AM");
    expect(formatTime("09:30:00")).toBe("9:30 AM");
    expect(formatTime("12:00:00")).toBe("12:00 PM");
    expect(formatTime("17:45")).toBe("5:45 PM");
  });

  it("formatTime: the header's empty-string fallback renders '12:undefined AM', as it always has", () => {
    // classInfo?.start_time ?? "" — only while classInfo is null, which the
    // spinner hides. Pinned so a "fix" is a deliberate behaviour change.
    expect(formatTime("")).toBe("12:undefined AM"); // NaN % 12 is falsy -> 12
  });

  it("formatDate: weekday + day + month + YEAR, SG calendar date", () => {
    expect(formatDate("2026-09-05")).toBe("Sat, 5 Sept 2026");
  });

  it("formatDate: an unparseable date degrades to itself", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  it("capitalize: first letter only, '' stays ''", () => {
    expect(capitalize("saturday")).toBe("Saturday");
    expect(capitalize("")).toBe("");
  });
});
