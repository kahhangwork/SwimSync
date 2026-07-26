// attendanceCompleteness.ts exists in THREE copies and they must stay
// byte-identical. This test is why that is enforced rather than remembered.
//
// The copies are deliberate (HANDOVER §6): separate npm projects, no workspace,
// different bundlers, and no npm resolution at all inside an Edge Function. The
// file has zero imports precisely so the duplication is cheap.
//
// What is NOT cheap is the failure mode. This file defines whether invoices may
// be generated (PRD §7.7). §7.18 is what happened the last time these
// implementations drifted: the engine's gate could not see a lesson nobody had
// touched, the month sealed with that lesson permanently unbilled, and the only
// effective check was the client's. A live underbill, found months later.
//
// A comment saying "edit all three" does not survive the person who has not
// read it. A failing test does.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This file lives in SwimSyncAdmin/lib, so the repo root is two levels up.
const ROOT = join(__dirname, "..", "..");

const COPIES = [
  "SwimSyncAdmin/lib/attendanceCompleteness.ts",
  "SwimSyncApp/lib/attendanceCompleteness.ts",
  "supabase/functions/generate-invoices/attendanceCompleteness.ts",
];

describe("attendanceCompleteness.ts is byte-identical across all three copies", () => {
  const [reference, ...others] = COPIES;
  const referenceText = readFileSync(join(ROOT, reference), "utf8");

  for (const copy of others) {
    it(`${copy} matches ${reference}`, () => {
      const text = readFileSync(join(ROOT, copy), "utf8");
      expect(
        text,
        `${copy} has drifted from ${reference}. This file decides whether ` +
          `invoices may be generated — three copies that disagree is one ` +
          `implementation and two liabilities (§7.18). Copy the corrected ` +
          `version over all three; do not patch them independently.`
      ).toBe(referenceText);
    });
  }

  // Guards the guard: if the paths above ever go stale, every comparison
  // above would compare a file against itself and pass forever.
  it("is actually reading three distinct, non-empty files", () => {
    expect(new Set(COPIES).size).toBe(3);
    for (const copy of COPIES) {
      expect(readFileSync(join(ROOT, copy), "utf8").length).toBeGreaterThan(500);
    }
  });
});
