import { applyBulkStatus, SET_ALL_OPTIONS } from "./attendanceBulk";

describe("applyBulkStatus", () => {
  it("sets every student id to the chosen top/sub", () => {
    const result = applyBulkStatus(["a", "b", "c"], {}, { top: "cancelled", sub: "rain" });
    expect(Object.keys(result).sort()).toEqual(["a", "b", "c"]);
    for (const id of ["a", "b", "c"]) {
      expect(result[id].top).toBe("cancelled");
      expect(result[id].sub).toBe("rain");
    }
  });

  it("preserves each student's existingId", () => {
    const current = {
      a: { top: "present", sub: null, existingId: "att-1" },
      b: { top: "unmarked", sub: null, existingId: null },
    };
    const result = applyBulkStatus(["a", "b"], current, { top: "present", sub: null });
    expect(result.a.existingId).toBe("att-1");
    expect(result.b.existingId).toBe(null);
  });

  it("yields existingId null for ids missing from current", () => {
    const result = applyBulkStatus(["new"], {}, { top: "absent", sub: null });
    expect(result.new.existingId).toBe(null);
  });

  it("does not mutate the input map", () => {
    const current = { a: { top: "present", sub: null, existingId: "att-1" } };
    const snapshot = JSON.stringify(current);
    applyBulkStatus(["a"], current, { top: "cancelled", sub: "coach" });
    expect(JSON.stringify(current)).toBe(snapshot);
  });

  it("returns an empty map when there are no students", () => {
    expect(applyBulkStatus([], {}, { top: "present", sub: null })).toEqual({});
  });

  it("SET_ALL_OPTIONS has no trial option and every cancelled has a sub-type", () => {
    expect(SET_ALL_OPTIONS.map((o) => o.label)).toEqual([
      "Present",
      "Absent",
      "Cancelled — Rain",
      "Cancelled — Coach",
    ]);
    for (const opt of SET_ALL_OPTIONS) {
      if (opt.top === "cancelled") {
        expect(opt.sub).not.toBeNull();
      } else {
        expect(opt.sub).toBeNull();
      }
    }
  });
});
