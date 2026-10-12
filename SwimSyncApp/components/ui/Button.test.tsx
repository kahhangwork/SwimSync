// The DESIGN.md Button (UI restyle step 1.3). Pinned:
//  - the label Text's nearest HOST ancestor is the pressable itself, with or
//    without an icon — the UI drivers' pressByText dispatches on the matched
//    text's parent, so a wrapping View would swallow every press (§7.365);
//  - a destructive press goes through confirmAction and never straight to onPress
//    (Alert.alert is a no-op on RN-web);
//  - a disabled Button does not fire.
//
// MUTATION PROOFS (§7.25), run 2026-10-12:
//   1. wrap the label: `<View><Text …>{label}</Text></View>`
//      → RED: "the label is the pressable's direct child" (both rows)
//   2. destructive `press` → `onPress`
//      → RED: "destructive asks first and only then fires"
import React from "react";
import { Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "./Button";
import { confirmAction } from "@/lib/confirm";

jest.mock("@/lib/confirm", () => ({ confirmAction: jest.fn() }));

type Node = ReturnType<typeof screen.getByText>;

/** The nearest ancestor that is a host element (a real View/Text on screen). */
function hostParent(n: Node): Node | null {
  let p = n.parent;
  while (p && typeof p.type !== "string") p = p.parent;
  return p;
}

describe("Button", () => {
  beforeEach(() => jest.mocked(confirmAction).mockClear());

  it.each([
    ["no icon", undefined],
    ["an icon", <Text key="i" testID="icon">*</Text>],
  ])("the label is the pressable's direct child (%s)", (_name, icon) => {
    render(<Button label="Mark Attendance" icon={icon} onPress={() => {}} />);
    const button = screen.getByRole("button");
    // Compare a label, never the instances: a failing toBe() pretty-prints both
    // trees, whose parent links make the diff run for ever and hang jest.
    const isButton = (n: Node) => (hostParent(n) === button ? "the button" : `a ${hostParent(n)?.type}`);
    expect(isButton(screen.getByText("Mark Attendance"))).toBe("the button");
    if (icon) expect(isButton(screen.getByTestId("icon"))).toBe("the button");
  });

  it("primary fires onPress directly", () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} />);
    fireEvent.press(screen.getByText("Save"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("destructive asks first and only then fires", () => {
    const onPress = jest.fn();
    render(
      <Button
        variant="destructive"
        label="Remove from class"
        confirm={{ title: "Remove?", message: "Remove Anna from Tue 5pm?", confirmLabel: "Remove" }}
        onPress={onPress}
      />,
    );
    fireEvent.press(screen.getByText("Remove from class"));
    expect(onPress).not.toHaveBeenCalled();
    expect(confirmAction).toHaveBeenCalledWith("Remove?", "Remove Anna from Tue 5pm?", expect.any(Function), "Remove");
    jest.mocked(confirmAction).mock.calls[0][2]();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("a disabled Button does not fire", () => {
    const onPress = jest.fn();
    render(<Button label="Save" disabled onPress={onPress} />);
    fireEvent.press(screen.getByText("Save"));
    expect(onPress).not.toHaveBeenCalled();
  });
});
