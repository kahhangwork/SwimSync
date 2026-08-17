import { describe, it, expect } from "vitest";
import {
  canBookMakeupFromRow,
  isMakeupEligibleStatus,
  makeupHostChoices,
  type HostClass,
} from "./makeupFromAttendance";

describe("isMakeupEligibleStatus", () => {
  it("accepts absent and both cancelled statuses only", () => {
    expect(isMakeupEligibleStatus("absent")).toBe(true);
    expect(isMakeupEligibleStatus("cancelled_rain")).toBe(true);
    expect(isMakeupEligibleStatus("cancelled_coach")).toBe(true);
    expect(isMakeupEligibleStatus("present")).toBe(false);
    expect(isMakeupEligibleStatus("trial_paid")).toBe(false);
    expect(isMakeupEligibleStatus("trial_free")).toBe(false);
  });
});

describe("canBookMakeupFromRow — ⚠ RISK 6", () => {
  it("shows the button only for a missed status on the child's OWN enrolled class", () => {
    expect(canBookMakeupFromRow("absent", true)).toBe(true);
    // guest row: missed status but NOT the child's enrolment → no button
    expect(canBookMakeupFromRow("absent", false)).toBe(false);
    // present on their own class → not a miss, no make-up
    expect(canBookMakeupFromRow("present", true)).toBe(false);
    // a trial row (guest, present-ish) → both reasons fail
    expect(canBookMakeupFromRow("trial_paid", false)).toBe(false);
  });
});

describe("makeupHostChoices", () => {
  const classes: HostClass[] = [
    { id: "home", category_id: "cat1", is_active: true },
    { id: "other-own", category_id: "cat1", is_active: true },
    { id: "host-a", category_id: "cat1", is_active: true },
    { id: "host-b", category_id: "cat1", is_active: true },
    { id: "wrong-cat", category_id: "cat2", is_active: true },
    { id: "retired", category_id: "cat1", is_active: false },
  ];

  it("offers active, same-category classes that are NOT any of the child's own", () => {
    // Child is in both "home" and "other-own".
    const own = new Set(["home", "other-own"]);
    const hosts = makeupHostChoices(classes, "home", own).map((c) => c.id);
    expect(hosts).toEqual(["host-a", "host-b"]);
  });

  it("excludes the child's OTHER own class, not just the home (voids-the-makeup guard)", () => {
    const own = new Set(["home", "other-own"]);
    const hosts = makeupHostChoices(classes, "home", own).map((c) => c.id);
    expect(hosts).not.toContain("other-own");
  });

  it("excludes retired classes and other categories", () => {
    const hosts = makeupHostChoices(classes, "home", new Set(["home"])).map((c) => c.id);
    expect(hosts).not.toContain("retired");
    expect(hosts).not.toContain("wrong-cat");
  });

  it("returns [] when the home class is unknown", () => {
    expect(makeupHostChoices(classes, "ghost", new Set())).toEqual([]);
  });
});
