import { usageLines, usageToggleLabel, type PackageUsageRow } from "./packageUsage";

// D3: the parent sees what the package paid for. Load-bearing:
//   • legacy invoice-time rows are lines too (history complete, RISK 12);
//   • a returned lesson is LABELLED, not hidden, and not counted as used;
//   • a re-draw after a return is its own line (distinct key);
//   • the date is the SGT lesson date as given, never shifted by the viewer's zone.

const ROW = (over: Partial<PackageUsageRow> = {}): PackageUsageRow => ({
  lesson_date: "2026-10-03",
  student_id: "s1",
  student_name: "Ava",
  class_title: "Dolphins Fri 4pm",
  amount: "35.00",
  source: "marking",
  applied_at: "2026-10-03T09:00:00+00:00",
  reversed_at: null,
  ...over,
});

describe("usageLines", () => {
  it("a marking-time draw: date, child · class, amount", () => {
    expect(usageLines([ROW()])[0]).toMatchObject({
      date: "3 Oct 2026",
      who: "Ava · Dolphins Fri 4pm",
      amount: "S$35.00",
      returned: false,
      note: null,
    });
  });

  it("a legacy invoice-time row is listed, noted as on an invoice", () => {
    expect(usageLines([ROW({ source: "invoice" })])[0].note).toBe("On a monthly invoice");
  });

  it("a returned lesson stays listed and is labelled returned", () => {
    const [line] = usageLines([ROW({ reversed_at: "2026-10-04T01:00:00+00:00" })]);
    expect(line.returned).toBe(true);
  });

  it("a re-draw after a return is a second line with its own key", () => {
    const lines = usageLines([
      ROW({ applied_at: "2026-10-05T01:00:00+00:00" }),
      ROW({ reversed_at: "2026-10-04T01:00:00+00:00" }),
    ]);
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l) => l.key)).size).toBe(2);
  });
});

describe("usageToggleLabel", () => {
  it("counts only lessons the package is still paying for", () => {
    const rows = [ROW(), ROW({ student_id: "s2" }), ROW({ student_id: "s3", reversed_at: "2026-10-04T00:00:00Z" })];
    expect(usageToggleLabel(false, rows)).toBe("Show lessons used (2)");
    expect(usageToggleLabel(false, null)).toBe("Show lessons used");
    expect(usageToggleLabel(true, rows)).toBe("Hide lessons used");
  });
});
