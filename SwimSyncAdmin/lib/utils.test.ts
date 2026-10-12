import { describe, it, expect } from "vitest";
import config from "../tailwind.config";
import { cn } from "./utils";

// cn() runs tailwind-merge, which drops the earlier of two classes it believes
// conflict. It does not know DESIGN.md's token names, so out of the box it read
// `text-body` as a COLOUR and deleted it beside `text-ink` (§7.372). The token
// names are read from the config, so a new token missing from utils.ts goes red.
//
// MUTATION PROOF (§7.25): replace utils.ts's extendTailwindMerge(...) with plain
// `twMerge` → RED on 9 of 11: every "survives beside a text colour", every
// "is a radius", and "shadow-float is a shadow" (run 2026-10-12).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ext = (config as any).theme.extend;
const sizes = Object.keys(ext.fontSize);
const radii = Object.keys(ext.borderRadius);

describe("cn() keeps DESIGN.md token classes", () => {
  it("found the tokens (guards a silent zero-row pass)", () => {
    expect(sizes.length).toBeGreaterThanOrEqual(5);
    expect(radii.length).toBe(3);
  });

  it.each(sizes)("text-%s survives beside a text colour", (s) => {
    expect(cn(`text-${s}`, "text-ink")).toBe(`text-${s} text-ink`);
    expect(cn(`text-${s}`, "text-status-danger-text")).toBe(`text-${s} text-status-danger-text`);
  });

  it("a later type size still overrides an earlier one", () => {
    expect(cn("text-body", "text-label")).toBe("text-label");
  });

  it.each(radii)("rounded-%s is a radius: a later radius replaces it", (r) => {
    expect(cn(`rounded-${r}`, "rounded-none")).toBe("rounded-none");
  });

  it("shadow-float is a shadow", () => {
    expect(cn("shadow-sm", "shadow-float")).toBe("shadow-float");
  });
});
