import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { PackagesTab } from "./PackagesTab";
import type { ChildOption, PackageProduct, ParentPackage } from "../types";

// Single-child packages (D7, ⚠ RISK 7/8). Load-bearing: "Which child is this for?"
// with several children (Request disabled until one is picked); "For Ava" with one
// (sent without asking); "Add your child at this business first" with none
// (disabled); a shared product sends null; a held one-child card says whose it is.

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("./ReferralSection", () => ({ ReferralSection: () => null }));
jest.mock("../domain/usePackageUsage", () => ({
  usePackageUsage: () => ({ stateOf: () => ({ open: false, loading: false, rows: null, error: null }), toggle: jest.fn() }),
}));
jest.mock("@/lib/supabase", () => {
  throw new Error("tripwire: PackagesTab test reached the real supabase client");
});

const product = (over: Partial<PackageProduct>): PackageProduct => ({
  id: "oc5", tenant_id: "tA", single_child: true, name: "OC5", business_name: "Orcas", category_name: null,
  lesson_count: 5, rate_per_lesson: 30, validity_weeks: 20, ...over,
});
const kid = (id: string, name: string, tenant_id = "tA"): ChildOption => ({ id, name, tenant_id, active: true });

function setup(products: PackageProduct[], kids: ChildOption[], packages: ParentPackage[] = []) {
  const requestPackage = jest.fn();
  render(
    <PackagesTab packageError={null} packages={packages} products={products} requestingId={null}
      requestPackage={requestPackage} cancelRequest={jest.fn()} familyChildren={kids} />
  );
  return requestPackage;
}

it("several children: asks, and sends the one picked", () => {
  const request = setup([product({})], [kid("ava", "Ava"), kid("ben", "Ben")]);
  expect(screen.getByText("Which child is this for?")).toBeTruthy();
  fireEvent.press(screen.getByText("Request & pay"));
  expect(request).not.toHaveBeenCalled(); // disabled until a child is chosen
  fireEvent.press(screen.getByText("Ben"));
  fireEvent.press(screen.getByText("Request & pay"));
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ id: "oc5" }), "ben");
});

it("one child at this business: shown, not asked — and sent", () => {
  const request = setup([product({})], [kid("ava", "Ava"), kid("zed", "Zed", "tB")]);
  expect(screen.queryByText("Which child is this for?")).toBeNull();
  expect(screen.getByText("Ava")).toBeTruthy();
  fireEvent.press(screen.getByText("Request & pay"));
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ id: "oc5" }), "ava");
});

it("no child at this business: says so, and Request does nothing", () => {
  const request = setup([product({})], [kid("zed", "Zed", "tB")]);
  expect(screen.getByText("Add your child at this business first.")).toBeTruthy();
  fireEvent.press(screen.getByText("Request & pay"));
  expect(request).not.toHaveBeenCalled();
});

it("⚠ RISK 7 — a shared product sends null and shows no picker", () => {
  const request = setup([product({ id: "sh", single_child: false })], [kid("ava", "Ava")]);
  expect(screen.queryByTestId("child-picker-sh")).toBeNull();
  fireEvent.press(screen.getByText("Request & pay"));
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ id: "sh" }), null);
});

it("a held one-child package says whose it is", () => {
  const pkg = {
    id: "pp", name: "OC5", business_name: "Orcas", category_name: null, lesson_count: 5, rate_per_lesson: 30,
    total_value: 150, amount_payable: 150, discount_amount: 0, status: "active", offered_by: null,
    expires_on: "2027-01-01", live_lessons_remaining: 5, live_value_remaining: 150,
    holiday_extension_days: 0, cancel_extension_days: 0, student_id: "ava", child_name: "Ava",
  } as ParentPackage;
  setup([], [kid("ava", "Ava")], [pkg]);
  expect(screen.getByText("For Ava only")).toBeTruthy();
});
