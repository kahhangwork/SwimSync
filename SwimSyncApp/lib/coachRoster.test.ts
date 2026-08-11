import {
  parseAssignments,
  assignmentsByLesson,
  rosteredDatesByClass,
  lessonRole,
  canMark,
  roleBadge,
  roleNotice,
  lessonKey,
  type RosterAssignment,
} from "./coachRoster";

/** The shape PostgREST returns for
 *  `select("role, lesson_session_id, lesson_sessions!inner(id, class_id, session_date)")`. */
const row = (
  role: string,
  classId: string,
  date: string,
  sessionId = `s-${classId}-${date}`
) => ({
  role,
  lesson_session_id: sessionId,
  lesson_sessions: { id: sessionId, class_id: classId, session_date: date },
});

describe("parseAssignments", () => {
  it("flattens the embed into (session, class, date, role)", () => {
    expect(parseAssignments([row("main", "c1", "2026-08-11", "s1")])).toEqual([
      { sessionId: "s1", classId: "c1", date: "2026-08-11", role: "main" },
    ]);
  });

  it("accepts the embed as an array, which PostgREST also produces", () => {
    const [a] = parseAssignments([
      {
        role: "shadow",
        lesson_session_id: "s1",
        lesson_sessions: [
          { id: "s1", class_id: "c1", session_date: "2026-08-11" },
        ],
      },
    ]);
    expect(a).toEqual({
      sessionId: "s1",
      classId: "c1",
      date: "2026-08-11",
      role: "shadow",
    });
  });

  it("drops a row whose lesson did not come back rather than placing it wrongly", () => {
    expect(
      parseAssignments([{ role: "main", lesson_session_id: "s1" }])
    ).toEqual([]);
  });

  it("drops a role the enum does not have", () => {
    expect(parseAssignments([row("assistant", "c1", "2026-08-11")])).toEqual([]);
  });

  it("survives null, which is what supabase-js returns on an error", () => {
    expect(parseAssignments(null)).toEqual([]);
  });
});

describe("rosteredDatesByClass", () => {
  const assignments: RosterAssignment[] = parseAssignments([
    row("main", "c1", "2026-08-11"),
    row("shadow", "c1", "2026-08-04"),
    row("main", "c2", "2026-08-12"),
  ]);

  it("groups the dates per class, ascending", () => {
    const byClass = rosteredDatesByClass(assignments);
    expect(byClass.get("c1")).toEqual(["2026-08-04", "2026-08-11"]);
    expect(byClass.get("c2")).toEqual(["2026-08-12"]);
  });

  // A class I do not own must contribute ONLY the lessons I was assigned to.
  // Every other date of that class is somebody else's lesson.
  it("knows nothing about a class I have no roster row on", () => {
    expect(rosteredDatesByClass(assignments).get("c3")).toBeUndefined();
  });

  it("de-duplicates a date that arrived twice", () => {
    const twice = parseAssignments([
      row("main", "c1", "2026-08-11"),
      row("main", "c1", "2026-08-11"),
    ]);
    expect(rosteredDatesByClass(twice).get("c1")).toEqual(["2026-08-11"]);
  });
});

describe("assignmentsByLesson", () => {
  it("keys by class:date, the same key the Schedule tab already uses", () => {
    const map = assignmentsByLesson(
      parseAssignments([row("shadow", "c1", "2026-08-11")])
    );
    expect(map.get(lessonKey("c1", "2026-08-11"))?.role).toBe("shadow");
    expect(map.get(lessonKey("c1", "2026-08-04"))).toBeUndefined();
  });
});

describe("lessonRole — the absence rule first", () => {
  it("is the owner on my own class with no roster row at all", () => {
    expect(lessonRole({ ownsClass: true })).toBe("owner");
  });

  it("is still the owner when the covered-out answer is FALSE", () => {
    expect(lessonRole({ ownsClass: true, coveredOut: false })).toBe("owner");
  });

  it("is covered when the gate says someone else is main on MY class", () => {
    expect(lessonRole({ ownsClass: true, coveredOut: true })).toBe("covered");
  });

  it("is a cover when I am the roster main on a class I do not own", () => {
    expect(lessonRole({ ownsClass: false, assignment: "main" })).toBe("cover");
  });

  it("is a shadow on someone else's class", () => {
    expect(lessonRole({ ownsClass: false, assignment: "shadow" })).toBe("shadow");
  });

  // The admin can roster a trainee onto a lesson of the trainee's own class.
  // A shadow row means somebody else is main, so ownership does not win.
  it("is a shadow even on my own class when my row says shadow", () => {
    expect(lessonRole({ ownsClass: true, assignment: "shadow" })).toBe("shadow");
  });

  it("is the owner when I am explicitly rostered main on my own class", () => {
    expect(lessonRole({ ownsClass: true, assignment: "main" })).toBe("owner");
  });

  // Not reachable from the Schedule tab, which only builds cards for classes it
  // owns or is rostered on — but the attendance screen can be opened by URL.
  it("fails closed on a class I neither own nor am rostered on", () => {
    expect(lessonRole({ ownsClass: false })).toBe("covered");
  });
});

describe("canMark", () => {
  it("is true for exactly the two roles the write gate allows", () => {
    expect(canMark("owner")).toBe(true);
    expect(canMark("cover")).toBe(true);
  });

  // A trainee who is nagged to mark a lesson the database refuses has a
  // straggler they can never clear — and the month blocks with no override.
  it("is false for a shadow", () => {
    expect(canMark("shadow")).toBe(false);
  });

  it("is false for a lesson someone else is covering", () => {
    expect(canMark("covered")).toBe(false);
  });
});

describe("roleBadge / roleNotice", () => {
  it("adds no furniture to an ordinary lesson", () => {
    expect(roleBadge("owner")).toBeNull();
    expect(roleNotice("owner")).toBeNull();
    expect(roleNotice("cover")).toBeNull();
  });

  it("names the substitute's own lesson as a cover", () => {
    expect(roleBadge("cover")).toBe("Covering");
  });

  it("explains a read-only screen rather than showing dead buttons", () => {
    expect(roleNotice("shadow")?.title).toMatch(/shadow/i);
    expect(roleNotice("covered")?.title).toMatch(/another coach/i);
  });
});
