import { describe, expect, it } from "vitest";
import { mapClasses, mapCoaches } from "./substituteRows";

// Characterisation test (playbook §2 stage 4): pins the PostgREST nested-join
// flattening lifted from the Substitutes page, including the object-vs-array
// embed shape and the "Unknown coach" fallback.

describe("mapClasses", () => {
  it("flattens an object embed", () => {
    const rows = [
      { id: "c1", title: "Dolphins", day_of_week: 1, coach_id: "co1", is_active: true, coaches: { id: "co1", profiles: { full_name: "Ana" } } },
    ];
    expect(mapClasses(rows)).toEqual([
      { id: "c1", title: "Dolphins", day_of_week: 1, coach_id: "co1", coach_name: "Ana", is_active: true },
    ]);
  });

  it("flattens an array embed and falls back to Unknown coach", () => {
    const rows = [
      { id: "c2", title: "Sharks", day_of_week: 3, coach_id: "co2", is_active: false, coaches: [{ id: "co2", profiles: [{ full_name: "Bo" }] }] },
      { id: "c3", title: "Rays", day_of_week: 5, coach_id: "co3", is_active: true, coaches: null },
    ];
    const out = mapClasses(rows);
    expect(out[0].coach_name).toBe("Bo");
    expect(out[0].is_active).toBe(false);
    expect(out[1].coach_name).toBe("Unknown coach");
  });
});

describe("mapCoaches", () => {
  it("flattens either embed shape with a fallback", () => {
    const rows = [
      { id: "co1", profiles: { full_name: "Ana" } },
      { id: "co2", profiles: [{ full_name: "Bo" }] },
      { id: "co3", profiles: null },
    ];
    expect(mapCoaches(rows)).toEqual([
      { id: "co1", name: "Ana" },
      { id: "co2", name: "Bo" },
      { id: "co3", name: "Unknown coach" },
    ]);
  });
});
