import { describe, it, expect } from "vitest";
import {
  bucketStart,
  droppedDates,
  needsStartConfirmation,
  parseBounds,
  startWarnings,
  todayOnly,
  type StartBounds,
} from "./enrolmentStart";

// "Starts on" — the pure half (WAVE4_START_DATE_FRONT_DESK_PLAN.md §1.4).
// Fixed dates: these functions take `today` from their input and read no clock.
// 2026-10-05 is a Monday; the class runs on Mondays.
//
// MUTATION PROOFS (§7.25) — recorded in the commit body.

const B = (over: Partial<StartBounds> = {}): StartBounds => ({
  floor: "2026-08-03",
  today: "2026-10-05",
  lastSealedMonth: null,
  dayOfWeek: "monday",
  ...over,
});

describe("parseBounds (RISK 14 — fail safe to today only)", () => {
  it("reads a well-formed payload", () => {
    expect(
      parseBounds(
        { floor: "2026-09-01", today: "2026-10-05", last_sealed_month: "2026-09", day_of_week: "monday" },
        "2026-10-05"
      )
    ).toEqual({ floor: "2026-09-01", today: "2026-10-05", lastSealedMonth: "2026-09", dayOfWeek: "monday" });
  });

  it.each([
    ["null", null],
    ["an error-shaped object", { message: "permission denied" }],
    ["a malformed floor", { floor: "Sept 1", today: "2026-10-05" }],
    ["a floor after today", { floor: "2026-10-06", today: "2026-10-05" }],
  ])("degrades to today only on %s", (_l, raw) => {
    expect(parseBounds(raw, "2026-10-05")).toEqual(todayOnly("2026-10-05"));
  });

  it("drops an unknown weekday rather than trusting it", () => {
    expect(
      parseBounds({ floor: "2026-09-01", today: "2026-10-05", day_of_week: "funday" }, "2026-10-05").dayOfWeek
    ).toBeNull();
  });
});

describe("bucketStart — RISK 1: every past month, not only sealed ones", () => {
  it("today creates no earlier lessons", () => {
    expect(bucketStart(B(), "2026-10-05")).toEqual({ sealed: [], unbilled: [], current: [] });
  });

  it("a start earlier this month → current only", () => {
    expect(bucketStart(B(), "2026-10-01").current).toEqual([]); // no Monday between 1 and 5 Oct, exclusive of today
    expect(bucketStart(B({ today: "2026-10-13" }), "2026-10-05").current).toEqual(["2026-10-05", "2026-10-12"]);
  });

  it("a never-billed business: September is UNBILLED, not sealed", () => {
    const b = bucketStart(B(), "2026-09-14");
    expect(b.sealed).toEqual([]);
    expect(b.unbilled).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  it("splits at the sealed boundary: the last day of the sealed month vs the 1st of the next", () => {
    const b = bucketStart(B({ lastSealedMonth: "2026-08", floor: "2026-08-03" }), "2026-08-31");
    expect(b.sealed).toEqual(["2026-08-31"]);
    expect(b.unbilled).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  it("splits at the month boundary: the last Monday of last month vs this month", () => {
    const b = bucketStart(B({ today: "2026-10-13" }), "2026-09-28");
    expect(b.unbilled).toEqual(["2026-09-28"]);
    expect(b.current).toEqual(["2026-10-05", "2026-10-12"]);
  });

  it("with no weekday (the fallback) there is nothing to warn about", () => {
    expect(bucketStart(B({ dayOfWeek: null }), "2026-09-14")).toEqual({ sealed: [], unbilled: [], current: [] });
  });
});

describe("startWarnings", () => {
  it("names the sealed month and sends the owner, not the Invoices page (RISK 16)", () => {
    const w = startWarnings(B({ lastSealedMonth: "2026-09", floor: "2026-09-01" }), "2026-09-21", "Kai");
    expect(w).toHaveLength(1);
    expect(w[0].tone).toBe("sealed");
    expect(w[0].text).toContain("September is already billed. 2 lessons");
    expect(w[0].text).toContain("business owner");
    expect(w[0].text).not.toContain("Invoices page");
  });

  it("an unbilled earlier month says what it blocks", () => {
    const w = startWarnings(B(), "2026-09-28", "Kai");
    expect(w.map((x) => x.tone)).toEqual(["unbilled"]);
    expect(w[0].text).toContain("Kai will be expected at 1 lesson in September, which hasn't been billed");
    expect(w[0].text).toContain("before September can be billed");
  });

  it("agrees with the number of MONTHS, not lessons", () => {
    const w = startWarnings(B({ lastSealedMonth: "2026-09", floor: "2026-08-03" }), "2026-08-24", "Kai");
    expect(w[0].text).toContain("August, September are already billed. 6 lessons");
  });

  it("orders sealed, then unbilled, then quiet", () => {
    const w = startWarnings(B({ today: "2026-10-13", lastSealedMonth: "2026-08" }), "2026-08-31", "Kai");
    expect(w.map((x) => x.tone)).toEqual(["sealed", "unbilled", "quiet"]);
  });
});

describe("needsStartConfirmation — a second press for an unbilled earlier month", () => {
  it("first press on an unbilled month → hold", () => {
    expect(needsStartConfirmation(B(), "2026-09-28", false)).toBe(true);
  });
  it("second press → go", () => {
    expect(needsStartConfirmation(B(), "2026-09-28", true)).toBe(false);
  });
  it("a sealed-only or this-month start never needs it", () => {
    expect(needsStartConfirmation(B({ lastSealedMonth: "2026-09" }), "2026-09-28", false)).toBe(false);
    expect(needsStartConfirmation(B({ today: "2026-10-13" }), "2026-10-05", false)).toBe(false);
  });
});

describe("droppedDates — RISK 6", () => {
  it("a LATER start lists the lessons it stops expecting, excluding the new start", () => {
    expect(droppedDates("monday", "2026-09-14", "2026-09-28")).toEqual(["2026-09-14", "2026-09-21"]);
  });
  it("an earlier or equal start drops nothing", () => {
    expect(droppedDates("monday", "2026-09-28", "2026-09-14")).toEqual([]);
    expect(droppedDates("monday", "2026-09-28", "2026-09-28")).toEqual([]);
  });
});
