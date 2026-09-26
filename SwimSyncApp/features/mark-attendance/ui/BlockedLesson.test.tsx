// BlockedLesson — the screen shown INSTEAD of the roster when a date cannot be
// marked (future lesson, closed month behind a sent invoice, not a lesson day).
//
// Load-bearing for billing: a closed lesson sits behind an invoice that has
// already gone out, and a late mark there is a silent over/under-bill. The
// screen must say WHY (the checkMarkableDate reason, verbatim) and offer ONLY a
// way out — no status button may exist, because a press would write a mark the
// database would refuse at best and bill at worst.
//
// MUTATION PROOFS (§7.25) — each applied to BlockedLesson.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `{blocked.detail}` → `{blocked.title}` (reason text dropped)
//      → RED: "shows the refusal's title and its reason, verbatim"
//   2. "Back to class" onPress `() => leaveScreen()` → `() => {}`
//      → RED: "both exits leave the screen …"
//   3. Added a `<Text>Present</Text>` under the reason
//      → RED: "offers no marking control at all"
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import BlockedLesson from "./BlockedLesson";
import { checkMarkableDate } from "@/lib/attendanceWindow";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

function closedLesson() {
  // A real refusal from the rule the screen fronts, not a hand-written one —
  // so a reworded reason still flows through unchanged.
  const check = checkMarkableDate({
    date: "2026-01-05",
    today: "2026-09-27",
    classDayOfWeek: "monday",
    classTitle: "Tadpoles",
    sessionExists: true,
    windowFloor: "2026-08-01",
  });
  if (check.ok) throw new Error("fixture: expected a refusal");
  return check;
}

describe("BlockedLesson", () => {
  it("shows the refusal's title and its reason, verbatim", () => {
    const blocked = closedLesson();
    render(
      <BlockedLesson
        classTitle="Tadpoles"
        date="2026-01-05"
        blocked={blocked}
        leaveScreen={jest.fn()}
      />
    );
    expect(screen.getByText("That lesson is closed")).toBeTruthy();
    expect(screen.getByText(blocked.detail)).toBeTruthy();
    expect(blocked.detail).toMatch(/credit note/);
    // Which lesson is refused, so the coach knows what they tapped.
    expect(screen.getByText(/Tadpoles · /)).toBeTruthy();
  });

  it("offers no marking control at all", () => {
    render(
      <BlockedLesson
        classTitle="Tadpoles"
        date="2026-01-05"
        blocked={closedLesson()}
        leaveScreen={jest.fn()}
      />
    );
    for (const label of ["Present", "Absent", "Cancelled", "Trial", "Set all", "Save"]) {
      expect(screen.queryByText(new RegExp(`^${label}`))).toBeNull();
    }
  });

  it("both exits leave the screen — the back chevron and 'Back to class'", () => {
    const leaveScreen = jest.fn();
    render(
      <BlockedLesson
        classTitle="Tadpoles"
        date="2026-01-05"
        blocked={closedLesson()}
        leaveScreen={leaveScreen}
      />
    );
    fireEvent.press(screen.getByText("Back to class"));
    expect(leaveScreen).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText("icon:chevron-back"));
    expect(leaveScreen).toHaveBeenCalledTimes(2);
  });
});
