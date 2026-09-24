import { describe, expect, it } from "vitest";
import { parseCount } from "./lowSettings";

describe("parseCount", () => {
  it("saves a whole number, zero included", () => {
    expect(parseCount("2")).toBe(2);
    expect(parseCount("0")).toBe(0);
    expect(parseCount(" 14 ")).toBe(14);
  });
  it("refuses an EMPTY field rather than saving 0 (§7.22)", () => {
    expect(parseCount("")).toBeNull();
    expect(parseCount("   ")).toBeNull();
  });
  it("refuses negatives, fractions and text", () => {
    expect(parseCount("-1")).toBeNull();
    expect(parseCount("1.5")).toBeNull();
    expect(parseCount("two")).toBeNull();
  });
});
