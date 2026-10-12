// CHARACTERISATION test (COACH_SCHEDULE_REFACTOR_PLAN.md, Stage 1): pins what the
// Schedule tab's formatters already did when they moved out of the route file.
// §7.25's prove-it-red rule does not apply — there is no fix, only a move.
import { formatTime, shortDate, dayHeading, blockedMonths, coachTitle } from "./scheduleFormat";

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

  it("dayHeading: short weekday + day + short month, no comma (DESIGN.md)", () => {
    expect(dayHeading("2026-09-25")).toBe("Fri 25 Sept");
  });

  it("prints the SG calendar date whatever the device timezone", () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(shortDate("2026-09-21")).toBe("21 Sept");
      expect(dayHeading("2026-09-25")).toBe("Fri 25 Sept");
    } finally {
      process.env.TZ = prev;
    }
  });
});

describe("blockedMonths — the months the backlog holds back", () => {
  it("one month, two, three; oldest first; deduplicated", () => {
    expect(blockedMonths(["2026-09-26"])).toBe("Sept");
    expect(blockedMonths(["2026-10-10", "2026-09-26", "2026-10-03"])).toBe("Sept and Oct");
    expect(blockedMonths(["2026-10-10", "2026-08-29", "2026-09-26"])).toBe("Aug, Sept and Oct");
  });
  it("Sept, as every surface spells it (G-Sept, §7.302); a year boundary sorts by year", () => {
    expect(blockedMonths(["2026-09-01"])).toBe("Sept");
    expect(blockedMonths(["2027-01-02", "2026-12-26"])).toBe("Dec and Jan");
  });
  it("nothing in, nothing out", () => {
    expect(blockedMonths([])).toBe("");
  });
});

describe("coachTitle — the greeting never says Coach twice", () => {
  it("prefixes a bare name", () => {
    expect(coachTitle("Marcus Tan")).toBe("Coach Marcus Tan");
  });
  it("keeps a name that already carries the title (any case)", () => {
    expect(coachTitle("Coach Marcus")).toBe("Coach Marcus");
    expect(coachTitle("coach marcus")).toBe("coach marcus");
  });
  it("does not mistake a name that merely starts with the letters", () => {
    expect(coachTitle("Coachella Lim")).toBe("Coach Coachella Lim");
  });
  it("no session yet → a dash, as before", () => {
    expect(coachTitle(undefined)).toBe("Coach —");
  });
});
