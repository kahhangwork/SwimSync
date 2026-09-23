// CHARACTERISATION test (docs/refactor/BATCH_FGH_PLAN.md, App L-H): pins what the
// parent Attendance tab's row mappings already did when they moved out of the
// route file. §7.25's prove-it-red rule does not apply — there is no fix, only a
// move. Each guarded line was mutated once and a named case went red (playbook §5).
import {
  matchesFilter,
  timeLabel,
  childrenOf,
  recordsOf,
  activeClassesOf,
  hasExpectedLessonOf,
  enrolmentInputsOf,
  makeupInputsOf,
  extraInputsOf,
  cancelledInputsOf,
} from "./attendanceFormat";

describe("attendanceFormat (characterisation)", () => {
  it("matchesFilter: each chip's statuses; All matches everything", () => {
    expect(matchesFilter("holiday", "All")).toBe(true);
    expect(matchesFilter("present", "Present")).toBe(true);
    expect(matchesFilter("absent", "Present")).toBe(false);
    expect(matchesFilter("cancelled_rain", "Cancelled")).toBe(true);
    expect(matchesFilter("cancelled_coach", "Cancelled")).toBe(true);
    expect(matchesFilter("trial_free", "Trial")).toBe(true);
    expect(matchesFilter("holiday", "Trial")).toBe(false);
  });

  it("timeLabel: start – end, start alone, or empty", () => {
    expect(timeLabel("17:00:00", "17:45:00")).toBe("5:00 PM – 5:45 PM");
    expect(timeLabel("09:00:00", null)).toBe("9:00 AM");
    expect(timeLabel(null, null)).toBe("");
  });

  it("childrenOf / recordsOf: the link rows flattened; history newest first, missing embeds defaulted", () => {
    expect(childrenOf([{ students: { id: "s", full_name: "A B", assignment_status: "assigned", is_active: true } }])).toEqual([
      { id: "s", full_name: "A B", assignment_status: "assigned", is_active: true },
    ]);
    const recs = recordsOf([
      { id: "1", status: "present", lesson_sessions: { session_date: "2026-08-01", classes: { title: "Dolphins" } } },
      { id: "2", status: "absent", lesson_sessions: { session_date: "2026-08-15", classes: null } },
      { id: "3", status: "holiday", lesson_sessions: null },
    ]);
    expect(recs.map((r) => r.id)).toEqual(["2", "1", "3"]);
    expect(recs[0].class_title).toBe("Class");
    expect(recs[2].session_date).toBe("");
  });

  it("hasExpectedLessonOf: ANY active enrolment with a due lesson; a missing weekday or join date never counts", () => {
    const cls = (day: string | null) => ({ day_of_week: day, id: "c", title: "T" });
    // 2026-09-05 is a Saturday.
    const due = activeClassesOf([{ enrolled_at: "2026-08-01T00:00:00+08:00", classes: [cls("saturday")] }]);
    expect(due[0].cls.day_of_week).toBe("saturday"); // array embed normalised
    expect(hasExpectedLessonOf(due, "2026-09-05")).toBe(true);
    const joinedToday = activeClassesOf([{ enrolled_at: "2026-09-06T00:00:00+08:00", classes: cls("saturday") }]);
    expect(hasExpectedLessonOf(joinedToday, "2026-09-06")).toBe(false);
    expect(hasExpectedLessonOf(activeClassesOf([{ enrolled_at: "2026-08-01", classes: cls(null) }]), "2026-09-05")).toBe(false);
    expect(hasExpectedLessonOf(activeClassesOf([{ enrolled_at: null, classes: cls("saturday") }]), "2026-09-05")).toBe(false);
    expect(activeClassesOf(null)).toEqual([]);
  });

  it("enrolmentInputsOf drops classes with no weekday or title and labels the time", () => {
    const out = enrolmentInputsOf(
      activeClassesOf([
        { classes: { id: "c1", day_of_week: "monday", title: "Dolphins", start_time: "17:00:00", end_time: "17:45:00" } },
        { classes: { id: "c2", day_of_week: null, title: "X" } },
        { classes: { id: "c3", day_of_week: "friday", title: null } },
      ])
    );
    expect(out).toEqual([{ class_id: "c1", day_of_week: "monday", class_title: "Dolphins", time_label: "5:00 PM – 5:45 PM" }]);
  });

  it("makeup / extra / cancelled inputs: per-row fallbacks (booking-id key, titles, reason)", () => {
    expect(makeupInputsOf([{ id: "b1", session_date: "2026-09-10", classes: null }])).toEqual([
      { class_id: "makeup:b1", class_title: "another class", session_date: "2026-09-10", time_label: "" },
    ]);
    expect(extraInputsOf([{ class_id: "c", session_date: "2026-09-11", start_time: "10:00:00", end_time: null, classes: [] }])[0]).toEqual({
      class_id: "c",
      class_title: "Extra lesson",
      session_date: "2026-09-11",
      time_label: "10:00 AM",
    });
    expect(cancelledInputsOf([{ class_id: "c", session_date: "2026-09-12", classes: { title: "Dolphins" }, cancellation_reason: "Pool closed" }])[0]).toMatchObject({
      class_title: "Dolphins",
      reason: "Pool closed",
    });
    expect(cancelledInputsOf([{ class_id: "c", session_date: "2026-09-12", classes: null }])[0]).toMatchObject({ class_title: "Lesson", reason: null });
    expect(makeupInputsOf(null)).toEqual([]);
  });
});
