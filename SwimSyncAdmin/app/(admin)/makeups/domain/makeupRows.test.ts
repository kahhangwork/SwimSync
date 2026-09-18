import { describe, it, expect } from "vitest";
import {
  datesForClass,
  expiryWarningFor,
  homeClassOf,
  hostChoicesFor,
  toBookings,
  toEligible,
  toExtraMap,
  toLivePackages,
  toParentsOf,
} from "./makeupRows";
import type { ClassRow, EligibleKid, LivePackage } from "../types";

// Characterisation: pins what page.tsx computed before it moved here (Admin
// L-D). A change to any of these is a behaviour change, not a refactor.

const GROUP = "cat-group";
const PRIVATE = "cat-private";
const classes: ClassRow[] = [
  { id: "sat-a", title: "Sat A", day_of_week: "saturday", category_id: GROUP },
  { id: "sat-b", title: "Sat B", day_of_week: "saturday", category_id: GROUP },
  { id: "sun-a", title: "Sun A", day_of_week: "sunday", category_id: GROUP },
  { id: "pvt", title: "Private", day_of_week: "monday", category_id: PRIVATE },
];
const oneClassKid: EligibleKid = {
  id: "k1", full_name: "One", home_classes: [{ id: "sat-a", title: "Sat A", category_id: GROUP }],
};
const twoClassKid: EligibleKid = {
  id: "k2", full_name: "Two",
  home_classes: [
    { id: "sat-a", title: "Sat A", category_id: GROUP },
    { id: "pvt", title: "Private", category_id: PRIVATE },
  ],
};

describe("toBookings", () => {
  it("marks by student+date, and falls back to — / '' for hidden embeds", () => {
    const books = [
      { id: "b1", session_date: "2026-09-12", student_id: "s1", students: { full_name: "Ann" }, classes: { title: "Sat B" } },
      { id: "b2", session_date: "2026-09-19", student_id: null, students: null, classes: null },
    ];
    const att = [{ student_id: "s1", lesson_sessions: { session_date: "2026-09-12" } }];
    expect(toBookings(books, att)).toEqual([
      { id: "b1", session_date: "2026-09-12", student_id: "s1", student_name: "Ann", class_title: "Sat B", marked: true },
      { id: "b2", session_date: "2026-09-19", student_id: "", student_name: "—", class_title: "—", marked: false },
    ]);
    expect(toBookings(null, null)).toEqual([]);
  });
});

describe("toEligible", () => {
  it("keeps ACTIVE children with at least one ACTIVE enrolment, listing every class", () => {
    const kids = [
      { id: "a", full_name: "Active", is_active: true, student_class_enrolments: [
        { is_active: true, classes: { id: "sat-a", title: "Sat A", category_id: GROUP } },
        { is_active: false, classes: { id: "sun-a", title: "Sun A", category_id: GROUP } },
        { is_active: true, classes: null },
      ] },
      { id: "b", full_name: "Inactive", is_active: false, student_class_enrolments: [
        { is_active: true, classes: { id: "sat-a", title: "Sat A", category_id: GROUP } },
      ] },
      { id: "c", full_name: "Unenrolled", is_active: true, student_class_enrolments: null },
    ];
    expect(toEligible(kids)).toEqual([
      { id: "a", full_name: "Active", home_classes: [{ id: "sat-a", title: "Sat A", category_id: GROUP }] },
    ]);
  });
});

describe("toExtraMap / toParentsOf / toLivePackages", () => {
  it("groups off-schedule dates by class", () => {
    const m = toExtraMap([
      { class_id: "sat-a", session_date: "2026-09-30" },
      { class_id: "sat-a", session_date: "2026-10-01" },
    ]);
    expect(m.get("sat-a")).toEqual(["2026-09-30", "2026-10-01"]);
    expect(toExtraMap(null).size).toBe(0);
  });

  it("groups parents by student", () => {
    expect(toParentsOf([
      { student_id: "k1", parent_id: "p1" },
      { student_id: "k1", parent_id: "p2" },
    ]).get("k1")).toEqual(["p1", "p2"]);
  });

  it("drops packages expired before today (string compare), defaults the rest", () => {
    expect(toLivePackages([
      { parent_id: "p1", category_id: null, expires_on: "2026-09-18", live_lessons_remaining: "3" },
      { parent_id: "p1", category_id: GROUP, expires_on: "2026-09-17", live_lessons_remaining: 5 },
      { parent_id: "p2", expires_on: null },
    ], "2026-09-18")).toEqual([
      { parent_id: "p1", category_id: null, expires_on: "2026-09-18", live_lessons_remaining: 3 },
    ]);
  });
});

describe("homeClassOf", () => {
  it("auto-picks a single-class child's home; asks a multi-class child", () => {
    expect(homeClassOf(oneClassKid, "")?.id).toBe("sat-a");
    expect(homeClassOf(twoClassKid, "")).toBeUndefined();
    expect(homeClassOf(twoClassKid, "pvt")?.id).toBe("pvt");
    expect(homeClassOf(undefined, "")).toBeUndefined();
  });
});

describe("hostChoicesFor", () => {
  it("same category as the CHOSEN home, minus EVERY class the child is in", () => {
    expect(hostChoicesFor(oneClassKid, oneClassKid.home_classes[0], classes).map((c) => c.id))
      .toEqual(["sat-b", "sun-a"]);
    // Two-class child choosing the group home: their private class is not a host,
    // and neither is Sat A (their own).
    expect(hostChoicesFor(twoClassKid, twoClassKid.home_classes[0], classes).map((c) => c.id))
      .toEqual(["sat-b", "sun-a"]);
    // Choosing the private home: the only private class is their own — nothing.
    expect(hostChoicesFor(twoClassKid, twoClassKid.home_classes[1], classes)).toEqual([]);
    expect(hostChoicesFor(twoClassKid, undefined, classes)).toEqual([]);
    // ⚠ THE LOAD-BEARING CASE: both classes in ONE category. Excluding only the
    // chosen home would offer Sat B — the lesson the child already attends,
    // which silently voids the make-up.
    const sameCategoryKid: EligibleKid = {
      id: "k3", full_name: "Three",
      home_classes: [
        { id: "sat-a", title: "Sat A", category_id: GROUP },
        { id: "sat-b", title: "Sat B", category_id: GROUP },
      ],
    };
    expect(hostChoicesFor(sameCategoryKid, sameCategoryKid.home_classes[0], classes).map((c) => c.id))
      .toEqual(["sun-a"]);
  });
});

describe("datesForClass", () => {
  it("weekday pattern from 21 days back to 70 ahead, plus off-schedule extras, sorted and deduped", () => {
    const extras = new Map([["sat-b", ["2026-09-30", "2026-09-19"]]]);
    const dates = datesForClass(classes, extras, "sat-b", "2026-09-18");
    expect(dates[0]).toBe("2026-08-29"); // first Saturday on/after 2026-08-28
    expect(dates.at(-1)).toBe("2026-11-21"); // last Saturday on/before 2026-11-27
    expect(dates).toContain("2026-09-30"); // a Wednesday extra lesson
    expect(dates.filter((d) => d === "2026-09-19")).toHaveLength(1); // deduped
    expect([...dates].sort()).toEqual(dates);
    expect(datesForClass(classes, extras, "nope", "2026-09-18")).toEqual([]);
  });
});

describe("expiryWarningFor", () => {
  const parentsOf = new Map([["k1", ["p1"]]]);
  const home = oneClassKid.home_classes[0];
  const pkgs = (expires_on: string, category_id: string | null = GROUP): LivePackage[] => [
    { parent_id: "p1", category_id, expires_on, live_lessons_remaining: 2 },
  ];

  it("warns only when EVERY same-category family package expires before the lesson", () => {
    expect(expiryWarningFor(oneClassKid, "2026-10-10", parentsOf, pkgs("2026-10-01"), home)).toBe(
      "The family's package expires Thu, 1 Oct — this lesson is after that, so it will bill at the class rate instead."
    );
    expect(expiryWarningFor(oneClassKid, "2026-09-25", parentsOf, pkgs("2026-10-01"), home)).toBeNull();
  });

  it("an any-category package counts; another category's does not", () => {
    expect(expiryWarningFor(oneClassKid, "2026-10-10", parentsOf, pkgs("2026-10-01", null), home)).not.toBeNull();
    expect(expiryWarningFor(oneClassKid, "2026-10-10", parentsOf, pkgs("2026-10-01", PRIVATE), home)).toBeNull();
  });

  it("is silent with no child, no date, no parents, or no package", () => {
    expect(expiryWarningFor(undefined, "2026-10-10", parentsOf, pkgs("2026-10-01"), home)).toBeNull();
    expect(expiryWarningFor(oneClassKid, "", parentsOf, pkgs("2026-10-01"), home)).toBeNull();
    expect(expiryWarningFor(oneClassKid, "2026-10-10", new Map(), pkgs("2026-10-01"), home)).toBeNull();
    expect(expiryWarningFor(oneClassKid, "2026-10-10", parentsOf, [], home)).toBeNull();
  });
});
