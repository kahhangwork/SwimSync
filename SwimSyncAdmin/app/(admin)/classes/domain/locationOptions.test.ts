import { describe, it, expect } from "vitest";
import { locationFilterOptions, formLocationOptions } from "./locationOptions";

describe("locationFilterOptions", () => {
  it("returns the distinct locations on the classes, sorted by name", () => {
    const opts = locationFilterOptions([
      { location_id: "b", location_name: "Bishan" },
      { location_id: "a", location_name: "Aljunied" },
      { location_id: "b", location_name: "Bishan" }, // dupe collapses
    ]);
    expect(opts).toEqual([
      { id: "a", name: "Aljunied" },
      { id: "b", name: "Bishan" },
    ]);
  });

  it("includes an archived location while a (retired) class still sits on it", () => {
    // The whole point of deriving from the class list, not the locations table:
    // a retired class on an archived location must stay filterable.
    const opts = locationFilterOptions([
      { location_id: "arch", location_name: "Old Pool" },
    ]);
    expect(opts).toEqual([{ id: "arch", name: "Old Pool" }]);
  });

  it("ignores classes with no location_id", () => {
    expect(
      locationFilterOptions([{ location_id: "", location_name: "" }])
    ).toEqual([]);
  });
});

describe("formLocationOptions", () => {
  const active = { id: "a", name: "Active", archived_at: null };
  const active2 = { id: "b", name: "Beta", archived_at: null };
  const archived = { id: "z", name: "Gone", archived_at: "2026-08-24T00:00:00Z" };

  it("offers only the non-archived locations for a new/normal class", () => {
    expect(formLocationOptions([active, active2, archived], "a")).toEqual([
      active,
      active2,
    ]);
  });

  it("adds the selected archived location, first, so a reactivated class shows its value", () => {
    // RISK 6: reactivate_class() cannot refuse, so a class whose location was
    // archived must still be representable in the picker.
    expect(formLocationOptions([active, active2, archived], "z")).toEqual([
      archived,
      active,
      active2,
    ]);
  });

  it("does not duplicate the selected location when it is still active", () => {
    expect(formLocationOptions([active, active2], "a")).toEqual([active, active2]);
  });

  it("returns only the active ones when nothing is selected", () => {
    expect(formLocationOptions([active, archived], "")).toEqual([active]);
  });
});
