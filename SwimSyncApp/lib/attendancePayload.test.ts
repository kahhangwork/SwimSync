import {
  buildAttendanceRows,
  hasUniformKeys,
  type AttendanceRowInput,
} from "./attendancePayload";

const SESSION = "ac1aebcb-0bf3-42f4-9566-116400adcf5f";
const COACH = "c0000000-0000-0000-0000-000000000001";

// The production shape that broke: a lesson where two of five children had
// already been marked and three had not. §7.67.
const PARTIALLY_MARKED: AttendanceRowInput[] = [
  { studentId: "aayra", status: "present" },
  { studentId: "swan", status: "present" },
  { studentId: "ashlyn", status: "absent" },
  { studentId: "aadi", status: "absent" },
  { studentId: "anya", status: "absent" },
];

describe("buildAttendanceRows", () => {
  // THE REGRESSION. supabase-js derives `columns=` from the union of keys
  // across all rows, and PostgREST gives a row that omits a key NULL rather
  // than the column default. A single `id` on one row therefore inserted NULL
  // ids for every other row and Postgres refused the whole statement.
  it("never sends `id` — onConflict identifies the row, the PK would only add NULLs", () => {
    const rows = buildAttendanceRows(SESSION, COACH, PARTIALLY_MARKED);
    expect(rows.some((r) => "id" in r)).toBe(false);
  });

  it("gives every row an identical key set, whatever the statuses", () => {
    const rows = buildAttendanceRows(SESSION, COACH, PARTIALLY_MARKED);
    expect(hasUniformKeys(rows)).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "last_edited_by",
      "lesson_session_id",
      "marked_by",
      "status",
      "student_id",
    ]);
  });

  it("points every row at the session it was given", () => {
    const rows = buildAttendanceRows(SESSION, COACH, PARTIALLY_MARKED);
    expect(rows.every((r) => r.lesson_session_id === SESSION)).toBe(true);
    expect(rows).toHaveLength(5);
  });

  it("attributes the save to the acting coach on both columns", () => {
    const rows = buildAttendanceRows(SESSION, COACH, PARTIALLY_MARKED);
    expect(rows.every((r) => r.marked_by === COACH)).toBe(true);
    expect(rows.every((r) => r.last_edited_by === COACH)).toBe(true);
  });

  it("carries each student's own status through", () => {
    const rows = buildAttendanceRows(SESSION, COACH, PARTIALLY_MARKED);
    expect(rows.map((r) => `${r.student_id}=${r.status}`)).toEqual([
      "aayra=present",
      "swan=present",
      "ashlyn=absent",
      "aadi=absent",
      "anya=absent",
    ]);
  });

  it("returns nothing for an empty class rather than a malformed row", () => {
    expect(buildAttendanceRows(SESSION, COACH, [])).toEqual([]);
  });
});

describe("hasUniformKeys", () => {
  it("is true for an empty list", () => {
    expect(hasUniformKeys([])).toBe(true);
  });

  it("catches exactly the shape that broke production", () => {
    expect(
      hasUniformKeys([
        { id: "a", lesson_session_id: SESSION, student_id: "x", status: "present" },
        { lesson_session_id: SESSION, student_id: "y", status: "absent" },
      ])
    ).toBe(false);
  });

  it("ignores key ORDER, which does not affect the column list", () => {
    expect(
      hasUniformKeys([
        { a: 1, b: 2 },
        { b: 3, a: 4 },
      ])
    ).toBe(true);
  });
});
