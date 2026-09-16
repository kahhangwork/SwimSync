import { describe, it, expect } from "vitest";
import { parseHolidaysCsv } from "./holidaysCsv";

describe("parseHolidaysCsv", () => {
  it("parses the data.gov.sg format (date,day,holiday), ignoring the day column", () => {
    const csv = [
      "date,day,holiday",
      "2026-01-01,Thursday,New Year's Day",
      "2026-02-17,Tuesday,Chinese New Year",
    ].join("\n");
    const { holidays, errors } = parseHolidaysCsv(csv);
    expect(errors).toEqual([]);
    expect(holidays).toEqual([
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-02-17", name: "Chinese New Year" },
    ]);
  });

  it("keeps the date string verbatim — no timezone reformatting (§7.7)", () => {
    // A date that a UTC round-trip would shift a day either way.
    const { holidays } = parseHolidaysCsv("date,day,holiday\n2026-12-31,Thursday,New Year's Eve");
    expect(holidays[0].date).toBe("2026-12-31");
  });

  it("rejects a malformed date with a per-row error, not a silent skip", () => {
    const csv = [
      "date,day,holiday",
      "2026-01-01,Thursday,Good",
      "01/02/2026,Monday,Bad Format",
      "2026-02-30,X,Shape-valid but not a real date",
    ].join("\n");
    const { holidays, errors } = parseHolidaysCsv(csv);
    expect(holidays.map((h) => h.date)).toEqual(["2026-01-01"]);
    expect(errors.some((e) => e.includes("01/02/2026"))).toBe(true);
    expect(errors.some((e) => e.includes("2026-02-30"))).toBe(true);
  });

  it("honours quoted fields containing commas", () => {
    const csv = 'date,day,holiday\n2026-05-01,Friday,"Labour Day, observed"';
    const { holidays } = parseHolidaysCsv(csv);
    expect(holidays[0]).toEqual({ date: "2026-05-01", name: "Labour Day, observed" });
  });

  it("dedupes on date (first wins)", () => {
    const csv = [
      "date,day,holiday",
      "2026-08-09,Sunday,National Day",
      "2026-08-09,Sunday,National Day (dup)",
    ].join("\n");
    const { holidays } = parseHolidaysCsv(csv);
    expect(holidays).toHaveLength(1);
    expect(holidays[0].name).toBe("National Day");
  });

  it("works without a header row (assumes date,day,holiday)", () => {
    const { holidays } = parseHolidaysCsv("2026-01-01,Thursday,New Year's Day");
    expect(holidays).toEqual([{ date: "2026-01-01", name: "New Year's Day" }]);
  });

  it("reports an empty file", () => {
    const { holidays, errors } = parseHolidaysCsv("   \n  \n");
    expect(holidays).toEqual([]);
    expect(errors).toEqual(["The file is empty."]);
  });
});
