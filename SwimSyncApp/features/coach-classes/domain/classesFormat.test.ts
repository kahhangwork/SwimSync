// CHARACTERISATION test (docs/refactor/BATCH_FGH_PLAN.md, App L-H): pins what the
// coach Classes tab's mapping already did when it moved out of the route file.
// §7.25's prove-it-red rule does not apply — there is no fix, only a move.
import { formatTime, classesOf } from "./classesFormat";

describe("classesFormat (characterisation)", () => {
  it("formatTime: 24h -> 12h with AM/PM, midnight/noon as 12", () => {
    expect(formatTime("00:30:00")).toBe("12:30 AM");
    expect(formatTime("12:00:00")).toBe("12:00 PM");
    expect(formatTime("18:15:00")).toBe("6:15 PM");
  });

  it("classesOf: counts only ACTIVE enrolments, price as a number, location '—' when not embedded", () => {
    const [c, bare] = classesOf([
      {
        id: "c1", title: "Dolphins", day_of_week: "saturday", start_time: "09:00:00", end_time: "09:45:00",
        location_id: "l1", locations: { name: "Pool A" }, price_per_lesson: "35",
        student_class_enrolments: [{ id: "e1", is_active: true }, { id: "e2", is_active: false }, { id: "e3", is_active: true }],
      },
      { id: "c2", title: "X", day_of_week: "monday", start_time: "t", end_time: "t", location_id: null, locations: null, price_per_lesson: 0, student_class_enrolments: null },
    ]);
    expect(c).toEqual({
      id: "c1", title: "Dolphins", day_of_week: "saturday", start_time: "09:00:00", end_time: "09:45:00",
      location_id: "l1", location_name: "Pool A", price_per_lesson: 35, student_count: 2,
    });
    expect(bare.location_name).toBe("—");
    expect(bare.student_count).toBe(0);
    expect(classesOf(null)).toEqual([]);
  });
});
