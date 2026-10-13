// AttendanceActions — the bottom action area (UI restyle step 2.2): Set all and Save.
// Pinned: Set all exists only when there is someone to set; it toggles the menu;
// Save is the route's handleSave and says "Saving…" while a save runs — and is NOT
// disabled then (what enables Save is useSaveAttendance's business, never the
// restyle's; plan 2.2 RISK 2). A read-only lesson renders no action area at all —
// that rule is the route's, pinned by MarkAttendanceScreen.test.tsx.
//
// MUTATION PROOFS (§7.25) — each applied to AttendanceActions.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `{hasStudents && (` → `{(`
//      → RED: "no students → Save only, no Set all"
//   2. `setMenuOpen((v) => !v)` → `setMenuOpen(() => true)`
//      → RED: "Set all toggles the menu"
//   3. `onPress={onSave}` → `onPress={() => {}}`
//      → RED: "Save is the route's save, and says so while saving"
//   4. Added `disabled={saving}` to Save
//      → RED: "Save is the route's save, and says so while saving"
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import AttendanceActions from "./AttendanceActions";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

function renderActions(over: Partial<{ hasStudents: boolean; saving: boolean }> = {}) {
  const setMenuOpen = jest.fn();
  const onSave = jest.fn();
  render(
    <AttendanceActions
      hasStudents={over.hasStudents ?? true}
      menuOpen={false}
      setMenuOpen={setMenuOpen}
      saving={over.saving ?? false}
      onSave={onSave}
    />
  );
  return { setMenuOpen, onSave };
}

describe("AttendanceActions", () => {
  it("with students: Set all beside Save", () => {
    renderActions();
    expect(screen.getByText("Set all")).toBeTruthy();
    expect(screen.getByText("Save Attendance")).toBeTruthy();
  });

  it("no students → Save only, no Set all", () => {
    renderActions({ hasStudents: false });
    expect(screen.queryByText("Set all")).toBeNull();
    expect(screen.getByText("Save Attendance")).toBeTruthy();
  });

  it("Set all toggles the menu", () => {
    const { setMenuOpen } = renderActions();
    fireEvent.press(screen.getByText("Set all"));
    const updater = setMenuOpen.mock.calls[0][0] as (v: boolean) => boolean;
    expect(updater(false)).toBe(true);
    expect(updater(true)).toBe(false);
  });

  it("Save is the route's save, and says so while saving", () => {
    const { onSave } = renderActions();
    fireEvent.press(screen.getByText("Save Attendance"));
    expect(onSave).toHaveBeenCalledTimes(1);

    const again = renderActions({ saving: true });
    fireEvent.press(screen.getByText("Saving…"));
    // Pressable while saving, exactly as before the restyle.
    expect(again.onSave).toHaveBeenCalledTimes(1);
  });
});
