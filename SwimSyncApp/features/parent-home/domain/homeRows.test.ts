// CHARACTERISATION test (docs/refactor/BATCH_FGH_PLAN.md, App L-F): pins what the
// parent Home tab's row mapping already did when it moved out of the route file.
// §7.25's prove-it-red rule does not apply — there is no fix, only a move. Each
// guarded line was mutated once and a named case went red (playbook §5).
import {
  formatTime,
  capitalize,
  totalCredit,
  mapChildren,
  firstBookingByStudent,
  totalOutstandingOf,
} from "./homeRows";

const enrol = (day: string | null, start: string, end: string, extra: object = {}) => ({
  is_active: true,
  classes: {
    day_of_week: day,
    start_time: start,
    end_time: end,
    locations: { name: "Pool A" },
    coaches: { profiles: { full_name: "Coach Tan" } },
  },
  ...extra,
});

const parentWith = (...students: object[]) => ({
  id: "p1",
  parent_students: students.map((s) => ({ students: s })),
});

describe("homeRows (characterisation)", () => {
  it("formatTime: 24h -> 12h with AM/PM, null stays null", () => {
    expect(formatTime("00:05:00")).toBe("12:05 AM");
    expect(formatTime("12:30:00")).toBe("12:30 PM");
    expect(formatTime("17:00:00")).toBe("5:00 PM");
    expect(formatTime(null)).toBeNull();
  });

  it("capitalize: first letter up, null reads as an em dash", () => {
    expect(capitalize("assigned")).toBe("Assigned");
    expect(capitalize(null)).toBe("—");
  });

  it("totalCredit sums every business's balance; a null balance counts as 0; none is 0", () => {
    expect(
      totalCredit({ parent_tenant_balances: [{ credit_balance: "10.50" }, { credit_balance: null }, { credit_balance: 4.5 }] })
    ).toBe(15);
    expect(totalCredit({})).toBe(0);
  });

  it("mapChildren keeps EVERY active enrolment, drops inactive and class-less ones, sorts Monday-first", () => {
    const [kid] = mapChildren(
      parentWith({
        id: "s1",
        full_name: "Amelia",
        assignment_status: "assigned",
        is_active: true,
        student_class_enrolments: [
          enrol("saturday", "09:00:00", "09:45:00"),
          enrol("wednesday", "17:00:00", "17:45:00"),
          enrol("monday", "08:00:00", "08:45:00", { is_active: false }),
          { is_active: true, classes: null },
        ],
      })
    );
    expect(kid.classes.map((c) => c.day)).toEqual(["wednesday", "saturday"]);
    expect(kid.classes[0]).toEqual({
      coach_name: "Coach Tan",
      day: "wednesday",
      time: "5:00 PM – 5:45 PM",
      location: "Pool A",
    });
    expect(kid.trial).toBeNull();
    expect(kid.makeup).toBeNull();
  });

  it("mapChildren: a null day sorts FIRST (indexOf -1), and missing embeds read null", () => {
    const [kid] = mapChildren(
      parentWith({
        id: "s1",
        full_name: "A",
        assignment_status: "assigned",
        is_active: true,
        student_class_enrolments: [
          enrol("monday", "08:00:00", "08:45:00"),
          { is_active: true, classes: { day_of_week: null, start_time: "10:00", end_time: "11:00" } },
        ],
      })
    );
    expect(kid.classes.map((c) => c.day)).toEqual([null, "monday"]);
    expect(kid.classes[0].coach_name).toBeNull();
    expect(kid.classes[0].location).toBeNull();
  });

  it("mapChildren: no parent_students / no enrolments is an empty list, not a crash", () => {
    expect(mapChildren({})).toEqual([]);
    const [kid] = mapChildren(parentWith({ id: "s", full_name: "B", assignment_status: "unassigned", is_active: false }));
    expect(kid.classes).toEqual([]);
    expect(kid.is_active).toBe(false);
  });

  it("firstBookingByStudent: the FIRST row per student wins (query is earliest first); fallback title when the class did not embed", () => {
    const m = firstBookingByStudent(
      [
        { student_id: "s1", session_date: "2026-10-01", classes: { title: "Dolphins" } },
        { student_id: "s1", session_date: "2026-10-08", classes: { title: "Sharks" } },
        { student_id: "s2", session_date: "2026-10-02", classes: null },
      ],
      "their class"
    );
    expect(m.get("s1")).toEqual({ class_title: "Dolphins", session_date: "2026-10-01" });
    expect(m.get("s2")).toEqual({ class_title: "their class", session_date: "2026-10-02" });
    expect(firstBookingByStudent(null, "x").size).toBe(0);
  });

  it("totalOutstandingOf sums net_amount (strings from PostgREST numerics); null is 0", () => {
    expect(totalOutstandingOf([{ net_amount: "88.00" }, { net_amount: 12 }])).toBe(100);
    expect(totalOutstandingOf(null)).toBe(0);
  });
});
