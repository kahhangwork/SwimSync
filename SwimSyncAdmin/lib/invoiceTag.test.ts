import { describe, expect, it } from "vitest";
import { dayMonthLabel, invoiceTag, nextSgDay } from "./invoiceTag";

describe("invoiceTag — D4: Paid > Claimed > Overdue > Outstanding", () => {
  const cases: [string, string | null, boolean | null, string][] = [
    ["paid", null, false, "Paid"],
    ["paid", null, true, "Paid"],
    ["paid", "2026-11-20T02:00:00Z", true, "Paid"],
    ["outstanding", "2026-11-20T02:00:00Z", true, "Claimed"],
    ["outstanding", "2026-11-20T02:00:00Z", false, "Claimed"],
    ["outstanding", null, true, "Overdue"],
    ["outstanding", null, false, "Outstanding"],
    ["outstanding", null, null, "Outstanding"],
  ];
  it.each(cases)("status=%s claimed=%s overdue=%s → %s", (status, claimed, overdue, tag) => {
    expect(invoiceTag({ status, paid_claimed_at: claimed, is_overdue: overdue })).toBe(tag);
  });
});

describe("dayMonthLabel", () => {
  it("formats a calendar date, day and short month", () => {
    expect(dayMonthLabel("2026-11-26")).toBe("26 Nov");
    expect(dayMonthLabel("2027-01-01")).toBe("1 Jan");
  });
  it("speaks en-SG like every other screen — September is 'Sept'", () => {
    expect(dayMonthLabel("2026-09-03")).toBe("3 Sept");
  });
  it("returns malformed input unchanged", () => {
    expect(dayMonthLabel("soon")).toBe("soon");
  });
});

describe("nextSgDay", () => {
  it("crosses month, year and leap-day ends", () => {
    expect(nextSgDay("2026-11-26")).toBe("2026-11-27");
    expect(nextSgDay("2026-11-30")).toBe("2026-12-01");
    expect(nextSgDay("2026-12-31")).toBe("2027-01-01");
    expect(nextSgDay("2028-02-28")).toBe("2028-02-29");
    expect(nextSgDay("2027-02-28")).toBe("2027-03-01");
  });
  it("returns malformed input unchanged", () => {
    expect(nextSgDay("")).toBe("");
  });
});
