import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { StudentToolbar } from "./StudentToolbar";

// StudentToolbar — the status pills and the two toggles (user, 2026-10-16):
//   • pills read All · Active · Inactive · Assigned · Unassigned, in that order;
//   • the selected pill and each toggle say so in the DOM (aria-pressed), so a
//     driver or test never has to read a colour class (§7.375, §7.378);
//   • "No parent account (N)" sits at the FAR RIGHT, and only when N > 0.
// PROOF (§7.25): every test here was run against the toolbar before this change
// and recorded RED there (no Active pill, no aria-pressed, the unclaimed toggle
// ahead of Package running low).

type Props = ComponentProps<typeof StudentToolbar>;

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    search: "",
    onSearch: vi.fn(),
    searchField: "student",
    onSearchField: vi.fn(),
    statusFilter: "Active",
    onStatusFilter: vi.fn(),
    unclaimedCount: 2,
    unclaimedOnly: false,
    onToggleUnclaimed: vi.fn(),
    lowOnly: false,
    onToggleLow: vi.fn(),
    threshold: "2",
    expiryDays: "14",
    ...over,
  };
  render(<StudentToolbar {...props} />);
  return props;
}

const PILLS = ["All", "Active", "Inactive", "Assigned", "Unassigned"];

describe("StudentToolbar", () => {
  it("offers the five status pills in order", () => {
    setup();
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names.filter((n) => PILLS.includes(n ?? ""))).toEqual(PILLS);
  });

  it("marks only the selected pill as pressed", () => {
    setup({ statusFilter: "Active" });
    for (const p of PILLS) {
      expect(screen.getByRole("button", { name: p }).getAttribute("aria-pressed")).toBe(p === "Active" ? "true" : "false");
    }
  });

  it("both toggles report their state", () => {
    setup({ lowOnly: true, unclaimedOnly: false });
    expect(screen.getByRole("button", { name: "Package running low" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "No parent account (2)" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("puts No parent account last, after Package running low", () => {
    setup({ lowOnly: true });
    const buttons = screen.getAllByRole("button");
    expect(buttons[buttons.length - 1].textContent).toBe("No parent account (2)");
  });

  it("hides No parent account when there are none", () => {
    setup({ unclaimedCount: 0 });
    expect(screen.queryByRole("button", { name: /No parent account/ })).toBeNull();
  });
});
