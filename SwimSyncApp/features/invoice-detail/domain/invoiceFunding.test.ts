import { fundingByItem } from "./invoiceFunding";

const row = (over: Record<string, unknown> = {}) => ({
  invoice_item_id: "i1",
  reversed_at: null,
  parent_packages: { name: "10 Group Lessons" },
  ...over,
});

describe("fundingByItem", () => {
  it("maps a funded line to its package's name", () => {
    const map = fundingByItem([row()]);
    expect(map.get("i1")).toBe("10 Group Lessons");
  });

  // ⚠ A reversed draw is NOT funding — the correction path restored that
  // money to the package, so the line must not claim a package paid for it.
  it("ignores a reversed application", () => {
    const map = fundingByItem([row({ reversed_at: "2026-08-01T00:00:00Z" })]);
    expect(map.size).toBe(0);
  });

  it("accepts the embed as an array (PostgREST shape drift)", () => {
    const map = fundingByItem([
      row({ parent_packages: [{ name: "5 Lesson Starter" }] }),
    ]);
    expect(map.get("i1")).toBe("5 Lesson Starter");
  });

  it("falls back to a generic label when the package name is unreadable", () => {
    expect(fundingByItem([row({ parent_packages: null })]).get("i1")).toBe(
      "Package"
    );
    expect(fundingByItem([row({ parent_packages: { name: " " } })]).get("i1")).toBe(
      "Package"
    );
  });

  // ⚠ FAIL-SAFE IS "NO TAGS", NEVER A CRASH — the invoice screen passes the
  // query result straight in.
  it("returns an empty map for null / undefined / garbage input", () => {
    expect(fundingByItem(null).size).toBe(0);
    expect(fundingByItem(undefined).size).toBe(0);
    expect(fundingByItem("boom").size).toBe(0);
    expect(fundingByItem([null, 42, { reversed_at: null }]).size).toBe(0);
  });
});
