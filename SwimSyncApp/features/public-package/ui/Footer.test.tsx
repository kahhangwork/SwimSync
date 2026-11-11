import React from "react";
import { render, screen } from "@testing-library/react-native";

// "Prefer a different package?" is no dead end: signed in → Billing → Packages;
// signed out → Sign In (an in-app push to /billing without a session is not
// redirected anywhere — the driver found it, verify-app-money C3).
let mockSession: object | null = null;
jest.mock("@/store/useAppStore", () => ({
  useAppStore: (sel: (s: object) => unknown) => sel({ session: mockSession }),
}));
jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return { Link: ({ href, children }: { href: string; children: React.ReactNode }) => <Text testID={`href:${href}`}>{children}</Text> };
});

import { Footer } from "./Footer";

const LABEL = "Sign in to choose another in Billing → Packages";

it("signed in: links to Billing on the Packages tab", () => {
  mockSession = { id: "u1" };
  render(<Footer />);
  expect(screen.getByTestId("href:/(parent)/billing?tab=packages")).toHaveTextContent(LABEL);
});

it("signed out: links to Sign In", () => {
  mockSession = null;
  render(<Footer />);
  expect(screen.getByTestId("href:/(auth)/login")).toHaveTextContent(LABEL);
  expect(screen.queryByText("Prefer a different package? Tell your coach.")).toBeNull();
});
