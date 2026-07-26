import { describe, it, expect } from "vitest";
import {
  normalizeSgPhone,
  checkSgPhone,
  checkEmail,
  blankToNull,
} from "./sgPhone";

describe("normalizeSgPhone", () => {
  it("strips the punctuation people actually type", () => {
    expect(normalizeSgPhone("9123 4567")).toBe("91234567");
    expect(normalizeSgPhone("+65 9123-4567")).toBe("91234567");
    expect(normalizeSgPhone("(65) 9123 4567")).toBe("91234567");
    expect(normalizeSgPhone("0065 9123 4567")).toBe("91234567");
  });

  // The regression the length gate exists for: a landline whose own first two
  // digits are the country code. Stripping unconditionally leaves "123456".
  it("does NOT strip a leading 65 from an 8-digit local number", () => {
    expect(normalizeSgPhone("6512 3456")).toBe("65123456");
  });

  it("survives empty and nullish input", () => {
    expect(normalizeSgPhone("")).toBe("");
    expect(normalizeSgPhone(null)).toBe("");
    expect(normalizeSgPhone(undefined)).toBe("");
  });
});

describe("checkSgPhone", () => {
  it("accepts a mobile, however it is written", () => {
    expect(checkSgPhone("91234567").level).toBe("ok");
    expect(checkSgPhone("8123 4567").level).toBe("ok");
    expect(checkSgPhone("+65 9123 4567").level).toBe("ok");
  });

  it("says nothing about a blank — clearing a number is a real correction", () => {
    expect(checkSgPhone("").level).toBe("ok");
    expect(checkSgPhone("   ").level).toBe("ok");
    expect(checkSgPhone(null).level).toBe("ok");
    expect(checkSgPhone("")).not.toHaveProperty("message");
  });

  // THE PRODUCTION CASE. A real child carries `964`; normalize_phone() refuses
  // it, so that child cannot be matched by phone and nobody was ever told.
  it("warns that a too-short number cannot match at all", () => {
    const r = checkSgPhone("964");
    expect(r.level).toBe("warn");
    expect(r.message).toMatch(/match/i);
  });

  it("warns when the number is not 8 digits, and says how many it has", () => {
    const r = checkSgPhone("912345678");
    expect(r.level).toBe("warn");
    expect(r.message).toContain("9");
  });

  it("notes a landline or VoIP number rather than warning about it", () => {
    expect(checkSgPhone("61234567").level).toBe("note");
    expect(checkSgPhone("31234567").level).toBe("note");
  });

  // Eight digits, so the DATABASE would happily match on it — which is exactly
  // why the warning is worth having: it is not a Singapore number.
  it("warns on 8 digits with a prefix the numbering plan does not use", () => {
    expect(checkSgPhone("12345678").level).toBe("warn");
    expect(checkSgPhone("71234567").level).toBe("warn");
  });
});

describe("checkEmail", () => {
  it("accepts an ordinary address and ignores a blank", () => {
    expect(checkEmail("sarah@example.com").level).toBe("ok");
    expect(checkEmail("sarah.lim+swim@example.co.uk").level).toBe("ok");
    expect(checkEmail("").level).toBe("ok");
    expect(checkEmail(null).level).toBe("ok");
  });

  it("warns on the mistakes people actually make", () => {
    expect(checkEmail("sarah.example.com").level).toBe("warn");
    expect(checkEmail("sarah@example").level).toBe("warn");
    expect(checkEmail("sarah @example.com").level).toBe("warn");
  });
});

describe("blankToNull", () => {
  it("matches the creation path's NULLIF(trim(...), '')", () => {
    expect(blankToNull("  Sarah Lim ")).toBe("Sarah Lim");
    expect(blankToNull("")).toBeNull();
    expect(blankToNull("   ")).toBeNull();
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
  });
});
