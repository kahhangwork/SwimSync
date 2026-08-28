// skillProgress.ts exists in TWO copies and they must stay byte-identical.
// Added 20260829000100, when grading moved from the coach app to the admin
// panel's Assessment tab and the admin needed the same pure helpers the coach
// screen had been using since 20260828000100.
//
// The copies are deliberate (`docs/ARCHITECTURE.md` §6): separate npm projects, no
// workspace, different bundlers. The file has zero imports precisely so the
// duplication is cheap.
//
// WHAT IS NOT CHEAP IS THE FAILURE MODE, and it is quieter here than for the
// other twins. This file owns `summariseSkillProgress`, whose `done` flag is
// "this grade holds the TOP rank of the scale" — computed, never stored, so
// that adding a higher grade retroactively re-opens every skill that was done
// at the old top (the rule the migration's own header calls load-bearing).
//
// The coach app RENDERS that flag and the admin panel now DECIDES on it: the
// Assessment tab offers "Move up a level" only when every skill is done. So a
// drift in the done rule would not throw and would not look wrong on either
// screen — it would promote children who had not finished, or withhold a
// promotion from children who had, while the coach's copy of the same screen
// showed the opposite. There is no server-side guard for this one; unlike
// studentStatus.ts, no RPC refuses a disagreement. This test is the only thing
// standing between the two copies.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This file lives in SwimSyncAdmin/lib, so the repo root is two levels up.
const ROOT = join(__dirname, "..", "..");

const COPIES = [
  "SwimSyncAdmin/lib/skillProgress.ts",
  "SwimSyncApp/lib/skillProgress.ts",
];

describe("skillProgress.ts is byte-identical across both copies", () => {
  const [reference, ...others] = COPIES;
  const referenceText = readFileSync(join(ROOT, reference), "utf8");

  for (const copy of others) {
    it(`${copy} matches ${reference}`, () => {
      const text = readFileSync(join(ROOT, copy), "utf8");
      expect(
        text,
        `${copy} has drifted from ${reference}. This file decides when a skill ` +
          `counts as "done" — the admin panel promotes a child to the next ` +
          `level off that answer, and the coach app renders it. Nothing on the ` +
          `server reconciles a disagreement. Copy the corrected version over ` +
          `both; do not patch them independently.`
      ).toBe(referenceText);
    });
  }

  // Guards the guard: if the paths above ever go stale, the comparison would
  // compare a file against itself and pass forever.
  it("is actually reading two distinct, non-empty files", () => {
    expect(new Set(COPIES).size).toBe(2);
    for (const copy of COPIES) {
      expect(readFileSync(join(ROOT, copy), "utf8").length).toBeGreaterThan(500);
    }
  });
});
