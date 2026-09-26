import { describe, it, expect } from "vitest";
import { runDaySaveOutcome } from "./runDay";

describe("runDaySaveOutcome", () => {
  it("a save the database kept: shows it, says nothing", () => {
    expect(runDaySaveOutcome(15, null, 15)).toEqual({ day: 15, message: null });
  });

  it("an update error: shows the STORED day, not the typed one, and the error", () => {
    expect(runDaySaveOutcome(15, "violates check constraint", 7)).toEqual({
      day: 7,
      message: "Error: violates check constraint",
    });
  });

  it("no error but nothing changed (RLS filtered the update): says it did not save", () => {
    expect(runDaySaveOutcome(15, null, 7)).toEqual({
      day: 7,
      message: "Not saved — the run day is still 7.",
    });
  });

  it("the re-read failed: leaves the input alone and says the saved day is unknown", () => {
    expect(runDaySaveOutcome(15, null, undefined)).toEqual({
      day: null,
      message: "Could not confirm the run day saved — reload to check.",
    });
    expect(runDaySaveOutcome(15, "boom", undefined).message).toMatch(/^Error: boom — reload/);
  });
});
