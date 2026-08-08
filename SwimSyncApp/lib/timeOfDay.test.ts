import {
  nowMinutesInSg,
  toMinutes,
  isNowInRange,
  hasEndedInSg,
  hasLessonEnded,
} from "./timeOfDay";

// The instant that proves the point: 23:30 UTC is 07:30 the NEXT DAY in
// Singapore. The expression this replaced — `now.getHours() * 60 +
// now.getMinutes()` — returns 1410 under TZ=UTC and 450 under TZ=Asia/Singapore
// for the same moment. 1410 is past every class's end time, so every lesson
// would have read as already finished. §7.7.
const LATE_UTC = new Date("2026-07-26T23:30:00Z"); // 07:30 SGT, 27 Jul
const MIDDAY_SG = new Date("2026-07-26T04:00:00Z"); // 12:00 SGT
const MIDNIGHT_SG = new Date("2026-07-26T16:00:00Z"); // 00:00 SGT, 27 Jul

describe("nowMinutesInSg", () => {
  it("is 07:30 SGT for 23:30 UTC — the case the device clock got wrong", () => {
    expect(nowMinutesInSg(LATE_UTC)).toBe(7 * 60 + 30);
  });

  it("is midday for 04:00 UTC", () => {
    expect(nowMinutesInSg(MIDDAY_SG)).toBe(12 * 60);
  });

  // An ICU build that renders midnight as hour "24" would yield 1440 here —
  // past every class end time, so every lesson would read as ended and the
  // "Upcoming" state would never appear.
  it("normalises SGT midnight to 0, not 1440", () => {
    expect(nowMinutesInSg(MIDNIGHT_SG)).toBe(0);
  });

  // THE REGRESSION GUARD. The device's timezone must not be able to leak in.
  // Each of these would return a different number from `getHours()`.
  describe.each(["UTC", "America/New_York", "Asia/Singapore", "Pacific/Auckland"])(
    "with the process in %s",
    (tz) => {
      const original = process.env.TZ;
      beforeAll(() => {
        process.env.TZ = tz;
      });
      afterAll(() => {
        process.env.TZ = original;
      });

      it("still reads 07:30 SGT for 23:30 UTC", () => {
        expect(nowMinutesInSg(LATE_UTC)).toBe(450);
      });

      it("still reads midday SGT for 04:00 UTC", () => {
        expect(nowMinutesInSg(MIDDAY_SG)).toBe(720);
      });
    }
  );
});

describe("toMinutes", () => {
  it("parses HH:MM", () => {
    expect(toMinutes("08:45")).toBe(525);
  });

  it("parses the HH:MM:SS Postgres hands back for a TIME column", () => {
    expect(toMinutes("09:30:00")).toBe(570);
  });

  it("handles midnight", () => {
    expect(toMinutes("00:00")).toBe(0);
  });
});

describe("isNowInRange", () => {
  it("is true inside the lesson", () => {
    expect(isNowInRange("08:45", "09:30", toMinutes("09:00"))).toBe(true);
  });

  // Inclusive at both ends, matching the expression this replaced — a coach
  // opening the app exactly on the hour must still see the "Now" badge.
  it("is true exactly on the start and end minutes", () => {
    expect(isNowInRange("08:45", "09:30", toMinutes("08:45"))).toBe(true);
    expect(isNowInRange("08:45", "09:30", toMinutes("09:30"))).toBe(true);
  });

  it("is false before and after", () => {
    expect(isNowInRange("08:45", "09:30", toMinutes("08:44"))).toBe(false);
    expect(isNowInRange("08:45", "09:30", toMinutes("09:31"))).toBe(false);
  });
});

describe("hasEndedInSg", () => {
  // Keyed to the END of the class deliberately: a coach marks at the end, so a
  // lesson in progress is not yet overdue.
  it("is false while the lesson is still running", () => {
    expect(hasEndedInSg("09:30", toMinutes("09:29"))).toBe(false);
  });

  it("is false on the closing minute itself", () => {
    expect(hasEndedInSg("09:30", toMinutes("09:30"))).toBe(false);
  });

  it("is true once past the end", () => {
    expect(hasEndedInSg("09:30", toMinutes("09:31"))).toBe(true);
  });

  it("a morning class HAS ended when read at 07:30 SGT the next day", () => {
    // Ties the two halves together: the 23:30-UTC instant is 07:30 SGT, so a
    // class that ended at 09:30 yesterday is NOT what this asks about — this is
    // today's 06:00 class, which has ended.
    expect(hasEndedInSg("06:00", nowMinutesInSg(LATE_UTC))).toBe(true);
    expect(hasEndedInSg("09:30", nowMinutesInSg(LATE_UTC))).toBe(false);
  });
});

describe("hasLessonEnded — the dated generalisation", () => {
  const TODAY = "2026-08-08";
  const MIDDAY = toMinutes("12:00");

  it("a PAST lesson has always ended, whatever the clock says", () => {
    expect(hasLessonEnded("2026-08-07", TODAY, "23:59", 0)).toBe(true);
    expect(hasLessonEnded("2026-07-01", TODAY, "09:00", MIDDAY)).toBe(true);
  });

  it("a FUTURE lesson never has — this is what stops a week view nagging", () => {
    // The one that matters: without it, tomorrow's 09:00 class reads
    // "Not marked" at midday today, i.e. the screen demands attendance for a
    // lesson that has not happened.
    expect(hasLessonEnded("2026-08-09", TODAY, "09:00", MIDDAY)).toBe(false);
    expect(hasLessonEnded("2026-08-09", TODAY, "00:01", MIDDAY)).toBe(false);
  });

  it("TODAY defers to the clock, exactly as hasEndedInSg does", () => {
    expect(hasLessonEnded(TODAY, TODAY, "11:59", MIDDAY)).toBe(true);
    expect(hasLessonEnded(TODAY, TODAY, "12:00", MIDDAY)).toBe(false);
    expect(hasLessonEnded(TODAY, TODAY, "12:01", MIDDAY)).toBe(false);
  });

  it("agrees with hasEndedInSg for every same-day case", () => {
    const ends = ["06:00", "09:30", "12:00", "17:15", "23:59"];
    const nows = [0, toMinutes("09:29"), MIDDAY, toMinutes("23:58"), 1439];
    for (const end of ends) {
      for (const now of nows) {
        expect(hasLessonEnded(TODAY, TODAY, end, now)).toBe(
          hasEndedInSg(end, now)
        );
      }
    }
  });

  it("reads no clock — the same inputs always give the same answer", () => {
    const a = hasLessonEnded("2026-08-09", TODAY, "09:00", MIDDAY);
    const b = hasLessonEnded("2026-08-09", TODAY, "09:00", MIDDAY);
    expect(a).toBe(b);
    expect(a).toBe(false);
  });
});
