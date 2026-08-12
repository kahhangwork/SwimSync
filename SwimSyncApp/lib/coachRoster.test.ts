import {
  coveredOutFrom,
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
  classId: string,
  date: string,
  sessionId = `s-${classId}-${date}`
) => ({
  lesson_session_id: sessionId,
  lesson_sessions: { id: sessionId, class_id: classId, session_date: date },
});

describe("parseAssignments", () => {
  it("flattens the embed into (session, class, date)", () => {
    expect(parseAssignments([row("c1", "2026-08-11", "s1")])).toEqual([
      { sessionId: "s1", classId: "c1", date: "2026-08-11" },
    ]);
  });

  it("accepts the embed as an array, which PostgREST also produces", () => {
    const [a] = parseAssignments([
      {
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
    });
  });

  it("drops a row whose lesson did not come back rather than placing it wrongly", () => {
    expect(
      parseAssignments([{ role: "main", lesson_session_id: "s1" }])
    ).toEqual([]);
  });

  it("drops a row whose embed came back without a class id", () => {
    // The role check this replaced is gone with the column. The malformed-embed
    // guard is what is left, and it is the one that matters: a row that cannot
    // be PLACED must be dropped, never guessed onto a date (§7.64's shape).
    expect(
      parseAssignments([
        {
          lesson_session_id: "s1",
          lesson_sessions: { id: "s1", session_date: "2026-08-11" },
        },
      ])
    ).toEqual([]);
  });

  it("survives null, which is what supabase-js returns on an error", () => {
    expect(parseAssignments(null)).toEqual([]);
  });
});

describe("rosteredDatesByClass", () => {
  const assignments: RosterAssignment[] = parseAssignments([
    row("c1", "2026-08-11"),
    row("c1", "2026-08-04"),
    row("c2", "2026-08-12"),
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
      row("c1", "2026-08-11"),
      row("c1", "2026-08-11"),
    ]);
    expect(rosteredDatesByClass(twice).get("c1")).toEqual(["2026-08-11"]);
  });
});

describe("assignmentsByLesson", () => {
  it("keys by class:date, the same key the Schedule tab already uses", () => {
    const map = assignmentsByLesson(
      parseAssignments([row("c1", "2026-08-11", "s1")])
    );
    expect(map.get(lessonKey("c1", "2026-08-11"))?.sessionId).toBe("s1");
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

  it("is a cover when I am the substitute on a class I do not own", () => {
    expect(lessonRole({ ownsClass: false, isSubstitute: true })).toBe("cover");
  });

  it("is a shadow on a class I am assigned to shadow", () => {
    expect(lessonRole({ ownsClass: false, isClassShadow: true })).toBe("shadow");
  });

  it("is the owner when I am explicitly rostered onto my own class", () => {
    expect(lessonRole({ ownsClass: true, isSubstitute: true })).toBe("owner");
  });

  // ⚠ SUBSTITUTE BEATS SHADOW, mirroring coach_attribution_kind() exactly.
  // One coach can be both — they shadow the class all term and cover one lesson
  // of it. The database PAYS them the substitute rate for that lesson and lets
  // them MARK it, so resolving to "shadow" here would show a read-only screen
  // for a lesson they are required to mark: unmarkable AND un-nagged, the exact
  // shape this whole wave removed.
  it("is a COVER, not a shadow, when I am both on the same lesson", () => {
    expect(
      lessonRole({ ownsClass: false, isSubstitute: true, isClassShadow: true })
    ).toBe("cover");
  });

  it("and canMark agrees — being both must not make the lesson read-only", () => {
    expect(
      canMark(
        lessonRole({ ownsClass: false, isSubstitute: true, isClassShadow: true })
      )
    ).toBe(true);
  });

  // The class's own coach shadowing their own class is refused by
  // assign_class_shadow(), so this input is unbuildable. Kept as an
  // unreachable-state test: if the guard is ever relaxed, the screen must still
  // hand the write to the person the database says is main.
  it("prefers SHADOW over a claimed ownership, because only one of them is trustworthy", () => {
    // ⚠ THIS TEST'S TITLE ONCE SAID "keeps the OWNER role" WHILE ASSERTING
    // "shadow" — pinning the opposite of what it claimed, which is worse than
    // either answer. The honest version: `ownsClass` is a client-side guess
    // that fails OPEN when the session has not hydrated (`!me?.id ||`), so on a
    // deep link every coach "owns" every class; `isClassShadow` is answered
    // server-side and cannot lie. Trusting the guess first showed a shadow a
    // marking screen the database then refused — measured red on
    // verify-coach-roster check 18. The pair is unbuildable anyway:
    // trg_class_shadow_guard refuses a shadow assignment on the class's own
    // coach at the table, not just in the RPC.
    expect(lessonRole({ ownsClass: true, isClassShadow: true })).toBe("shadow");
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

// ─────────────────────────────────────────────────────────────────────────────
// coveredOutFrom — the SUBTRACTION, and why its failure direction is the
// expensive one.
//
// covered out = asked minus mine. Under a subtraction, every way the server's
// answer can be short or reshaped reads as "somebody else is teaching these",
// which REMOVES lessons from the coach's NEEDS MARKING list. Unmarked
// attendance blocks the billing month with no override (§8i) and nothing on any
// screen says why, so an answer that cannot be vouched for must produce the
// EMPTY set — "nobody else has any of these" — not a confident wrong one.
//
// The four hardening cases were each proven red against the naive
// implementation they replaced —
//   asked.filter((id) => !mine.includes(id))
// — before they counted as coverage (§7.25). The one that changes behaviour
// rather than merely covering it is "an id we never asked about": under
// `.includes()` an unasked id is harmlessly ignored, which is exactly how a
// wrong-SHAPED response becomes a confident "you are main on nothing".

const CO_A = "aaaaaaaa-0000-0000-0000-000000000001";
const CO_B = "bbbbbbbb-0000-0000-0000-000000000002";
const CO_C = "cccccccc-0000-0000-0000-000000000003";

const coveredOut = (asked: string[], mine: unknown[]) => [
  ...coveredOutFrom(asked, mine),
];

describe("coveredOutFrom — the ordinary answers", () => {
  it("drops the ids the database did not name as mine", () => {
    expect(coveredOut([CO_A, CO_B, CO_C], [CO_A, CO_C])).toEqual([CO_B]);
  });

  it("treats an empty answer as 'every probed lesson is somebody else's'", () => {
    expect(coveredOut([CO_A, CO_B], [])).toEqual([CO_A, CO_B]);
  });

  it("returns nothing when every asked session is mine", () => {
    expect(coveredOut([CO_A, CO_B], [CO_A, CO_B])).toEqual([]);
  });

  it("collapses duplicates in the asked set", () => {
    expect(coveredOut([CO_A, CO_A, CO_B], [CO_A])).toEqual([CO_B]);
  });

  it("asks nothing, answers nothing", () => {
    expect(coveredOut([], [])).toEqual([]);
  });
});

describe("coveredOutFrom — an answer it cannot vouch for is NOT an answer", () => {
  it("refuses a response of objects rather than ids, instead of hiding everything", () => {
    // What `RETURNS TABLE(id uuid)` would produce. Measured 2026-08-12: the
    // real function returns bare strings — this is what happens if that ever
    // changes underneath us.
    expect(coveredOut([CO_A, CO_B], [{ sessions_i_am_main_on: CO_A }])).toEqual(
      []
    );
  });

  it("refuses an answer naming a session we never asked about", () => {
    expect(coveredOut([CO_A, CO_B], [CO_A, CO_C])).toEqual([]);
  });

  it("refuses a null element", () => {
    expect(coveredOut([CO_A, CO_B], [CO_A, null])).toEqual([]);
  });

  it("refuses a probe large enough that PostgREST could truncate the answer", () => {
    const many = Array.from(
      { length: 201 },
      (_, i) => `dddddddd-0000-0000-0000-${String(i).padStart(12, "0")}`
    );
    expect(coveredOutFrom(many, many.slice(0, 100)).size).toBe(0);
    // …and one under the cap still answers normally, so the cap is a cap and
    // not an off-by-one that disables the feature.
    expect(coveredOutFrom(many.slice(0, 200), many.slice(0, 199)).size).toBe(1);
  });
});
