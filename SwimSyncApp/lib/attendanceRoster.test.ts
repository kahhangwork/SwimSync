import { mergeRoster, RosterStudent } from "./attendanceRoster";

const enrolled: RosterStudent[] = [
  { id: "a", full_name: "Amy Enrolled" },
  { id: "b", full_name: "Ben Enrolled" },
];

describe("mergeRoster", () => {
  it("returns the enrolled students unchanged when nobody else is marked", () => {
    const out = mergeRoster(enrolled, []);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out.every((s) => s.attendedOnly === false)).toBe(true);
  });

  // The regression this file exists for: a trial walk-in's enrolment is closed
  // on its own date, so they are NOT actively enrolled — but they were marked
  // on this session and must still appear.
  it("includes a student who has attendance but no active enrolment", () => {
    const out = mergeRoster(enrolled, [{ id: "z", full_name: "Zoe WalkIn" }]);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "z"]);
    expect(out.find((s) => s.id === "z")?.attendedOnly).toBe(true);
  });

  it("does not duplicate a student who is both enrolled and marked", () => {
    const out = mergeRoster(enrolled, [{ id: "a", full_name: "Amy Enrolled" }]);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out.find((s) => s.id === "a")?.attendedOnly).toBe(false);
  });

  // A naive join returns one row per attendance record.
  it("collapses repeated attendance rows for the same student", () => {
    const out = mergeRoster(enrolled, [
      { id: "z", full_name: "Zoe WalkIn" },
      { id: "z", full_name: "Zoe WalkIn" },
    ]);
    expect(out.filter((s) => s.id === "z")).toHaveLength(1);
  });

  it("orders the extras by name so the list is stable between loads", () => {
    const out = mergeRoster(enrolled, [
      { id: "y", full_name: "Yan WalkIn" },
      { id: "x", full_name: "Xena WalkIn" },
    ]);
    expect(out.map((s) => s.full_name)).toEqual([
      "Amy Enrolled",
      "Ben Enrolled",
      "Xena WalkIn",
      "Yan WalkIn",
    ]);
  });

  it("keeps the enrolled order rather than sorting the whole list", () => {
    const reversed: RosterStudent[] = [
      { id: "b", full_name: "Ben Enrolled" },
      { id: "a", full_name: "Amy Enrolled" },
    ];
    expect(mergeRoster(reversed, []).map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("mergeRoster — trial bookings", () => {
  // Without this the booked child never appears, is never marked, and the
  // billing month can never close.
  it("includes a child booked for a trial on this date", () => {
    const out = mergeRoster(enrolled, [], [{ id: "t", full_name: "Tara Trial" }]);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "t"]);
    expect(out.find((s) => s.id === "t")?.isTrial).toBe(true);
  });

  it("does not label an enrolled student as a trial", () => {
    const out = mergeRoster(enrolled, [], []);
    expect(out.every((s) => s.isTrial === false)).toBe(true);
  });

  // A booked child the coach has already marked appears in both sources.
  it("shows a booked-and-marked child once, still flagged as a trial", () => {
    const out = mergeRoster(
      enrolled,
      [{ id: "t", full_name: "Tara Trial" }],
      [{ id: "t", full_name: "Tara Trial" }]
    );
    expect(out.filter((s) => s.id === "t")).toHaveLength(1);
    expect(out.find((s) => s.id === "t")?.isTrial).toBe(true);
  });

  // Someone removed from the class mid-month: on the roster because they were
  // marked, but NOT a trial.
  it("distinguishes a since-removed student from a trial", () => {
    const out = mergeRoster(enrolled, [{ id: "z", full_name: "Zoe Gone" }], []);
    expect(out.find((s) => s.id === "z")?.attendedOnly).toBe(true);
    expect(out.find((s) => s.id === "z")?.isTrial).toBe(false);
  });
});

describe("mergeRoster — make-up bookings", () => {
  // Same stakes as a trial: without this the guest never appears, is never
  // marked, and the billing month can never close.
  it("includes a child booked for a make-up on this date, flagged as one", () => {
    const out = mergeRoster(enrolled, [], [], [{ id: "m", full_name: "Mia Makeup" }]);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "m"]);
    const mia = out.find((s) => s.id === "m");
    expect(mia?.isMakeup).toBe(true);
    expect(mia?.isTrial).toBe(false);
    expect(mia?.attendedOnly).toBe(true);
  });

  it("does not label an enrolled student as a make-up", () => {
    const out = mergeRoster(enrolled, [], [], []);
    expect(out.every((s) => s.isMakeup === false)).toBe(true);
  });

  // A guest the coach has already marked appears in both sources.
  it("shows a booked-and-marked guest once, still flagged as a make-up", () => {
    const out = mergeRoster(
      enrolled,
      [{ id: "m", full_name: "Mia Makeup" }],
      [],
      [{ id: "m", full_name: "Mia Makeup" }]
    );
    expect(out.filter((s) => s.id === "m")).toHaveLength(1);
    expect(out.find((s) => s.id === "m")?.isMakeup).toBe(true);
  });

  // A trial child cannot be enrolled, so trial + make-up on one child is a
  // data error — the safer label for the coach is "Trial", exactly once.
  it("lets a trial booking win the label if both somehow exist", () => {
    const out = mergeRoster(
      enrolled,
      [],
      [{ id: "w", full_name: "Weird Both" }],
      [{ id: "w", full_name: "Weird Both" }]
    );
    expect(out.filter((s) => s.id === "w")).toHaveLength(1);
    const w = out.find((s) => s.id === "w");
    expect(w?.isTrial).toBe(true);
    expect(w?.isMakeup).toBe(false);
  });
});

// ── A CHILD WITH TWO ENROLMENT ROWS IN ONE CLASS ────────────────────────────
// The caller builds `activeStudents` from enrolment ROWS, and unenrol/re-enrol
// keeps history (PRD §11.5), so two spans can both cover one date. A duplicate
// here is not cosmetic: the screen saves the whole class in ONE upsert, so two
// rows with the same (lesson_session_id, student_id) make Postgres refuse the
// entire statement — "ON CONFLICT DO UPDATE command cannot affect row a second
// time" — and nobody in the class can be marked. Surfaced in production after
// every active enrolment was backdated. §7.66.
describe("mergeRoster — duplicate enrolment rows", () => {
  const twice: RosterStudent[] = [
    { id: "a", full_name: "Amy Enrolled" },
    { id: "b", full_name: "Ben Enrolled" },
    { id: "a", full_name: "Amy Enrolled" }, // re-enrolled; both spans cover the date
  ];

  it("lists a doubly-enrolled child exactly once", () => {
    expect(mergeRoster(twice, []).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("keeps the FIRST occurrence, so the caller's order survives", () => {
    const out = mergeRoster(twice, []);
    expect(out.map((s) => s.full_name)).toEqual(["Amy Enrolled", "Ben Enrolled"]);
    expect(out.every((s) => s.attendedOnly === false)).toBe(true);
  });

  it("still produces one row per student when they are also marked and booked", () => {
    const out = mergeRoster(
      twice,
      [{ id: "a", full_name: "Amy Enrolled" }],
      [{ id: "a", full_name: "Amy Enrolled" }]
    );
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("guarantees no id repeats, whatever the inputs overlap", () => {
    const out = mergeRoster(
      [...twice, { id: "b", full_name: "Ben Enrolled" }],
      [{ id: "z", full_name: "Zoe WalkIn" }, { id: "z", full_name: "Zoe WalkIn" }],
      [{ id: "z", full_name: "Zoe WalkIn" }]
    );
    const ids = out.map((s) => s.id);
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids).toEqual(["a", "b", "z"]);
  });
});
