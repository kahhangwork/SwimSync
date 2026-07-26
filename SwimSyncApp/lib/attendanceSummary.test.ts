import {
  lessonProgress,
  isFinished,
  summariseStatuses,
  formatSummary,
  progressLabel,
  type DbStatus,
  type LessonProgress,
} from "./attendanceSummary";

const ENDED = { hasEnded: true };
const RUNNING = { hasEnded: false };

describe("lessonProgress", () => {
  // ⚠ THE HIGHEST-VALUE TEST IN THIS FILE. The billing gate treats an empty
  // expected set as fully marked, correctly — there is nothing to collect, so it
  // must not block a month. Showing that as a green "Marked" would tell the
  // coach a class was done when nobody had touched it. The branch order is what
  // stops it, so this pins the branch order.
  it("an empty roster is no-students, NEVER complete", () => {
    expect(lessonProgress([], undefined, ENDED)).toEqual({ kind: "no-students" });
    expect(lessonProgress([], new Set(), ENDED)).toEqual({ kind: "no-students" });
    // Even if the lesson somehow has rows for people nobody expected.
    expect(lessonProgress([], new Set(["ghost"]), ENDED)).toEqual({
      kind: "no-students",
    });
  });

  it("is upcoming when nothing is recorded and the lesson has not ended", () => {
    expect(lessonProgress(["a", "b"], undefined, RUNNING)).toEqual({
      kind: "upcoming",
    });
  });

  it("is unmarked once the lesson has ended with nothing recorded", () => {
    expect(lessonProgress(["a", "b"], undefined, ENDED)).toEqual({
      kind: "unmarked",
    });
  });

  // One mark before the class finishes means show progress, not "Upcoming" —
  // otherwise a coach marking as they go sees no evidence of their own work.
  it("shows progress mid-lesson rather than upcoming, once anything is marked", () => {
    expect(lessonProgress(["a", "b"], new Set(["a"]), RUNNING)).toEqual({
      kind: "partial",
      marked: 1,
      total: 2,
    });
  });

  it("is complete when every expected student has a row", () => {
    expect(lessonProgress(["a", "b"], new Set(["a", "b"]), ENDED)).toEqual({
      kind: "complete",
      total: 2,
    });
  });

  // A child removed from the class keeps their attendance row (it still bills),
  // but they are no longer expected. Counting them would push a genuinely
  // incomplete lesson to "complete" and stop the screen asking for the marks it
  // still needs.
  it("a departed student's row cannot complete a lesson they left", () => {
    expect(
      lessonProgress(["a", "b"], new Set(["a", "departed"]), ENDED)
    ).toEqual({ kind: "partial", marked: 1, total: 2 });
  });

  it("never reports more marked than expected", () => {
    const p = lessonProgress(["a"], new Set(["a", "x", "y"]), ENDED);
    expect(p).toEqual({ kind: "complete", total: 1 });
  });
});

describe("isFinished — the button's only escape hatch", () => {
  // The prohibition, as a test. Only `complete` may quiet the CTA; a card that
  // stops asking for marks it still needs is a lesson that never gets marked,
  // and that blocks the month with no override (§8a).
  const ALL: LessonProgress[] = [
    { kind: "no-students" },
    { kind: "upcoming" },
    { kind: "unmarked" },
    { kind: "partial", marked: 1, total: 2 },
    { kind: "complete", total: 2 },
  ];

  it("is true for complete and false for every other state", () => {
    const finished = ALL.filter(isFinished).map((p) => p.kind);
    expect(finished).toEqual(["complete"]);
  });

  // If someone adds a state to the union, this fails until they decide where it
  // belongs — rather than silently inheriting the quiet button.
  it("covers every kind the union can produce", () => {
    const kinds = ALL.map((p) => p.kind).sort();
    expect(kinds).toEqual([
      "complete",
      "no-students",
      "partial",
      "unmarked",
      "upcoming",
    ]);
  });
});

describe("summariseStatuses", () => {
  const statuses = (entries: [string, DbStatus][]) => new Map(entries);

  it("counts each status among the expected students", () => {
    expect(
      summariseStatuses(
        ["a", "b", "c"],
        statuses([
          ["a", "present"],
          ["b", "present"],
          ["c", "absent"],
        ])
      )
    ).toEqual([
      { status: "present", count: 2 },
      { status: "absent", count: 1 },
    ]);
  });

  it("omits statuses that did not occur", () => {
    const out = summariseStatuses(["a"], statuses([["a", "present"]]));
    expect(out).toEqual([{ status: "present", count: 1 }]);
  });

  // Rain and coach bill differently. Collapsing them would hide the one fact
  // that decides whether the lesson is chargeable.
  it("keeps cancelled-rain and cancelled-coach apart", () => {
    expect(
      summariseStatuses(
        ["a", "b"],
        statuses([
          ["a", "cancelled_rain"],
          ["b", "cancelled_coach"],
        ])
      )
    ).toEqual([
      { status: "cancelled_rain", count: 1 },
      { status: "cancelled_coach", count: 1 },
    ]);
  });

  // Scoped to the expected set so the breakdown always sums to the `marked`
  // figure shown beside it.
  it("ignores rows for students who are not expected", () => {
    expect(
      summariseStatuses(
        ["a"],
        statuses([
          ["a", "present"],
          ["departed", "present"],
        ])
      )
    ).toEqual([{ status: "present", count: 1 }]);
  });

  it("orders by status, not by count, so the line does not reshuffle", () => {
    const out = summariseStatuses(
      ["a", "b", "c"],
      statuses([
        ["a", "absent"],
        ["b", "absent"],
        ["c", "present"],
      ])
    );
    expect(out.map((c) => c.status)).toEqual(["present", "absent"]);
  });

  it("is empty when nothing is recorded", () => {
    expect(summariseStatuses(["a", "b"], new Map())).toEqual([]);
  });
});

describe("formatSummary", () => {
  it("renders the example the user asked for", () => {
    expect(
      formatSummary([
        { status: "present", count: 3 },
        { status: "cancelled_rain", count: 2 },
      ])
    ).toBe("3 present · 2 cancelled (rain)");
  });

  it("renders a single status without a separator", () => {
    expect(formatSummary([{ status: "present", count: 2 }])).toBe("2 present");
  });

  // The caller omits the whole line on empty, so this must not produce a
  // dangling separator or a placeholder.
  it("is an empty string when nothing is recorded", () => {
    expect(formatSummary([])).toBe("");
  });

  it("labels every status the enum allows", () => {
    const all: DbStatus[] = [
      "present",
      "absent",
      "cancelled_rain",
      "cancelled_coach",
      "trial_paid",
      "trial_free",
    ];
    const out = formatSummary(all.map((status) => ({ status, count: 1 })));
    expect(out).toBe(
      "1 present · 1 absent · 1 cancelled (rain) · 1 cancelled (coach) · 1 trial (paid) · 1 trial (free)"
    );
  });
});

describe("progressLabel", () => {
  it("words each state the way the card shows it", () => {
    expect(progressLabel({ kind: "no-students" })).toBe("No students");
    expect(progressLabel({ kind: "upcoming" })).toBe("Upcoming");
    expect(progressLabel({ kind: "unmarked" })).toBe("Not marked");
    expect(progressLabel({ kind: "partial", marked: 3, total: 5 })).toBe(
      "3 of 5 marked"
    );
    expect(progressLabel({ kind: "complete", total: 2 })).toBe("Marked");
  });
});
