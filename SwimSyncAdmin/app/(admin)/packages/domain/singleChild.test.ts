import { describe, it, expect } from "vitest";
import { autoChildFor, candidateKey, offerStudentFor, productFitsRow, saleStudentFor } from "./singleChild";

// Single-child packages: the app must never SEND a mismatch (the DB refuses one).
// Load-bearing: a shared product sends null even with a child selected (RISK 7);
// a renewal row's child is sent only for a one-child product (RISK 4); rows are
// keyed per child so one parent's family row and child row never collide.

const SHARED = { single_child: false };
const ONE = { single_child: true };

describe("saleStudentFor (RISK 7)", () => {
  it("a shared product sends null, never the selected child", () => {
    expect(saleStudentFor(SHARED, "ava")).toBeNull();
  });
  it("a one-child product sends the chosen child, or null until one is chosen", () => {
    expect(saleStudentFor(ONE, "ava")).toBe("ava");
    expect(saleStudentFor(ONE, "")).toBeNull();
  });
  it("no product chosen sends null", () => {
    expect(saleStudentFor(undefined, "ava")).toBeNull();
  });
});

describe("autoChildFor (D7)", () => {
  it("picks the only child, asks when there are several or none", () => {
    expect(autoChildFor([{ id: "ava", name: "Ava" }])).toBe("ava");
    expect(autoChildFor([{ id: "ava", name: "Ava" }, { id: "ben", name: "Ben" }])).toBe("");
    expect(autoChildFor([])).toBe("");
  });
});

describe("renewal rows (RISK 4)", () => {
  const family = { parent_id: "p1", student_id: null };
  const avaRow = { parent_id: "p1", student_id: "ava" };

  it("keys a family row and a child's row of one parent apart", () => {
    expect(candidateKey(family)).toBe("p1:family");
    expect(candidateKey(avaRow)).toBe("p1:ava");
  });
  it("a family row offers shared products; a child's row one-child products (D11)", () => {
    expect(productFitsRow(family, SHARED)).toBe(true);
    expect(productFitsRow(family, ONE)).toBe(false);
    expect(productFitsRow(avaRow, ONE)).toBe(true);
    expect(productFitsRow(avaRow, SHARED)).toBe(false);
  });
  it("offerStudentFor: one-child on a child row → that child; shared → null; one-child on a family row → null", () => {
    expect(offerStudentFor(avaRow, ONE)).toBe("ava");
    expect(offerStudentFor(avaRow, SHARED)).toBeNull();
    expect(offerStudentFor(family, SHARED)).toBeNull();
    expect(offerStudentFor(family, ONE)).toBeNull();
  });
});
