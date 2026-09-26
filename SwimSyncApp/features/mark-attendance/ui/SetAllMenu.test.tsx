// SetAllMenu — the "Set all" dropdown. One press marks the WHOLE class, so the
// option pressed must be the option applied: "Cancelled — Rain" (no charge) and
// "Absent" (charged) sit one row apart. Trial is deliberately not offered (a
// class of trials never happens and its paid/free split needs a per-child
// choice). Tapping the backdrop closes the menu without applying anything.
//
// MUTATION PROOFS (§7.25) — each applied to SetAllMenu.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `onPress={() => onSetAll(opt)}` → `onSetAll(SET_ALL_OPTIONS[0])`
//      → RED: "pressing an option applies exactly that option" for Absent,
//        Cancelled — Rain and Cancelled — Coach (Present is option[0], so green)
//   2. Backdrop `setMenuOpen(false)` → `onSetAll(SET_ALL_OPTIONS[1])`
//      → RED: "the backdrop closes without applying anything"
//   3. `{menuOpen && (` → `{(menuOpen || true) && (`
//      → RED: "renders nothing while closed"
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import SetAllMenu from "./SetAllMenu";
import { SET_ALL_OPTIONS } from "@/lib/attendanceBulk";

function renderMenu(menuOpen = true) {
  const setMenuOpen = jest.fn();
  const onSetAll = jest.fn();
  const utils = render(
    <SetAllMenu menuOpen={menuOpen} setMenuOpen={setMenuOpen} onSetAll={onSetAll} />
  );
  return { setMenuOpen, onSetAll, ...utils };
}

describe("SetAllMenu", () => {
  it("renders nothing while closed", () => {
    const { toJSON } = renderMenu(false);
    expect(toJSON()).toBeNull();
  });

  it("lists every bulk option and never Trial", () => {
    renderMenu();
    for (const opt of SET_ALL_OPTIONS) {
      expect(screen.getByText(opt.label)).toBeTruthy();
    }
    expect(screen.queryByText(/Trial/)).toBeNull();
  });

  it.each([
    ["Present", { top: "present", sub: null }],
    ["Absent", { top: "absent", sub: null }],
    ["Cancelled — Rain", { top: "cancelled", sub: "rain" }],
    ["Cancelled — Coach", { top: "cancelled", sub: "coach" }],
  ])("pressing an option applies exactly that option — %s", (label, want) => {
    const { onSetAll } = renderMenu();
    fireEvent.press(screen.getByText(label));
    expect(onSetAll).toHaveBeenCalledTimes(1);
    expect(onSetAll).toHaveBeenCalledWith(expect.objectContaining({ label, ...want }));
  });

  it("the backdrop closes without applying anything", () => {
    const { onSetAll, setMenuOpen, UNSAFE_root } = renderMenu();
    // The backdrop is the only Pressable with no text in it.
    const { Pressable } = jest.requireActual("react-native");
    const backdrop = UNSAFE_root.findByType(Pressable);
    fireEvent.press(backdrop);
    expect(setMenuOpen).toHaveBeenCalledWith(false);
    expect(onSetAll).not.toHaveBeenCalled();
  });
});
