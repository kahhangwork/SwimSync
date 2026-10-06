// The mapper is a byte-identical copy of the coach app's (attendanceSave.drift.test.ts),
// but the admin build runs it — so its behaviour is pinned here too, not only the bytes.

import { describe, expect, it } from "vitest";
import { attendanceSaveErrorMessage } from "./attendanceSaveError";

describe("attendanceSaveErrorMessage (admin copy)", () => {
  // Wave 6 D6: the package out-of-order guard refuses with PK001; its message
  // names the date, child and class, and it is the only route forward (§7.67).
  it("returns the DB message verbatim for a PK001 (package out-of-order guard)", () => {
    const db = "Mark 3 Oct first — the package has 1 lesson left. (Ava · Dolphins Fri 4pm)";
    expect(attendanceSaveErrorMessage("PK001", db)).toBe(db);
  });

  it("never sends a PK001 to the retry-forever line, even with no DB text", () => {
    for (const empty of [undefined, ""]) {
      expect(attendanceSaveErrorMessage("PK001", empty)).not.toMatch(/try again/i);
    }
  });

  it("CN001 keeps its own recovery text; anything else is the generic retry", () => {
    expect(attendanceSaveErrorMessage("CN001", "raw")).toMatch(/credit notes page/i);
    expect(attendanceSaveErrorMessage("23505", "raw")).toBe("Failed to save attendance. Please try again.");
  });
});
