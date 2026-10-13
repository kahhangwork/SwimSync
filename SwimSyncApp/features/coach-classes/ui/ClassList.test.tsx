// ClassList — the coach Classes tab's cards. Pinned (UI restyle step 2.3): the
// student count reads as a plural-correct plain count — "1 student", "2 students",
// "0 students" — never the audit's "1 students"; and a press on the card's title
// opens that class's roster (the drivers press the title).
//
// MUTATION PROOFS (§7.25) — each applied to ClassList.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `formatAttendees(cls.student_count, 0)` → `` `${cls.student_count} students` ``
//      → RED: "the count is plural-correct plain text"
//   2. `/(coach)/classes/${cls.id}/roster` → `/(coach)/classes`
//      → RED: "pressing a card's title opens that class's roster"
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { router } from "expo-router";
import { ClassList } from "./ClassList";
import { groupByWeekday } from "../domain/weekOrder";
import type { CoachClass } from "../types";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

const cls = (id: string, title: string, n: number): CoachClass => ({
  id, title, day_of_week: "saturday", start_time: "10:00", end_time: "11:00",
  location_id: "l1", location_name: "Pool A", price_per_lesson: 25, student_count: n,
});

function renderList(classes: CoachClass[]) {
  const groups = groupByWeekday(classes, (c) => c.day_of_week, "saturday");
  render(<ClassList loading={false} classes={classes} groups={groups} />);
}

describe("ClassList", () => {
  it("the count is plural-correct plain text", () => {
    renderList([cls("a", "Tadpoles", 1), cls("b", "Dolphins", 2), cls("c", "Empty", 0)]);
    expect(screen.getByText("1 student")).toBeTruthy();
    expect(screen.getByText("2 students")).toBeTruthy();
    expect(screen.getByText("0 students")).toBeTruthy();
    expect(screen.queryByText("1 students")).toBeNull();
  });

  it("pressing a card's title opens that class's roster", () => {
    renderList([cls("a", "Tadpoles", 1), cls("b", "Dolphins", 2)]);
    fireEvent.press(screen.getByText("Dolphins"));
    expect(router.push).toHaveBeenLastCalledWith("/(coach)/classes/b/roster");
  });

  it("today's group is headed 'Today · Saturday'", () => {
    renderList([cls("a", "Tadpoles", 1)]);
    expect(screen.getByText("Today · Saturday")).toBeTruthy();
  });

  it("no classes → says so", () => {
    render(<ClassList loading={false} classes={[]} groups={[]} />);
    expect(screen.getByText("No classes assigned yet")).toBeTruthy();
  });
});
