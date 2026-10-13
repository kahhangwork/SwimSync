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

// UI restyle 5.11 (plan ⚠ RISK 9): the calendar changed how a class colour is
// APPLIED (a 1px border + tint, no `border-l-4` side tab) — never the palette.
// MUTATION PROOF (§7.25): giving "teal" sky's `card` string → RED on "every
// swatch's card and dot are distinct".
describe("CLASS_COLOURS after the UI restyle (RISK 9)", () => {
  it("every swatch's card and dot are distinct — no two classes look alike", () => {
    expect(new Set(CLASS_COLOURS.map((c) => c.card)).size).toBe(CLASS_COLOURS.length);
    expect(new Set(CLASS_COLOURS.map((c) => c.dot)).size).toBe(CLASS_COLOURS.length);
  });

  it("every key stored on production resolves to a real (non-neutral) swatch", () => {
    // `select distinct colour from classes` via scripts/prod-query-ro.sh, 2026-10-14:
    // lime, sky, violet (and NULL, which is "no colour" by design).
    for (const key of ["lime", "sky", "violet"]) {
      expect(colourFor(key)).not.toBe(NEUTRAL_COLOUR);
    }
  });
});
