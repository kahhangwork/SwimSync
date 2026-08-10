// studentStatus.ts exists in TWO copies and they must stay byte-identical.
// Added in Wave 2 (20260811000100), when the file's own "EDIT BOTH" comment was
// the only thing holding it together — and that comment is exactly the kind of
// protection that does not survive the person who has not read it.
//
// The copies are deliberate (`docs/ARCHITECTURE.md` §6): separate npm projects, no
// workspace, different bundlers. The file has zero imports precisely so the
// duplication is cheap.
//
// What is NOT cheap is the failure mode, and Wave 2 made it worse. This file
// owns `removeFromClass()`, which now takes a REQUIRED classId because a child
// may be in several classes. The coach app and the admin panel each call it from
// a different screen. If one copy drifts back to the two-argument shape, the RPC
// refuses (p_class_id has no default and NULL is refused server-side) — but the
// two copies would then disagree about what "remove from class" means on a path
// a coach uses on their phone, and only one of the two apps would be tested.
//
// The server-side guard is the real protection; this test is what stops the two
// clients disagreeing about how to satisfy it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This file lives in SwimSyncAdmin/lib, so the repo root is two levels up.
const ROOT = join(__dirname, "..", "..");

const COPIES = [
  "SwimSyncAdmin/lib/studentStatus.ts",
  "SwimSyncApp/lib/studentStatus.ts",
];

describe("studentStatus.ts is byte-identical across both copies", () => {
  const [reference, ...others] = COPIES;
  const referenceText = readFileSync(join(ROOT, reference), "utf8");

  for (const copy of others) {
    it(`${copy} matches ${reference}`, () => {
      const text = readFileSync(join(ROOT, copy), "utf8");
      expect(
        text,
        `${copy} has drifted from ${reference}. This file owns the only write ` +
          `path a COACH has to enrolments, and since Wave 2 removeFromClass() ` +
          `must name a class. Copy the corrected version over both; do not ` +
          `patch them independently.`
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
