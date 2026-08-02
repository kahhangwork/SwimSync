import { buildPayNowPayload, crc16, selectPayNowProxy } from "./paynow";

// ⚠ RISK 2: the expected strings below come from INDEPENDENT sources, never
// from this lib's own output — a self-generated expectation proves nothing.

describe("crc16", () => {
  it("matches the canonical CRC-16/CCITT-FALSE check vector", () => {
    // The standard check input for this CRC family; expected value 0x29B1 is
    // published in every CRC catalogue (e.g. reveng's CRC-16/CCITT-FALSE).
    expect(crc16("123456789")).toBe("29B1");
  });
});

describe("buildPayNowPayload", () => {
  it("reproduces the VirgilZhao/paynow published example byte-for-byte", () => {
    // https://github.com/VirgilZhao/paynow README: UEN "12345678",
    // not editable, expiry 20260304, "testcompany", 0.99,
    // ref "testordernumber12345678" — full expected output incl. CRC 0047.
    expect(
      buildPayNowPayload({
        proxyType: "uen",
        proxyValue: "12345678",
        amount: 0.99,
        merchantName: "testcompany",
        reference: "testordernumber12345678",
        expiry: "20260304",
      }),
    ).toBe(
      "00020101021226470009SG.PAYNOW01012020812345678030100408202603045204" +
        "0000530370254040.995802SG5911testcompany6009Singapore6227012" +
        "3testordernumber1234567863040047",
    );
  });

  it("encodes a mobile proxy as +65 with type 0, amount locked", () => {
    const p = buildPayNowPayload({
      proxyType: "mobile",
      proxyValue: "91234567",
      amount: 300,
      merchantName: "Swim School",
      reference: "INV-2026-0001",
    });
    // Tag 26 sub-fields: SG.PAYNOW, type 0, +65 number, editable 0.
    expect(p).toContain("0009SG.PAYNOW");
    expect(p).toContain("01010");
    expect(p).toContain("0211+6591234567");
    expect(p).toContain("03010"); // sub-tag 03, len 01, "0" — not editable
    // Amount is two-decimal fixed; reference rides in Tag 62 sub-01.
    expect(p).toContain("5406300.00");
    expect(p).toContain("62170113INV-2026-0001");
    // CRC self-consistency: last 4 chars re-derive from everything before them.
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it("formats amounts to exactly two decimals", () => {
    const p = buildPayNowPayload({
      proxyType: "mobile",
      proxyValue: "91234567",
      amount: 25.5,
      merchantName: "X",
      reference: "R",
    });
    expect(p).toContain("540525.50");
  });

  // ⚠ The refusals are the feature: a wrong-but-valid QR pays the wrong
  // amount silently, so anything dubious throws instead of encoding.
  it.each([0, -5, NaN, Infinity])("refuses amount %p", (amount) => {
    expect(() =>
      buildPayNowPayload({
        proxyType: "mobile",
        proxyValue: "91234567",
        amount,
        merchantName: "X",
        reference: "R",
      }),
    ).toThrow(/refusing amount/);
  });

  it.each(["1234567", "912345678", "9123456a", "+6591234567"])(
    "refuses malformed mobile proxy %p (stored form is 8 bare digits)",
    (proxyValue) => {
      expect(() =>
        buildPayNowPayload({
          proxyType: "mobile",
          proxyValue,
          amount: 10,
          merchantName: "X",
          reference: "R",
        }),
      ).toThrow(/8 digits/);
    },
  );

  it("refuses a blank UEN, a blank name, and an over-long reference", () => {
    const base = {
      proxyType: "uen" as const,
      proxyValue: "201403121W",
      amount: 10,
      merchantName: "X",
      reference: "R",
    };
    expect(() =>
      buildPayNowPayload({ ...base, proxyValue: "  " }),
    ).toThrow(/blank UEN/);
    expect(() =>
      buildPayNowPayload({ ...base, merchantName: "  " }),
    ).toThrow(/blank merchant name/);
    expect(() =>
      buildPayNowPayload({ ...base, reference: "X".repeat(26) }),
    ).toThrow(/1-25 chars/);
  });
});

describe("selectPayNowProxy", () => {
  it("prefers UEN over mobile — corporate statements carry the reference", () => {
    expect(
      selectPayNowProxy({ paynow_uen: "201403121W", paynow_mobile: "91234567" }),
    ).toEqual({ type: "uen", value: "201403121W" });
  });

  it("falls back to mobile, treats blanks as absent, and returns null when unconfigured", () => {
    expect(
      selectPayNowProxy({ paynow_uen: "  ", paynow_mobile: "91234567" }),
    ).toEqual({ type: "mobile", value: "91234567" });
    expect(selectPayNowProxy({ paynow_uen: null, paynow_mobile: null })).toBeNull();
    expect(selectPayNowProxy({ paynow_uen: "", paynow_mobile: "  " })).toBeNull();
  });
});
