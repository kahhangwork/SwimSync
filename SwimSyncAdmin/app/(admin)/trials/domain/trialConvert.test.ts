import { describe, it, expect } from "vitest";
import { needsConvertConfirmation } from "./trialConvert";

describe("needsConvertConfirmation — ⚠ RISK 1 two-press guard", () => {
  it("blocks the FIRST press when the child has a future trial", () => {
    // The whole point: a rebooked upcoming trial must not be silently enrolled
    // over, because the unmarked booking will block the billing month.
    expect(
      needsConvertConfirmation({ hasFutureTrial: true, alreadyConfirmed: false }),
    ).toBe(true);
  });

  it("lets the SECOND press through once the admin has seen the warning", () => {
    expect(
      needsConvertConfirmation({ hasFutureTrial: true, alreadyConfirmed: true }),
    ).toBe(false);
  });

  it("never blocks when there is no future trial — conversion is the normal case", () => {
    expect(
      needsConvertConfirmation({ hasFutureTrial: false, alreadyConfirmed: false }),
    ).toBe(false);
    expect(
      needsConvertConfirmation({ hasFutureTrial: false, alreadyConfirmed: true }),
    ).toBe(false);
  });
});
