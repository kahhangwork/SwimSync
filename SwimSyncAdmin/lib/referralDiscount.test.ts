import { describe, it, expect } from "vitest";
import {
  resolveReferralDiscount,
  computeReferralDiscount,
  discountLabel,
} from "./referralDiscount";

// The SAME fixtures the pgTAP uses (supabase/tests/referrals.test.sql): tenant A
// is percent 10; P1 inherits, PA overrides to $25, P0 overrides to $0. An 8×$40
// package is worth $320.
const tenantOn = {
  referral_enabled: true,
  referral_discount_type: "percent" as const,
  referral_discount_value: 10,
};
const tenantOff = { referral_enabled: false, referral_discount_type: null, referral_discount_value: null };

describe("resolveReferralDiscount", () => {
  it("P1 inherits the tenant default", () => {
    const r = resolveReferralDiscount(
      { referral_discount_type: null, referral_discount_value: null }, tenantOn);
    expect(r).toEqual({ type: "percent", value: 10, source: "tenant" });
  });
  it("a product override beats the tenant default", () => {
    const r = resolveReferralDiscount(
      { referral_discount_type: "amount", referral_discount_value: 25 }, tenantOn);
    expect(r).toEqual({ type: "amount", value: 25, source: "product" });
  });
  it("an explicit $0 override is a real no-discount (D4)", () => {
    const r = resolveReferralDiscount(
      { referral_discount_type: "amount", referral_discount_value: 0 }, tenantOn);
    expect(r.source).toBe("product");
    expect(computeReferralDiscount(r.type, r.value, 320)).toBe(0);
  });
  it("the master switch off yields nothing, override or not (D15)", () => {
    const r = resolveReferralDiscount(
      { referral_discount_type: "amount", referral_discount_value: 25 }, tenantOff);
    expect(r).toEqual({ type: null, value: 0, source: "none" });
  });
});

describe("computeReferralDiscount mirrors the SQL", () => {
  it("percent 10 of 320 = 32", () => {
    expect(computeReferralDiscount("percent", 10, 320)).toBe(32);
  });
  it("amount 25 = 25", () => {
    expect(computeReferralDiscount("amount", 25, 320)).toBe(25);
  });
  it("caps a fixed discount at the price (amount_payable >= 0, D10)", () => {
    expect(computeReferralDiscount("amount", 999, 320)).toBe(320);
  });
  it("null type is 0", () => {
    expect(computeReferralDiscount(null, 10, 320)).toBe(0);
  });
});

describe("discountLabel", () => {
  it("formats percent, amount and none", () => {
    expect(discountLabel("percent", 10)).toBe("10% off");
    expect(discountLabel("amount", 25)).toBe("S$25.00 off");
    expect(discountLabel(null, 0)).toBe("no discount");
  });
});
