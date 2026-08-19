import { describe, it, expect } from "vitest";
import {
  CLASS_COLOURS,
  NEUTRAL_COLOUR,
  colourFor,
  isKnownColourKey,
} from "./classColours";

describe("CLASS_COLOURS palette", () => {
  it("has twelve distinct keys that satisfy the DB CHECK (^[a-z]{3,12}$)", () => {
    expect(CLASS_COLOURS).toHaveLength(12);
    const keys = CLASS_COLOURS.map((c) => c.key);
    expect(new Set(keys).size).toBe(12);
    for (const k of keys) expect(k).toMatch(/^[a-z]{3,12}$/);
  });

  it("gives every swatch a background, a border and a text class", () => {
    for (const c of [...CLASS_COLOURS, NEUTRAL_COLOUR]) {
      expect(c.card).toMatch(/\bbg-[a-z]+-\d+\b/);
      expect(c.card).toMatch(/\bborder-[a-z]+-\d+\b/);
      expect(c.card).toMatch(/\btext-[a-z]+-\d+\b/);
      expect(c.dot).toMatch(/^bg-[a-z]+-\d+$/);
      expect(c.ring).toMatch(/^ring-[a-z]+-\d+$/);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it("never uses a text shade lighter than 800 on a 100 background (readability)", () => {
    for (const c of CLASS_COLOURS) {
      const text = /\btext-[a-z]+-(\d+)\b/.exec(c.card)![1];
      expect(Number(text)).toBeGreaterThanOrEqual(800);
      expect(c.card).toMatch(/\bbg-[a-z]+-100\b/);
    }
  });
});

describe("colourFor", () => {
  it("resolves a known key", () => {
    expect(colourFor("rose").key).toBe("rose");
  });

  it("falls back to NEUTRAL for null, undefined, empty and unknown keys — never undefined", () => {
    expect(colourFor(null)).toBe(NEUTRAL_COLOUR);
    expect(colourFor(undefined)).toBe(NEUTRAL_COLOUR);
    expect(colourFor("")).toBe(NEUTRAL_COLOUR);
    expect(colourFor("retired-palette-key")).toBe(NEUTRAL_COLOUR);
  });

  it("isKnownColourKey mirrors the palette", () => {
    expect(isKnownColourKey("sky")).toBe(true);
    expect(isKnownColourKey("neutral")).toBe(false);
    expect(isKnownColourKey("#ff0000")).toBe(false);
  });
});
