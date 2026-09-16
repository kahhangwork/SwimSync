import { describe, it, expect } from "vitest";
import { payNowProxyWarning } from "./paynow";

describe("payNowProxyWarning", () => {
  it("warns when a mobile is not exactly 8 digits (the QR would fail to build)", () => {
    expect(payNowProxyWarning("paynow_mobile", "91234567")).toBeNull();
    expect(payNowProxyWarning("paynow_mobile", "912345678")).toMatch(/8 digits/);
    expect(payNowProxyWarning("paynow_mobile", "9123456")).toMatch(/8 digits/);
    expect(payNowProxyWarning("paynow_mobile", "9123-4567")).toMatch(/8 digits/);
  });

  it("does not warn on a UEN — the real builder accepts any non-blank one", () => {
    expect(payNowProxyWarning("paynow_uen", "201912345K")).toBeNull();
    expect(payNowProxyWarning("paynow_uen", "anything-nonblank")).toBeNull();
  });

  it("treats a blank/cleared value as fine, not an error", () => {
    expect(payNowProxyWarning("paynow_mobile", "")).toBeNull();
    expect(payNowProxyWarning("paynow_mobile", "   ")).toBeNull();
    expect(payNowProxyWarning("paynow_uen", null)).toBeNull();
  });
});
