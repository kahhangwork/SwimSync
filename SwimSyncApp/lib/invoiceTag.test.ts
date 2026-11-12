import { dayMonthLabel, dueLine, invoiceTag, nextSgDay } from "./invoiceTag";

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
  it("formats a calendar date with no Date object", () => {
    expect(dayMonthLabel("2026-11-26")).toBe("26 Nov");
    expect(dayMonthLabel("2027-01-01")).toBe("1 Jan");
  });
  it("returns malformed input unchanged", () => {
    expect(dayMonthLabel("soon")).toBe("soon");
    expect(dayMonthLabel("2026-13-01")).toBe("2026-13-01");
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

describe("dueLine — the parent's due line follows invoiceTag (D4)", () => {
  const base = { status: "outstanding", paid_claimed_at: null, is_overdue: false, due_date: "2026-11-26" };
  it("outstanding → 'Due 26 Nov'", () => {
    expect(dueLine(base)).toEqual({ text: "Due 26 Nov", overdue: false });
  });
  it("overdue → 'Overdue — was due 26 Nov'", () => {
    expect(dueLine({ ...base, is_overdue: true })).toEqual({ text: "Overdue — was due 26 Nov", overdue: true });
  });
  it("claimed and overdue → reads as Due, never Overdue", () => {
    expect(dueLine({ ...base, is_overdue: true, paid_claimed_at: "2026-11-27T02:00:00Z" })).toEqual({
      text: "Due 26 Nov",
      overdue: false,
    });
  });
  it("paid → no line", () => {
    expect(dueLine({ ...base, status: "paid", is_overdue: true })).toBeNull();
  });
});
