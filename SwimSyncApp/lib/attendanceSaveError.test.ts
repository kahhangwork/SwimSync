import { attendanceSaveErrorMessage } from "./attendanceSaveError";

describe("attendanceSaveErrorMessage", () => {
  it("names the refusal + recovery for a CN001 (spent-credit) rollback", () => {
    const msg = attendanceSaveErrorMessage("CN001");
    expect(msg).toMatch(/reversed manually/i);
    expect(msg).toMatch(/none of your changes were saved/i);
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
