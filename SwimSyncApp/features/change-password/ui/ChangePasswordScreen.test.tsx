// The shared Change Password screen (coach Settings + parent Profile), with its one
// hook mocked. Pinned (UI restyle step 2.8): Update Password is the hook's
// handleSave and stays pressable while it says "Updating..." (the hook's guard is
// the save's business); an error reads in Danger text under the fields; both
// fields are labelled above and masked.
//
// MUTATION PROOFS (§7.25) — each applied to ChangePasswordScreen.tsx, run, reverted:
//   1. `onPress={handleSave}` → `onPress={() => {}}`
//      → RED: "Update Password is handleSave, pressable while updating"
//   2. Error `text-status-danger-text` → `text-ink`
//      → RED: "an error reads in Danger text"
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));
jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

const mockState = { loading: false, error: null as string | null, done: false, handleSave: jest.fn() };
jest.mock("../domain/useChangePassword", () => ({
  useChangePassword: () => ({
    password: "", setPassword: () => {}, confirm: "", setConfirm: () => {},
    loading: mockState.loading, error: mockState.error, done: mockState.done,
    handleSave: mockState.handleSave,
  }),
}));

// eslint-disable-next-line import/first
import ChangePasswordScreen from "./ChangePasswordScreen";

describe("ChangePasswordScreen", () => {
  beforeEach(() => {
    mockState.loading = false; mockState.error = null; mockState.done = false;
    mockState.handleSave.mockClear();
  });

  it("labels both fields above, masked", () => {
    render(<ChangePasswordScreen />);
    expect(screen.getByText("New Password")).toBeTruthy();
    expect(screen.getByText("Confirm New Password")).toBeTruthy();
    const inputs = screen.UNSAFE_root.findAll(
      (n: { props: { secureTextEntry?: boolean }; type: unknown }) => n.props.secureTextEntry === true && typeof n.type !== "string"
    );
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it("Update Password is handleSave, pressable while updating", () => {
    render(<ChangePasswordScreen />);
    fireEvent.press(screen.getByText("Update Password"));
    expect(mockState.handleSave).toHaveBeenCalledTimes(1);
    mockState.loading = true;
    render(<ChangePasswordScreen />);
    fireEvent.press(screen.getByText("Updating..."));
    expect(mockState.handleSave).toHaveBeenCalledTimes(2);
  });

  it("an error reads in Danger text", () => {
    mockState.error = "Passwords do not match.";
    render(<ChangePasswordScreen />);
    expect(screen.getByText("Passwords do not match.").props.className).toContain("text-status-danger-text");
  });

  it("done → Password updated", () => {
    mockState.done = true;
    render(<ChangePasswordScreen />);
    expect(screen.getByText("Password updated")).toBeTruthy();
  });
});
