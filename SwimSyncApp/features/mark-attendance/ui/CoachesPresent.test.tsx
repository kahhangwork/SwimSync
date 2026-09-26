// CoachesPresent — the shadow coaches' presence ticks. Wage-critical: an
// unticked shadow is not paid for the lesson. Pinned: renders nothing without
// shadows or when read-only; a tap flips ONLY that coach's tick.
//
// MUTATION PROOFS (§7.25) — each applied to CoachesPresent.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `x.coach_id === sh.coach_id` → `true` (a tap flips everyone)
//      → RED: "a tap flips only that coach's presence"
//   2. `!readOnly && shadowsHere.length > 0` → `shadowsHere.length > 0`
//      → RED: "renders nothing when read-only or with no shadows"
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import CoachesPresent from "./CoachesPresent";

type Shadow = { coach_id: string; name: string; present: boolean };
const SHADOWS: Shadow[] = [
  { coach_id: "c1", name: "Coach Amy", present: true },
  { coach_id: "c2", name: "Coach Raj", present: true },
];

describe("CoachesPresent", () => {
  it("renders nothing when read-only or with no shadows", () => {
    const a = render(
      <CoachesPresent readOnly shadowsHere={SHADOWS} setShadowsHere={jest.fn()} />
    );
    expect(a.toJSON()).toBeNull();
    a.unmount();
    const b = render(
      <CoachesPresent readOnly={false} shadowsHere={[]} setShadowsHere={jest.fn()} />
    );
    expect(b.toJSON()).toBeNull();
  });

  it("a tap flips only that coach's presence", () => {
    const setShadowsHere = jest.fn();
    render(
      <CoachesPresent readOnly={false} shadowsHere={SHADOWS} setShadowsHere={setShadowsHere} />
    );
    expect(screen.getByText("Coaches present")).toBeTruthy();
    // Pre-ticked: both show a tick.
    expect(screen.getAllByText("✓")).toHaveLength(2);
    fireEvent.press(screen.getByText("Coach Raj"));
    const updater = setShadowsHere.mock.calls[0][0] as (p: Shadow[]) => Shadow[];
    expect(updater(SHADOWS)).toEqual([
      { coach_id: "c1", name: "Coach Amy", present: true },
      { coach_id: "c2", name: "Coach Raj", present: false },
    ]);
  });
});
