import { applyBulkStatus, SET_ALL_OPTIONS } from "./attendanceBulk";

describe("applyBulkStatus", () => {
  it("sets every student id to the chosen top/sub", () => {
    const result = applyBulkStatus(["a", "b", "c"], {} as Record<string, never>, { top: "cancelled", sub: "rain" });
    expect(Object.keys(result).sort()).toEqual(["a", "b", "c"]);
    for (const id of ["a", "b", "c"]) {
      expect(result[id].top).toBe("cancelled");
      expect(result[id].sub).toBe("rain");
    }
  });

  // These three used to assert that `existingId` — the attendance row's primary
  // key — was carried through. It has been removed: the save matches an
  // existing row on (lesson_session_id, student_id), and sending the PK is what
  // broke every partially-marked lesson (§7.67). What matters now is that the
  // result carries STATUS ONLY, so no per-student key can differ.
  it("emits status fields only, never a row id", () => {
    const current = { a: { top: "present", sub: null } };
    const result = applyBulkStatus(["a", "b"], current, { top: "present", sub: null });
    expect(Object.keys(result.a).sort()).toEqual(["sub", "top"]);
    expect(Object.keys(result.b).sort()).toEqual(["sub", "top"]);
  });

  it("gives every student the SAME key set, whether or not they were known", () => {
    const result = applyBulkStatus(["known", "new"], { known: { top: "absent", sub: null } },
      { top: "absent", sub: null });
    expect(Object.keys(result.known).sort()).toEqual(Object.keys(result.new).sort());
  });

  it("does not mutate the input map", () => {
    const current = { a: { top: "present", sub: null } };
    const snapshot = JSON.stringify(current);
    applyBulkStatus(["a"], current, { top: "cancelled", sub: "coach" });
    expect(JSON.stringify(current)).toBe(snapshot);
  });

  // A student NOT in the id list keeps their entry, untouched. useMarking leaves a
  // public-holiday void out of the list (a coach may not re-mark it, §7.67) — and
  // until 2026-10-02 this returned ONLY the listed ids, so the holiday row was
  // DELETED from the map: the screen showed it "Not yet marked" and Save refused
  // the whole lesson until it was reopened.
  it("keeps every student it was not asked to set, exactly as they were", () => {
    const current = {
      a: { top: "unmarked", sub: null },
      h: { top: "holiday", sub: null },
    };
    const result = applyBulkStatus(["a"], current, { top: "present", sub: null });
    expect(result).toEqual({
      a: { top: "present", sub: null },
      h: { top: "holiday", sub: null },
    });
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
