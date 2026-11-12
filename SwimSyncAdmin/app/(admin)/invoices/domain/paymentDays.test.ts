import { describe, expect, it } from "vitest";
import { paymentDaysOf, paymentDaysSaveOutcome } from "./paymentDays";

describe("paymentDaysSaveOutcome — decided from the RE-READ value", () => {
  it("a save that stuck shows the stored value, no message", () => {
    expect(paymentDaysSaveOutcome(21, null, 21)).toEqual({ days: 21, message: null });
  });
  it("an RLS-filtered save (no error, value unchanged) is said out loud", () => {
    expect(paymentDaysSaveOutcome(21, null, 14)).toEqual({
      days: 14,
      message: "Not saved — families still have 14 days to pay.",
    });
  });
  it("a refused save shows the error and the stored value", () => {
    expect(paymentDaysSaveOutcome(21, "your role cannot change billing settings", 14)).toEqual({
      days: 14,
      message: "Error: your role cannot change billing settings",
    });
  });
  it("a failed re-read keeps what was typed and says the value is unknown", () => {
    expect(paymentDaysSaveOutcome(21, null, undefined).days).toBeNull();
    expect(paymentDaysSaveOutcome(21, "boom", undefined).message).toContain("reload");
  });
});

describe("paymentDaysOf", () => {
  it("reads a stored value, falling back to the column default 14", () => {
    expect(paymentDaysOf(30)).toBe(30);
    expect(paymentDaysOf(null)).toBe(14);
    expect(paymentDaysOf("x")).toBe(14);
    expect(paymentDaysOf(400)).toBe(90);
  });
});
