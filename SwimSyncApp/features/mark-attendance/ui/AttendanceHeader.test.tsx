// AttendanceHeader — title, lesson line, and the "Set all" toggle. Pinned: the
// bulk toggle exists only when there is someone to mark AND the view is
// editable. A read-only (sealed/past) lesson offering "Set all" would invite a
// whole-class rewrite of an already-billed lesson.
//
// MUTATION PROOFS (§7.25) — each applied to AttendanceHeader.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `students.length > 0 && !readOnly &&` → `students.length > 0 &&`
//      → RED: "read-only hides Set all and says 'Lesson Attendance'"
//   2. `setMenuOpen((v) => !v)` → `setMenuOpen(() => true)`
//      → RED: "Set all toggles the menu"
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import AttendanceHeader from "./AttendanceHeader";
import type { StudentRow } from "../types";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

const KIDS: StudentRow[] = [{ id: "s1", full_name: "Anna Tan" }];

function renderHeader(over: Partial<{ readOnly: boolean; students: StudentRow[] }> = {}) {
  const setMenuOpen = jest.fn();
  const leaveScreen = jest.fn();
  render(
    <AttendanceHeader
      readOnly={over.readOnly ?? false}
      classTitle="Tadpoles"
      date="2026-09-21"
      students={over.students ?? KIDS}
      menuOpen={false}
      setMenuOpen={setMenuOpen}
      leaveScreen={leaveScreen}
    />
  );
  return { setMenuOpen, leaveScreen };
}

describe("AttendanceHeader", () => {
  it("an editable lesson with students offers Set all", () => {
    renderHeader();
    expect(screen.getByText("Mark Attendance")).toBeTruthy();
    expect(screen.getByText("Set all")).toBeTruthy();
  });

  it("read-only hides Set all and says 'Lesson Attendance'", () => {
    renderHeader({ readOnly: true });
    expect(screen.getByText("Lesson Attendance")).toBeTruthy();
    expect(screen.queryByText("Set all")).toBeNull();
  });

  it("no students → no Set all", () => {
    renderHeader({ students: [] });
    expect(screen.queryByText("Set all")).toBeNull();
  });

  it("Set all toggles the menu", () => {
    const { setMenuOpen } = renderHeader();
    fireEvent.press(screen.getByText("Set all"));
    const updater = setMenuOpen.mock.calls[0][0] as (v: boolean) => boolean;
    expect(updater(false)).toBe(true);
    expect(updater(true)).toBe(false);
  });

  it("the back chevron leaves the screen", () => {
    const { leaveScreen } = renderHeader();
    fireEvent.press(screen.getByText("icon:chevron-back"));
    expect(leaveScreen).toHaveBeenCalledTimes(1);
  });
});
