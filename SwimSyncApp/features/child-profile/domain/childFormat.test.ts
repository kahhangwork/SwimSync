// CHARACTERISATION test (docs/refactor/BATCH_FGH_PLAN.md, App L-F): pins what the
// Child Profile screen's mapping already did when it moved out of the route file.
// §7.25's prove-it-red rule does not apply — there is no fix, only a move. Each
// guarded line was mutated once and a named case went red (playbook §5).
import {
  formatTime,
  capitalize,
  formatDate,
  classesOf,
  outstandingOf,
  creditOf,
  childDetailOf,
} from "./childFormat";

const cls = (day: string, extra: object = {}) => ({
  day_of_week: day,
  start_time: "17:00:00",
  end_time: "17:45:00",
  locations: { name: "Pool A", address: "1 Pool Rd", notes: "Gate B" },
  coaches: { profiles: { full_name: "Coach Tan" } },
  ...extra,
});

describe("childFormat (characterisation)", () => {
  it("formatTime / capitalize: same rules as Home", () => {
    expect(formatTime("09:05:00")).toBe("9:05 AM");
    expect(formatTime(null)).toBeNull();
    expect(capitalize("male")).toBe("Male");
    expect(capitalize(null)).toBe("—");
  });

  it("formatDate: long SGT date; null reads as an em dash", () => {
    expect(formatDate("2019-03-07")).toBe("7 March 2019");
    expect(formatDate(null)).toBe("—");
  });

  it("classesOf keeps active enrolments with a class, in PostgREST order (NOT sorted), with address + notes", () => {
    const out = classesOf({
      student_class_enrolments: [
        { is_active: true, classes: cls("saturday") },
        { is_active: false, classes: cls("monday") },
        { is_active: true, classes: null },
        { is_active: true, classes: cls("wednesday", { locations: null }) },
      ],
    });
    expect(out.map((c) => c.day)).toEqual(["saturday", "wednesday"]);
    expect(out[0]).toEqual({
      coach_name: "Coach Tan",
      day: "saturday",
      time: "5:00 PM – 5:45 PM",
      location: "Pool A",
      location_address: "1 Pool Rd",
      location_notes: "Gate B",
    });
    expect(out[1].location).toBeNull();
    expect(out[1].location_address).toBeNull();
    expect(classesOf({})).toEqual([]);
  });

  it("outstandingOf / creditOf sum their rows; missing rows are 0", () => {
    expect(outstandingOf([{ net_amount: "40.00" }, { net_amount: 2.5 }])).toBe(42.5);
    expect(outstandingOf(null)).toBe(0);
    expect(creditOf({ parent_tenant_balances: [{ credit_balance: "5" }, { credit_balance: null }] })).toBe(5);
    expect(creditOf(null)).toBe(0);
  });

  it("childDetailOf reads the level off tenant_levels, pairs grades by skill, defaults empty", () => {
    const d = childDetailOf(
      {
        id: "s1",
        full_name: "Amelia",
        date_of_birth: "2019-03-07",
        gender: "female",
        notes: null,
        assignment_status: "assigned",
        is_active: true,
        tenant_levels: {
          label: "Dolphin",
          note: "Front crawl",
          tenant_level_skills: [{ id: "k1", label: "Float", sort_order: 2, extra: "dropped" }],
        },
      },
      [],
      [{ id: "g1", rank: 1, label: "Done" }],
      [{ skill_id: "k1", grade_level_id: "g1" }],
      12,
      3
    );
    expect(d.level_label).toBe("Dolphin");
    expect(d.level_note).toBe("Front crawl");
    expect(d.level_skills).toEqual([{ id: "k1", label: "Float", sort_order: 2 }]);
    expect(d.skill_grades).toEqual({ k1: "g1" });
    expect(d.scale).toEqual([{ id: "g1", rank: 1, label: "Done" }]);
    expect(d.outstanding_amount).toBe(12);
    expect(d.credit_balance).toBe(3);

    const bare = childDetailOf({ id: "s2", full_name: "B" }, [], null, null, 0, 0);
    expect(bare.level_label).toBeNull();
    expect(bare.level_skills).toEqual([]);
    expect(bare.skill_grades).toEqual({});
    expect(bare.scale).toEqual([]);
  });
});
