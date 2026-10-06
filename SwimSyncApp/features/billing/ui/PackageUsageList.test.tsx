import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { PackageUsageList } from "./PackageUsageList";
import type { PackageUsage, UsageState } from "../domain/usePackageUsage";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: PackageUsageList test reached the real supabase client");
});

const ROW = { lesson_date: "2026-10-03", student_id: "s1", student_name: "Ava", class_title: "Dolphins Fri 4pm",
  amount: "35.00", source: "marking", applied_at: "2026-10-03T09:00:00Z", reversed_at: null };

const usage = (s: Partial<UsageState>): PackageUsage => ({
  stateOf: () => ({ open: true, loading: false, rows: null, error: null, ...s }),
  toggle: jest.fn(),
});

it("lists draws, labels a return, notes a legacy invoice line", () => {
  render(
    <PackageUsageList
      packageId="pkg-1"
      usage={usage({
        rows: [
          ROW,
          { ...ROW, student_id: "s2", student_name: "Ben", reversed_at: "2026-10-04T00:00:00Z" },
          { ...ROW, student_id: "s3", student_name: "Cal", lesson_date: "2026-08-01", source: "invoice" },
        ],
      })}
    />
  );
  expect(screen.getByText("3 Oct 2026 · Ava · Dolphins Fri 4pm")).toBeTruthy();
  expect(screen.getAllByText("Returned to the package")).toHaveLength(1);
  expect(screen.getByText("On a monthly invoice")).toBeTruthy();
  expect(screen.getByText("Hide lessons used")).toBeTruthy();
});

it("closed: the toggle opens this package", () => {
  const u = usage({ open: false });
  render(<PackageUsageList packageId="pkg-1" usage={u} />);
  fireEvent.press(screen.getByText("Show lessons used"));
  expect(u.toggle).toHaveBeenCalledWith("pkg-1");
  expect(screen.queryByText(/Returned/)).toBeNull();
});

it("an empty package says so; a failed read says so", () => {
  const { rerender } = render(<PackageUsageList packageId="p" usage={usage({ rows: [] })} />);
  expect(screen.getByText("No lessons have used this package yet.")).toBeTruthy();
  rerender(<PackageUsageList packageId="p" usage={usage({ error: "Couldn't load the lessons this package paid for." })} />);
  expect(screen.getByText(/Couldn't load/)).toBeTruthy();
});
