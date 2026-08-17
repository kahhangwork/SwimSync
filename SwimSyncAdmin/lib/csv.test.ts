import { describe, it, expect, vi, beforeEach } from "vitest";
import { toCsv, exportCsv, isTruncated, CSV_DEFAULT_CAP, type CsvColumn } from "./csv";

type Row = { name: string; amount: number | null };
const cols: CsvColumn<Row>[] = [
  { header: "Name", value: (r) => r.name },
  { header: "Amount", value: (r) => r.amount },
];

describe("toCsv — quoting", () => {
  it("quotes fields containing commas, quotes, or newlines and doubles inner quotes", () => {
    const csv = toCsv(
      [{ name: 'Tan, Jr "TJ"', amount: 30 }, { name: "line1\nline2", amount: null }],
      cols,
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Name,Amount");
    // comma AND embedded quote → whole field quoted, inner " doubled
    expect(lines[1]).toBe('"Tan, Jr ""TJ""",30');
    // newline forces quoting; the record spans the physical break
    expect(csv).toContain('"line1\nline2",');
    // null renders as empty, not the string "null"
    expect(csv.endsWith(',')).toBe(true);
  });

  it("leaves a plain field unquoted", () => {
    expect(toCsv([{ name: "Ethan", amount: 30 }], cols)).toBe("Name,Amount\r\nEthan,30");
  });
});

describe("toCsv — formula-injection guard (⚠ RISK 3)", () => {
  // A parent-entered name like =HYPERLINK(...) executes when the admin opens the
  // file in Excel. Quoting does NOT stop it — a leading ' does.
  it.each(["=1+1", "+1", "-1", "@x", "\tx", "\rx"])(
    "prefixes a field starting with %j with a single quote",
    (bad) => {
      const csv = toCsv([{ name: bad, amount: 1 }], cols);
      const field = csv.split("\r\n")[1].split(",")[0];
      // may be wrapped in quotes if it also had a comma/newline, but must begin with '
      expect(field.replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("neutralises =1+1 to '=1+1 exactly", () => {
    expect(toCsv([{ name: "=1+1", amount: 1 }], cols)).toBe("Name,Amount\r\n'=1+1,1");
  });

  it("does NOT guard a numeric negative — a number cannot be a formula, and Excel must keep it numeric", () => {
    // -5 is a number, not text: it stays -5 so an accountant can sum the column.
    expect(toCsv([{ name: "Ethan", amount: -5 }], cols)).toBe("Name,Amount\r\nEthan,-5");
    // but the STRING "-1" (e.g. a hand-typed cell) is guarded
    const stringy: CsvColumn<{ v: string }>[] = [{ header: "V", value: (r) => r.v }];
    expect(toCsv([{ v: "-1+1" }], stringy)).toBe("V\r\n'-1+1");
  });
});

describe("isTruncated / exportCsv — silent-truncation block (⚠ RISK 2)", () => {
  it("flags a row count at or above the cap", () => {
    expect(isTruncated(CSV_DEFAULT_CAP)).toBe(true);
    expect(isTruncated(CSV_DEFAULT_CAP - 1)).toBe(false);
    expect(isTruncated(50, 50)).toBe(true);
  });

  it("REFUSES to emit a capped file and never touches the DOM", () => {
    const spy = vi.spyOn(URL, "createObjectURL");
    const rows = Array.from({ length: CSV_DEFAULT_CAP }, () => ({ name: "x", amount: 1 }));
    const res = exportCsv("invoices.csv", rows, cols);
    expect(res).toEqual({ ok: false, truncated: true, cap: CSV_DEFAULT_CAP });
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocks on the SOURCE fetch count, not the filtered rows — a capped fetch filtered to a few rows still refuses", () => {
    const spy = vi.spyOn(URL, "createObjectURL");
    // 3 rows on screen, but they were filtered from a fetch that hit the cap.
    const filtered = [
      { name: "a", amount: 1 },
      { name: "b", amount: 2 },
      { name: "c", amount: 3 },
    ];
    const res = exportCsv("invoices.csv", filtered, cols, {
      sourceCount: CSV_DEFAULT_CAP,
    });
    expect(res).toEqual({ ok: false, truncated: true, cap: CSV_DEFAULT_CAP });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("exportCsv — happy path triggers a download", () => {
  beforeEach(() => {
    // jsdom implements neither; stub so the anchor-click path is exercisable
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(
      () => "blob:x",
    );
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  });

  it("returns ok and prepends a UTF-8 BOM to the blob", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const blobSpy = vi.spyOn(URL, "createObjectURL");
    const res = exportCsv("invoices.csv", [{ name: "Ethan", amount: 30 }], cols);
    expect(res).toEqual({ ok: true });
    expect(clickSpy).toHaveBeenCalledOnce();
    const blob = blobSpy.mock.calls[0][0] as Blob;
    expect(blob.type).toContain("text/csv");
    // BOM check — read raw bytes; `.text()` UTF-8-decodes and strips the BOM, so
    // assert the encoded EF BB BF prefix instead.
    return blob.arrayBuffer().then((buf) => {
      const b = new Uint8Array(buf);
      expect([b[0], b[1], b[2]]).toEqual([0xef, 0xbb, 0xbf]);
    });
  });
});
