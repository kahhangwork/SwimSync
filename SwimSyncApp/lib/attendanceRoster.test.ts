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
