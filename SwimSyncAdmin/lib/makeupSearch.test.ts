import { describe, it, expect } from "vitest";
import { filterEligibleKids } from "./makeupSearch";

const kids = [
  { id: "1", full_name: "Anya (Big)", home_class_titles: ["Tanglin View Sun 1100am"] },
  { id: "2", full_name: "Anya (Small)", home_class_titles: ["Tanglin View Sun 930am"] },
  { id: "3", full_name: "Chua Ashlyn", home_class_titles: ["Tanglin View Sun 930am"] },
  { id: "4", full_name: "Neel Mishra", home_class_titles: ["Katong Sat 845am"] },
  // Two classes — the shape that did not exist before Wave 2. Her SECOND class
  // is the only Bedok one, so a search for "bedok" that misses her is a search
  // box that looks like it worked and did not.
  { id: "5", full_name: "Priya Raman",
    home_class_titles: ["Katong Sat 845am", "Bedok Wed 6pm"] },
];

describe("filterEligibleKids", () => {
  it("matches a child by their SECOND class, not just their first", () => {
    expect(filterEligibleKids(kids, "bedok").map((k) => k.id)).toEqual(["5"]);
  });

  it("matches terms independently across name and ANY class", () => {
    // No single field contains both words.
    expect(filterEligibleKids(kids, "priya bedok").map((k) => k.id)).toEqual(["5"]);
  });

  it("matches everyone on an empty or blank query", () => {
    expect(filterEligibleKids(kids, "")).toHaveLength(5);
    expect(filterEligibleKids(kids, "   ")).toHaveLength(5);
  });

  it("matches by child name, case-insensitively", () => {
    expect(filterEligibleKids(kids, "anya").map((k) => k.id)).toEqual(["1", "2"]);
  });

  it("matches by CLASS name — the admin often knows the class, not the spelling", () => {
    expect(filterEligibleKids(kids, "930").map((k) => k.id)).toEqual(["2", "3"]);
    // Priya is in Katong AND Bedok, so a Katong search must return her too —
    // a two-class child belongs in every one of their classes' results.
    expect(filterEligibleKids(kids, "katong").map((k) => k.id)).toEqual(["4", "5"]);
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
