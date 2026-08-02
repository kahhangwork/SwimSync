import { describe, it, expect } from "vitest";
import { filterEligibleKids } from "./makeupSearch";

const kids = [
  { id: "1", full_name: "Anya (Big)", home_class_title: "Tanglin View Sun 1100am" },
  { id: "2", full_name: "Anya (Small)", home_class_title: "Tanglin View Sun 930am" },
  { id: "3", full_name: "Chua Ashlyn", home_class_title: "Tanglin View Sun 930am" },
  { id: "4", full_name: "Neel Mishra", home_class_title: "Katong Sat 845am" },
];

describe("filterEligibleKids", () => {
  it("matches everyone on an empty or blank query", () => {
    expect(filterEligibleKids(kids, "")).toHaveLength(4);
    expect(filterEligibleKids(kids, "   ")).toHaveLength(4);
  });

  it("matches by child name, case-insensitively", () => {
    expect(filterEligibleKids(kids, "anya").map((k) => k.id)).toEqual(["1", "2"]);
  });

  it("matches by CLASS name — the admin often knows the class, not the spelling", () => {
    expect(filterEligibleKids(kids, "930").map((k) => k.id)).toEqual(["2", "3"]);
    expect(filterEligibleKids(kids, "katong").map((k) => k.id)).toEqual(["4"]);
  });

  it("requires every term to match SOMETHING — mixing name and class narrows", () => {
    // "anya" matches two children; adding their class time picks one.
    expect(filterEligibleKids(kids, "anya 1100").map((k) => k.id)).toEqual(["1"]);
    expect(filterEligibleKids(kids, "anya 930").map((k) => k.id)).toEqual(["2"]);
  });

  it("returns nothing when a term matches neither field", () => {
    expect(filterEligibleKids(kids, "anya zzz")).toHaveLength(0);
  });

  it("does not mutate and copies on the empty-query path", () => {
    const out = filterEligibleKids(kids, "");
    expect(out).not.toBe(kids);
  });
});
