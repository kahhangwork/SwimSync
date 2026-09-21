// CHARACTERISATION tests (COACH_ROSTER_REFACTOR_PLAN.md, Stage 2): they pin what
// the roster screen's load already computed when its mapping moved out of the
// route file. §7.25's prove-it-red rule does not apply — there is no fix, only a
// move. Each case is named for the plan's §6 Stage 2 assertion it pins (1-11);
// the billing-gate cases (1-6) are the ones that matter: this list is what the
// coach sees as unmarked, and it must agree with what generate-invoices blocks on.
import {
  toActiveStudents,
  toEnrolmentSpans,
  toClassInfo,
  toUpcomingExtras,
  upcomingBookings,
  guestIdsOf,
  nameByIdOf,
  namedGuests,
  bookedByDateOf,
  buildSessions,
  duplicateNameKeys,
} from "./rosterRows";
import type { EnrolmentSpan } from "@/lib/attendanceCompleteness";

// A Saturday class; the window holds four Saturdays: 1, 8, 15, 22 Aug 2026.
const WIN = "2026-08-01";
const TODAY = "2026-08-22";

const span = (studentId: string, from: string, until: string | null = null): EnrolmentSpan => ({
  studentId,
  from,
  until,
});

const session = (
  id: string,
  session_date: string,
  marked: [string, string][] = [],
  cancelled_at: string | null = null,
  cancellation_reason: string | null = null
) => ({
  id,
  session_date,
  cancelled_at,
  cancellation_reason,
  attendance: marked.map(([student_id, status], i) => ({ id: `a${i}`, student_id, status })),
});

const build = (o: {
  sessionData?: any[] | null;
  spans?: EnrolmentSpan[];
  booked?: Map<string, string[]>;
}) =>
  buildSessions({
    sessionData: o.sessionData ?? [],
    enrolmentSpans: o.spans ?? [],
    bookedByDate: o.booked ?? new Map(),
    dayOfWeek: "saturday",
    winStart: WIN,
    todayDate: TODAY,
  });

describe("buildSessions — the billing gate's union (characterisation)", () => {
  it("1. target is the LAST expected date ascending, even when that date is already recorded (seen)", () => {
    const { target } = build({
      sessionData: [session("s22", "2026-08-22", [["A", "present"]])],
      spans: [span("A", "2026-08-01")],
    });
    expect(target).toEqual({ date: "2026-08-22" });
  });

  it("2. exactly one row per date when a recorded date is also a weekday in range", () => {
    const { rows } = build({
      sessionData: [session("s22", "2026-08-22", [["A", "present"]])],
      spans: [span("A", "2026-08-01")],
    });
    expect(rows.map((r) => r.session_date)).toEqual([
      "2026-08-22",
      "2026-08-15",
      "2026-08-08",
      "2026-08-01",
    ]);
    expect(rows.filter((r) => r.session_date === "2026-08-22")).toHaveLength(1);
    expect(rows[0].id).toBe("s22");
    expect(rows.slice(1).every((r) => r.id === null && r.summary === "")).toBe(true);
  });

  it("3a. a cancelled date with no booking expects nobody: it is not the target", () => {
    const { rows, target } = build({
      sessionData: [session("s22", "2026-08-22", [], "2026-08-20T02:00:00Z", "Pool closed")],
      spans: [span("A", "2026-08-01")],
    });
    expect(target).toEqual({ date: "2026-08-15" });
    const r22 = rows.find((r) => r.session_date === "2026-08-22")!;
    expect(r22.cancelled).toBe(true);
    expect(r22.cancelReason).toBe("Pool closed");
    expect(r22.progress).toEqual({ kind: "no-students" });
  });

  it("3b. a cancelled date substitutes [] for enrolled spans, but its bookings still count", () => {
    const { rows, target } = build({
      sessionData: [session("s22", "2026-08-22", [], "2026-08-20T02:00:00Z")],
      spans: [span("A", "2026-08-01")],
      booked: new Map([["2026-08-22", ["G"]]]),
    });
    expect(target).toEqual({ date: "2026-08-22" });
    const r22 = rows.find((r) => r.session_date === "2026-08-22")!;
    // Only the guest is expected (A is substituted out), and nobody is marked.
    expect(r22.progress).toEqual({ kind: "unmarked" });
    const partial = build({
      sessionData: [session("s22", "2026-08-22", [["G", "present"]], "2026-08-20T02:00:00Z")],
      spans: [span("A", "2026-08-01")],
      booked: new Map([["2026-08-22", ["G"]]]),
    }).rows.find((r) => r.session_date === "2026-08-22")!;
    expect(partial.progress).toEqual({ kind: "complete", total: 1 });
    expect(partial.cancelReason).toBeNull();
  });

  it("4. a date nobody is expected at makes no row and never becomes the target", () => {
    const { rows, target } = build({ spans: [span("A", "2026-08-10")] });
    expect(rows.map((r) => r.session_date)).toEqual(["2026-08-22", "2026-08-15"]);
    expect(target).toEqual({ date: "2026-08-22" });
    const empty = build({ spans: [span("A", "2026-08-01", "2026-08-05")] });
    // A only covered the 1st; nothing after is synthesised, and the target stays there.
    expect(empty.rows.map((r) => r.session_date)).toEqual(["2026-08-01"]);
    expect(empty.target).toEqual({ date: "2026-08-01" });
  });

  it("5. a guest-only date on a zero-enrolment class makes a row AND the target (the 20260810 case)", () => {
    const { rows, target } = build({
      spans: [],
      booked: new Map([["2026-08-08", ["G"]]]),
    });
    expect(rows).toEqual([
      { id: null, session_date: "2026-08-08", progress: { kind: "unmarked" }, summary: "" },
    ]);
    expect(target).toEqual({ date: "2026-08-08" });
  });

  it("5b. an off-weekday booking date inside the window is unioned in", () => {
    const { rows, target } = build({
      spans: [],
      booked: new Map([["2026-08-12", ["G"]]]), // a Wednesday
    });
    expect(rows.map((r) => r.session_date)).toEqual(["2026-08-12"]);
    expect(target).toEqual({ date: "2026-08-12" });
  });

  it("6. a mid-month joiner is absent from an earlier lesson's denominator (§8.15)", () => {
    const { rows } = build({
      sessionData: [
        session("s08", "2026-08-08", [["A", "present"]]),
        session("s15", "2026-08-15", [["A", "present"]]),
      ],
      spans: [span("A", "2026-08-01"), span("B", "2026-08-12")],
    });
    const by = (d: string) => rows.find((r) => r.session_date === d)!;
    expect(by("2026-08-08").progress).toEqual({ kind: "complete", total: 1 });
    expect(by("2026-08-15").progress).toEqual({ kind: "partial", marked: 1, total: 2 });
    expect(by("2026-08-08").summary).toMatch(/present/);
  });

  it("9. sorted descending, and a recorded session BELOW the window is kept", () => {
    const { rows } = build({
      sessionData: [session("s0704", "2026-07-04", [["A", "present"]])],
      spans: [span("A", "2026-07-01")],
    });
    expect(rows.map((r) => r.session_date)).toEqual([
      "2026-08-22",
      "2026-08-15",
      "2026-08-08",
      "2026-08-01",
      "2026-07-04",
    ]);
  });

  it("null sessionData behaves as an empty list", () => {
    expect(build({ sessionData: null, spans: [] })).toEqual({ rows: [], target: null });
  });
});

describe("the class row (characterisation)", () => {
  const cls = {
    title: "Saturday Tadpoles",
    day_of_week: "saturday",
    start_time: "09:00:00",
    end_time: "09:45:00",
    locations: { name: "Pasir Ris Pool" },
    student_class_enrolments: [
      {
        is_active: true,
        enrolled_at: "2026-07-31T17:00:00Z", // 01:00 SGT on 1 Aug
        unenrolled_at: null,
        student_id: "A",
        students: {
          id: "A",
          full_name: "Ava Tan",
          date_of_birth: "2019-03-10",
          tenant_levels: {
            label: "Toddler 1",
            note: "Water confidence",
            tenant_level_skills: [
              { label: "Float", sort_order: 2 },
              { label: "Blow bubbles", sort_order: 1 },
            ],
          },
        },
      },
      {
        is_active: false,
        enrolled_at: "2026-06-01T02:00:00Z",
        unenrolled_at: "2026-08-09T20:00:00Z", // 04:00 SGT on 10 Aug
        student_id: null,
        students: { id: "L", full_name: "Leo Lim", date_of_birth: null, tenant_levels: null },
      },
    ],
  };

  it("7. spans come from EVERY enrolment (a child who left still counts); students are is_active only", () => {
    expect(toEnrolmentSpans(cls)).toEqual([
      { studentId: "A", from: "2026-08-01", until: null },
      // student_id null -> falls back to students.id; dates are SG calendar dates
      { studentId: "L", from: "2026-06-01", until: "2026-08-10" },
    ]);
    expect(toActiveStudents(cls).map((s) => s.id)).toEqual(["A"]);
  });

  it("8. DOB and level are read off e.students; skills sorted by sort_order client-side", () => {
    expect(toActiveStudents(cls)).toEqual([
      {
        id: "A",
        full_name: "Ava Tan",
        date_of_birth: "2019-03-10",
        level_label: "Toddler 1",
        level_note: "Water confidence",
        level_skills: ["Blow bubbles", "Float"],
      },
    ]);
  });

  it("8b. no level -> nulls and []", () => {
    const [s] = toActiveStudents({
      student_class_enrolments: [{ ...cls.student_class_enrolments[1], is_active: true }],
    });
    expect(s).toMatchObject({ level_label: null, level_note: null, level_skills: [] });
  });

  it("a null enrolment list is empty on both reads", () => {
    expect(toActiveStudents({ student_class_enrolments: null })).toEqual([]);
    expect(toEnrolmentSpans({ student_class_enrolments: null })).toEqual([]);
  });

  it("toClassInfo reads the to-one embed as an object, '—' when absent", () => {
    expect(toClassInfo(cls)).toEqual({
      title: "Saturday Tadpoles",
      day_of_week: "saturday",
      start_time: "09:00:00",
      end_time: "09:45:00",
      location_name: "Pasir Ris Pool",
    });
    expect(toClassInfo({ ...cls, locations: null }).location_name).toBe("—");
  });
});

describe("guests and extras (characterisation)", () => {
  it("upcomingBookings keeps today and later, ascending; null is []", () => {
    const rows = [
      { student_id: "G2", session_date: "2026-08-29" },
      { student_id: "G0", session_date: "2026-08-21" },
      { student_id: "G1", session_date: "2026-08-22" },
    ];
    expect(upcomingBookings(rows, "2026-08-22").map((b) => b.student_id)).toEqual(["G1", "G2"]);
    expect(upcomingBookings(null, "2026-08-22")).toEqual([]);
  });

  it("guestIdsOf de-duplicates across trials and make-ups, trials first", () => {
    expect(
      guestIdsOf(
        [{ student_id: "G1" }, { student_id: "G2" }],
        [{ student_id: "G2" }, { student_id: "M1" }]
      )
    ).toEqual(["G1", "G2", "M1"]);
  });

  it("11. namedGuests falls back to the given label when a name is missing", () => {
    const nameById = nameByIdOf([{ id: "G1", full_name: "Gia" }]);
    const rows = [
      { student_id: "G1", session_date: "2026-08-22" },
      { student_id: "G9", session_date: "2026-08-29" },
    ];
    expect(namedGuests(rows, nameById, "A trial student")).toEqual([
      { id: "G1", full_name: "Gia", session_date: "2026-08-22" },
      { id: "G9", full_name: "A trial student", session_date: "2026-08-29" },
    ]);
    expect(namedGuests(rows, nameByIdOf(null), "A make-up student")[0].full_name).toBe(
      "A make-up student"
    );
  });

  it("bookedByDateOf merges trial and make-up bookings per date", () => {
    const m = bookedByDateOf(
      [{ student_id: "G1", session_date: "2026-08-22" }],
      [
        { student_id: "M1", session_date: "2026-08-22" },
        { student_id: "M2", session_date: "2026-08-15" },
      ]
    );
    expect([...m.entries()]).toEqual([
      ["2026-08-22", ["G1", "M1"]],
      ["2026-08-15", ["M2"]],
    ]);
    expect(bookedByDateOf(null, null).size).toBe(0);
  });

  it("toUpcomingExtras maps off_schedule_reason to reason; null is []", () => {
    expect(
      toUpcomingExtras([{ id: "x", session_date: "2026-08-26", off_schedule_reason: "Holiday shift" }])
    ).toEqual([{ id: "x", session_date: "2026-08-26", reason: "Holiday shift" }]);
    expect(toUpcomingExtras(null)).toEqual([]);
  });
});

describe("duplicateNameKeys (characterisation)", () => {
  it("10. trims and lowercases; only a repeated name is a key", () => {
    const s = (full_name: string) => ({
      id: full_name,
      full_name,
      date_of_birth: null,
      level_label: null,
      level_note: null,
      level_skills: [],
    });
    expect([...duplicateNameKeys([s("Ethan Tan"), s(" ethan tan "), s("Noah Lim")])]).toEqual([
      "ethan tan",
    ]);
  });
});
