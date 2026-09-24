// CHARACTERISATION test (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 2): pins the pure
// half of the marking screen's load() as it was inline on the route. §7.25's
// prove-it-red rule does not apply — there is no fix, only a move. The eight
// named cases are the plan's §6 Stage 2 ASSERTIONS.
import {
  cancelledBlock,
  enrolledOn,
  guestRows,
  initialAttendance,
  loadedStatusesOf,
  shadowRows,
} from "./attendanceRows";

const enr = (id: string, enrolled_at: string, unenrolled_at: string | null = null) => ({
  enrolled_at,
  unenrolled_at,
  students: { id, full_name: `Kid ${id}` },
});

describe("attendanceRows (characterisation)", () => {
  it("1. both span ends are inclusive; a null unenrolled_at is open-ended", () => {
    const rows = enrolledOn(
      [
        enr("opens", "2026-09-05T02:00:00Z"),                          // opens ON the date
        enr("closes", "2026-08-01T02:00:00Z", "2026-09-05T02:00:00Z"), // closes ON the date
        enr("walkin", "2026-09-05T02:00:00Z", "2026-09-05T02:00:00Z"), // trial walk-in, own date
        enr("later", "2026-09-06T02:00:00Z"),                          // joins after
        enr("left", "2026-08-01T02:00:00Z", "2026-09-04T02:00:00Z"),   // left before
      ],
      "2026-09-05"
    );
    expect(rows.map((r) => r.id)).toEqual(["opens", "closes", "walkin"]);
    expect(rows[0]).toEqual({ id: "opens", full_name: "Kid opens" });
  });

  it("2. timestamptz ends are read as SG dates — 23:30Z is the NEXT SG day", () => {
    // 2026-09-04T23:30Z = 2026-09-05 07:30 SGT.
    expect(enrolledOn([enr("a", "2026-09-04T23:30:00Z")], "2026-09-04")).toEqual([]);
    expect(enrolledOn([enr("a", "2026-09-04T23:30:00Z")], "2026-09-05")).toHaveLength(1);
    // …and an unenrolment at 23:30Z on the 4th still covers the 5th.
    expect(
      enrolledOn([enr("b", "2026-08-01T02:00:00Z", "2026-09-04T23:30:00Z")], "2026-09-05")
    ).toHaveLength(1);
  });

  it("enrolledOn: a null/undefined enrolment list is an empty roster", () => {
    expect(enrolledOn(null, "2026-09-05")).toEqual([]);
    expect(enrolledOn(undefined, "2026-09-05")).toEqual([]);
  });

  const roster = [
    { id: "s1", full_name: "A" },
    { id: "s2", full_name: "B" },
    { id: "s3", full_name: "C" },
  ];

  it("3. with no session (sid null) every row is unmarked and attendance is ignored", () => {
    const att = [{ student_id: "s1", status: "present" }];
    expect(initialAttendance(roster, att, null)).toEqual({
      s1: { top: "unmarked", sub: null },
      s2: { top: "unmarked", sub: null },
      s3: { top: "unmarked", sub: null },
    });
  });

  it("4. with a session: a record parses, a missing one is unmarked, holiday reads as holiday", () => {
    const att = [
      { student_id: "s1", status: "cancelled_rain" },
      { student_id: "s3", status: "holiday" },
    ];
    expect(initialAttendance(roster, att, "sess")).toEqual({
      s1: { top: "cancelled", sub: "rain" },
      s2: { top: "unmarked", sub: null },
      s3: { top: "holiday", sub: null },
    });
    // null attData with a session: everyone unmarked, no throw.
    expect(initialAttendance(roster, null, "sess").s1).toEqual({ top: "unmarked", sub: null });
  });

  it("5. loadedStatusesOf maps holiday -> null and unmarked -> null (what the credit-note guard compares)", () => {
    expect(
      loadedStatusesOf({
        s1: { top: "present", sub: null },
        s2: { top: "unmarked", sub: null },
        s3: { top: "holiday", sub: null },
        s4: { top: "trial", sub: "paid" },
      })
    ).toEqual({ s1: "present", s2: null, s3: null, s4: "trial_paid" });
  });

  it("6. shadowRows: missing name -> 'Unknown coach'; absent -> not present; null -> []", () => {
    expect(
      shadowRows([
        { coach_id: "c1", full_name: "Tan", absent: false },
        { coach_id: "c2", full_name: null, absent: true },
      ])
    ).toEqual([
      { coach_id: "c1", name: "Tan", present: true },
      { coach_id: "c2", name: "Unknown coach", present: false },
    ]);
    expect(shadowRows(null)).toEqual([]);
  });

  it("7. guestRows drops a row whose students join is null, keeps id + full_name only", () => {
    expect(
      guestRows([
        { student_id: "x", students: null },
        { student_id: "y", students: { id: "y", full_name: "Yan", extra: 1 } },
      ])
    ).toEqual([{ id: "y", full_name: "Yan" }]);
    expect(guestRows(undefined)).toEqual([]);
  });

  // Was pinned as "a cold open reads 'this lesson'" — the caller passed the stale
  // `classTitle` state. load() passes cls.title since 2026-09-24
  // (useAttendanceLoad.test.ts proves it), so the class's name is the ordinary
  // case and '' is only the empty-title fallback.
  it("8. cancelledBlock: names the class; a reason gets ' — '; no reason, no dash; '' -> 'this lesson'", () => {
    const named = cancelledBlock("Tadpoles", "2026-09-05", null);
    expect(named).toEqual({
      ok: false,
      title: "This lesson was cancelled",
      detail:
        "Your business's admin cancelled Tadpoles on Sat, 5 Sept 2026. Nothing is marked for a cancelled lesson; if it is going ahead after all, ask them to restore it.",
    });
    const withReason = cancelledBlock("Tadpoles", "2026-09-05", "Pool closed");
    expect(withReason.ok).toBe(false);
    if (!withReason.ok) {
      expect(withReason.detail).toContain("cancelled Tadpoles on Sat, 5 Sept 2026 — Pool closed. Nothing");
    }
    const untitled = cancelledBlock("", "2026-09-05", null);
    expect(untitled.ok).toBe(false);
    if (!untitled.ok) {
      expect(untitled.detail).toContain("cancelled this lesson on Sat, 5 Sept 2026. Nothing");
    }
  });
});
