import { describe, it, expect } from "vitest";
import { defaultConfirmStart, pickOfferProduct } from "./packageOffers";

describe("defaultConfirmStart (⚠ RISK 3)", () => {
  it("adopts the offer's own start_date when present", () => {
    expect(defaultConfirmStart("2026-09-01", "2026-08-20")).toBe("2026-09-01");
  });
  it("falls back to the suggested date for a parent request (no start_date)", () => {
    expect(defaultConfirmStart(null, "2026-08-20")).toBe("2026-08-20");
  });
});

describe("pickOfferProduct (Decision 5 precedence)", () => {
  it("the active original beats any default", () => {
    expect(
      pickOfferProduct({ productId: "orig", isActive: true }, "cat", "all")
    ).toBe("orig");
  });
  it("a RETIRED original falls to the category default", () => {
    expect(
      pickOfferProduct({ productId: "orig", isActive: false }, "cat", "all")
    ).toBe("cat");
  });
  it("no category default falls to the all-classes default", () => {
    expect(
      pickOfferProduct({ productId: "orig", isActive: false }, null, "all")
    ).toBe("all");
  });
  it("nothing to suggest ⇒ null (row is skipped until the admin picks)", () => {
    expect(pickOfferProduct(null, null, null)).toBeNull();
    expect(
      pickOfferProduct({ productId: "orig", isActive: false }, null, null)
    ).toBeNull();
  });
});
