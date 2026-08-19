// The admin lesson page saves attendance through the SAME path as the coach
// app (ADMIN_CALENDAR_PLAN C.1), and it does so by carrying byte-identical
// copies of the coach app's save helpers. Two writers of the attendance table
// with two subtly different payload builders, error maps or credit-note email
// rules is the §7.18 shape again — so the copies are enforced, not remembered.
//
// Same mechanism as attendanceCompleteness.drift.test.ts. Edit the coach app's
// file, copy it over; never patch the admin copy independently.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

const PAIRS = [
  "attendancePayload.ts",
  "attendanceSaveError.ts",
  "creditNoteEmail.ts",
  "attendanceWindow.ts",
  "markableFloor.ts",
].map((f) => ({
  admin: `SwimSyncAdmin/lib/${f}`,
  app: `SwimSyncApp/lib/${f}`,
}));

describe("the admin's attendance-save helpers are byte-identical to the coach app's", () => {
  for (const { admin, app } of PAIRS) {
    it(`${admin} matches ${app}`, () => {
      const a = readFileSync(join(ROOT, admin), "utf8");
      const b = readFileSync(join(ROOT, app), "utf8");
      expect(a.length).toBeGreaterThan(300);
      expect(
        a,
        `${admin} has drifted from ${app}. The admin lesson page and the coach ` +
          `marking screen are two writers of the same table; their save helpers ` +
          `must be one implementation. Copy the coach app's file over this one.`
      ).toBe(b);
    });
  }
});
