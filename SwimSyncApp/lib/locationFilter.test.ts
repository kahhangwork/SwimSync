import { locationChips } from "./locationFilter";

describe("locationChips", () => {
  it("dedupes by id and sorts by name", () => {
    expect(
      locationChips([
        { id: "b", name: "Bishan" },
        { id: "a", name: "Aljunied" },
        { id: "b", name: "Bishan" },
      ])
    ).toEqual([
      { id: "a", name: "Aljunied" },
      { id: "b", name: "Bishan" },
    ]);
  });

  it("skips entries with no id", () => {
    expect(
      locationChips([
        { id: null, name: "Nowhere" },
        { id: undefined, name: "Nada" },
        { id: "x", name: "Somewhere" },
      ])
    ).toEqual([{ id: "x", name: "Somewhere" }]);
  });

  it("returns a single entry for a one-location coach (caller then hides chips)", () => {
    expect(locationChips([{ id: "x", name: "Only Pool" }])).toEqual([
      { id: "x", name: "Only Pool" },
    ]);
  });

  it("is empty for no locatable classes", () => {
    expect(locationChips([])).toEqual([]);
  });
});
