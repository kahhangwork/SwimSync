// AttendanceHeader — title and lesson line. Pinned: a read-only lesson is titled
// "Lesson Attendance", an editable one "Mark Attendance" (verify-coach-marking reads
// the title as a whole line). "Set all" moved to AttendanceActions in UI restyle
// step 2.2 — its tests moved with it.
//
// MUTATION PROOFS (§7.25) — each applied to AttendanceHeader.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `readOnly ? "Lesson Attendance" : "Mark Attendance"` → `"Mark Attendance"`
//      → RED: "read-only says 'Lesson Attendance'"
//   2. `onPress={() => leaveScreen()}` → `onPress={() => {}}`
//      → RED: "the back chevron leaves the screen"
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import AttendanceHeader from "./AttendanceHeader";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

function renderHeader(over: Partial<{ readOnly: boolean }> = {}) {
  const leaveScreen = jest.fn();
  render(
    <AttendanceHeader
      readOnly={over.readOnly ?? false}
      classTitle="Tadpoles"
      date="2026-09-21"
      leaveScreen={leaveScreen}
    />
  );
  return { leaveScreen };
}

describe("AttendanceHeader", () => {
  it("an editable lesson says 'Mark Attendance' and names the lesson", () => {
    renderHeader();
    expect(screen.getByText("Mark Attendance")).toBeTruthy();
    expect(screen.getByText(/^Tadpoles · /)).toBeTruthy();
    // Set all is no longer up here — it is in the bottom action area.
    expect(screen.queryByText("Set all")).toBeNull();
  });

  it("read-only says 'Lesson Attendance'", () => {
    renderHeader({ readOnly: true });
    expect(screen.getByText("Lesson Attendance")).toBeTruthy();
    expect(screen.queryByText("Mark Attendance")).toBeNull();
  });

  it("the back chevron leaves the screen", () => {
    const { leaveScreen } = renderHeader();
    fireEvent.press(screen.getByText("icon:chevron-back"));
    expect(leaveScreen).toHaveBeenCalledTimes(1);
  });
});
