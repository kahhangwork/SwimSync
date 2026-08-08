import { bucketWeek, type ScheduleLesson } from "./scheduleBuckets";

type L = ScheduleLesson & { id: string };
const L = (id: string, date: string, startTime: string): L => ({
  id,
  classId: `c-${id}`,
  date,
  startTime,
});

// Week of Mon 3 Aug 2026 – Sun 9 Aug 2026. Today is Saturday 8 Aug.
const TODAY = "2026-08-08";
const WEEK: L[] = [
  L("mon-late", "2026-08-03", "17:00"),
  L("mon-early", "2026-08-03", "09:00"),
  L("tue", "2026-08-04", "17:00"),
  L("sat-b", "2026-08-08", "11:15"),
  L("sat-a", "2026-08-08", "10:00"),
  L("sun", "2026-08-09", "08:00"),
];

const ids = (xs: readonly L[]) => xs.map((x) => x.id);

describe("bucketWeek — the three calendar sections", () => {
  const b = bucketWeek(WEEK, TODAY);

  it("puts every lesson in exactly one bucket, losing none", () => {
    const seen = [
      ...ids(b.today),
      ...b.comingUp.flatMap((g) => ids(g.items)),
      ...b.done.flatMap((g) => ids(g.items)),
    ];
    expect(seen.sort()).toEqual(ids(WEEK).sort());
    expect(seen).toHaveLength(WEEK.length);
  });

  it("TODAY holds only today's lessons, earliest first", () => {
    expect(ids(b.today)).toEqual(["sat-a", "sat-b"]);
  });

  it("COMING UP is ascending by date — the next thing first", () => {
    expect(b.comingUp.map((g) => g.date)).toEqual(["2026-08-09"]);
    expect(ids(b.comingUp[0].items)).toEqual(["sun"]);
  });

  it("DONE is DESCENDING by date — most recent first, like the Today backlog", () => {
    expect(b.done.map((g) => g.date)).toEqual(["2026-08-04", "2026-08-03"]);
  });

  it("sorts by start time WITHIN a day, whatever order they arrived in", () => {
    const monday = b.done.find((g) => g.date === "2026-08-03");
    expect(ids(monday!.items)).toEqual(["mon-early", "mon-late"]);
  });

  it("never puts today in COMING UP or DONE", () => {
    const elsewhere = [
      ...b.comingUp.flatMap((g) => ids(g.items)),
      ...b.done.flatMap((g) => ids(g.items)),
    ];
    expect(elsewhere).not.toContain("sat-a");
    expect(elsewhere).not.toContain("sat-b");
  });
});

describe("bucketWeek — a week that is not the current one", () => {
  // The case the marking-state model exists for: on another week there is no
  // TODAY section at all, and the sections must still be meaningful rather
  // than collapsing into one undifferentiated list.
  it("a PAST week is entirely DONE, with no today and nothing coming up", () => {
    const past = [
      L("a", "2026-07-27", "09:00"),
      L("b", "2026-07-29", "17:00"),
    ];
    const b = bucketWeek(past, TODAY);
    expect(b.today).toEqual([]);
    expect(b.comingUp).toEqual([]);
    expect(b.done.map((g) => g.date)).toEqual(["2026-07-29", "2026-07-27"]);
  });

  it("a FUTURE week is entirely COMING UP", () => {
    const future = [
      L("a", "2026-08-11", "17:00"),
      L("b", "2026-08-15", "10:00"),
    ];
    const b = bucketWeek(future, TODAY);
    expect(b.today).toEqual([]);
    expect(b.done).toEqual([]);
    expect(b.comingUp.map((g) => g.date)).toEqual(["2026-08-11", "2026-08-15"]);
  });

  it("today's own lessons never leak into another week's buckets", () => {
    // bucketWeek is given only the selected week's lessons, so a today-dated
    // row simply is not present. Asserting the shape anyway: passing one in
    // would put it in `today`, never silently into done.
    const b = bucketWeek([L("stray", TODAY, "10:00")], TODAY);
    expect(ids(b.today)).toEqual(["stray"]);
    expect(b.done).toEqual([]);
    expect(b.comingUp).toEqual([]);
  });
});

describe("bucketWeek — degenerate inputs", () => {
  it("an empty week gives three empty buckets, not undefined", () => {
    expect(bucketWeek([], TODAY)).toEqual({ today: [], comingUp: [], done: [] });
  });

  it("does not mutate its input", () => {
    const input = [...WEEK];
    const snapshot = ids(input);
    bucketWeek(input, TODAY);
    expect(ids(input)).toEqual(snapshot);
  });

  it("groups several lessons on one day into ONE group, not one each", () => {
    const b = bucketWeek(
      [
        L("x", "2026-08-03", "09:00"),
        L("y", "2026-08-03", "10:00"),
        L("z", "2026-08-03", "11:00"),
      ],
      TODAY
    );
    expect(b.done).toHaveLength(1);
    expect(ids(b.done[0].items)).toEqual(["x", "y", "z"]);
  });
});
