// ChildrenSection — one tag per child card, and only for a state that is not
// routine (UI restyle step 3.4; BACKLOG fold-in: a green "Assigned" on every card
// said nothing). Pinned: an active, assigned child has no status tag; Unassigned and
// Inactive keep theirs; the payment line stays directly under the name (the
// package drivers read "<name>\n<line>").
//
// MUTATION PROOFS (§7.25) — each applied to ChildrenSection.tsx and run red:
//   1. `{!routine && (` → `{(` → RED: "an active, assigned child carries no tag"
//   2. `const routine = child.is_active && …` → `const routine = child.is_active`
//      → RED: "an unassigned child is tagged Unassigned"
import React from "react";
import { render, screen, within } from "@testing-library/react-native";
import { ChildrenSection } from "./ChildrenSection";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: ChildrenSection test reached the real supabase client");
});

type Props = Parameters<typeof ChildrenSection>[0];
type Child = Props["children"][number];

const child = (over: Partial<Child>): Child =>
  ({
    id: "k1",
    full_name: "Ava Tan",
    assignment_status: "assigned",
    is_active: true,
    classes: [{ day: "monday", time: "4:00 PM", coach_name: "Coach D", location: "Pool A" }],
    trial: null,
    makeup: null,
    ...over,
  }) as Child;

function setup(c: Child) {
  render(<ChildrenSection loading={false} children={[c]} covMap={new Map()} />);
}

it("an active, assigned child carries no tag", () => {
  setup(child({}));
  expect(screen.getByText("Ava Tan")).toBeTruthy();
  expect(screen.queryByText("Assigned")).toBeNull();
});

it("an unassigned child is tagged Unassigned", () => {
  setup(child({ assignment_status: "unassigned", classes: [] }));
  expect(screen.getByText("Unassigned")).toBeTruthy();
});

it("the payment line sits directly under the name", () => {
  render(
    <ChildrenSection
      loading={false}
      children={[child({})]}
      covMap={new Map([["k1", { parentId: "p", tenantId: "t", coverage: "package", lessonsRemaining: 9, packageId: "pk" }]])}
    />
  );
  // Name and line share one column (the name's host parent), name first.
  let col = screen.getByText("Ava Tan").parent!;
  while (typeof col.type !== "string") col = col.parent!;
  expect(within(col).getByText("Package · 9 left")).toBeTruthy();
  const flat = JSON.stringify(screen.toJSON());
  expect(flat.indexOf("Ava Tan")).toBeLessThan(flat.indexOf("\"Package\""));
});

it("an inactive child is tagged Inactive", () => {
  setup(child({ is_active: false }));
  expect(screen.getByText("Inactive")).toBeTruthy();
});
