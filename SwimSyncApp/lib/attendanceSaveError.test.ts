import { attendanceSaveErrorMessage } from "./attendanceSaveError";

describe("attendanceSaveErrorMessage", () => {
  it("names the refusal + recovery for a CN001 (spent-credit) rollback", () => {
    const msg = attendanceSaveErrorMessage("CN001");
    // Item 3: the recovery is the admin VOID action, not "contact support".
    expect(msg).toMatch(/void/i);
    expect(msg).toMatch(/admin/i);
    expect(msg).toMatch(/credit notes page/i);
    expect(msg).toMatch(/none of your changes were saved/i);
    expect(msg).not.toMatch(/contact support/i);
  });

  // Wave 6 D6: the package out-of-order guard refuses with PK001 and a message
  // naming the date, the child and the class. One refused row rolls the whole
  // batch back (§7.67) and the coach app won't save a roster with a child left
  // unmarked, so the DB's own words are the coach's ONLY route forward.
  it("returns the DB message verbatim for a PK001 (package out-of-order guard)", () => {
    const db = "Mark 3 Oct first — the package has 1 lesson left. (Ava · Dolphins Fri 4pm)";
    expect(attendanceSaveErrorMessage("PK001", db)).toBe(db);
  });

  it("never sends a PK001 to the retry-forever line, even with no DB text", () => {
    for (const empty of [undefined, ""]) {
      const msg = attendanceSaveErrorMessage("PK001", empty);
      expect(msg).not.toMatch(/try again/i);
      expect(msg).toMatch(/earlier/i);
      expect(msg).toMatch(/none of your changes were saved/i);
    }
  });

  it("falls back to the generic retry for any other error", () => {
    expect(attendanceSaveErrorMessage("23505")).toBe(
      "Failed to save attendance. Please try again."
    );
    expect(attendanceSaveErrorMessage(undefined)).toBe(
      "Failed to save attendance. Please try again."
    );
  });
});
