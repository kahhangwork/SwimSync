import { describe, it, expect } from "vitest";
import { unmarkedOverrideLessons } from "./coachDisableImpact";

// Timestamps chosen so their SGT date is unambiguous (midday SGT = 04:00 UTC).
const ts = (d: string) => `${d}T04:00:00+00:00`;

const TODAY = "2026-08-13";

const session = (id: string, date: string, classId = "cls-1") => ({
  id,
  class_id: classId,
  title: classId === "cls-1" ? "Target Lane" : "Other Lane",
  session_date: date,
});

const enrolment = (
  studentId: string,
  classId = "cls-1",
  from = "2026-07-01",
  until: string | null = null
) => ({
  class_id: classId,
  student_id: studentId,
  is_active: until === null,
  enrolled_at: ts(from),
  unenrolled_at: until ? ts(until) : null,
});

describe("unmarkedOverrideLessons (⚠ RISK 8 dialog list)", () => {
  it("reports a past override lesson with no marks at all", () => {
    const out = unmarkedOverrideLessons(
      [session("s1", "2026-08-08")],
      [enrolment("kid-1")],
      [],
      [],
      TODAY
    );
    expect(out).toEqual([
      {
        sessionId: "s1",
        title: "Target Lane",
        sessionDate: "2026-08-08",
        unmarkedCount: 1,
      },
    ]);
  });

  it("omits a fully marked lesson", () => {
    const out = unmarkedOverrideLessons(
      [session("s1", "2026-08-08")],
      [enrolment("kid-1")],
      [{ lesson_session_id: "s1", student_id: "kid-1" }],
      [],
      TODAY
    );
    expect(out).toEqual([]);
  });

  it("omits FUTURE lessons — their overrides are deleted by the RPC, nothing falls to the admin", () => {
    const out = unmarkedOverrideLessons(
      [session("s1", "2026-08-15")],
      [enrolment("kid-1")],
      [],
      [],
      TODAY
    );
    expect(out).toEqual([]);
  });

  it("includes TODAY's lesson — its override is kept, so its marking falls to the admin", () => {
    const out = unmarkedOverrideLessons(
      [session("s1", TODAY)],
      [enrolment("kid-1")],
      [],
      [],
      TODAY
    );
    expect(out).toHaveLength(1);
  });

  it("a booked guest makes an otherwise-marked lesson unmarked (the §7.18 rule: guests are expected)", () => {
    const out = unmarkedOverrideLessons(
      [session("s1", "2026-08-08")],
      [enrolment("kid-1")],
      [{ lesson_session_id: "s1", student_id: "kid-1" }],
      [{ class_id: "cls-1", student_id: "guest-1", session_date: "2026-08-08" }],
      TODAY
    );
    expect(out).toEqual([
      {
        sessionId: "s1",
        title: "Target Lane",
        sessionDate: "2026-08-08",
        unmarkedCount: 1,
      },
    ]);
  });

  it("expectation is span-scoped: a child who joined AFTER the lesson is not expected at it", () => {
    const out = unmarkedOverrideLessons(
      [session("s1", "2026-08-08")],
      [
        enrolment("kid-1"),
        enrolment("kid-late", "cls-1", "2026-08-10"),
      ],
      [{ lesson_session_id: "s1", student_id: "kid-1" }],
      [],
      TODAY
    );
    expect(out).toEqual([]);
  });

  it("sorts ascending by date and counts per-lesson", () => {
    const out = unmarkedOverrideLessons(
      [session("s2", "2026-08-08"), session("s1", "2026-08-01")],
      [enrolment("kid-1"), enrolment("kid-2")],
      [{ lesson_session_id: "s2", student_id: "kid-1" }],
      [],
      TODAY
    );
    expect(out.map((l) => l.sessionDate)).toEqual([
      "2026-08-01",
      "2026-08-08",
    ]);
    expect(out.map((l) => l.unmarkedCount)).toEqual([2, 1]);
  });
});
