import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { StudentTable } from "./StudentTable";
import type { EnrolledClass, StudentRow } from "../types";
import { classSortKey } from "../domain/studentRows";

// StudentTable — the default order (user, 2026-10-16): by each child's earliest
// class, weekday Mon→Sun then start time then name, with no-class children last
// in both directions; and an empty filtered list says which filter hid it.
// PROOF (§7.25): run against the table before this change and recorded RED
// there (it opened sorted by Student, and the empty row named no filter).

type Props = ComponentProps<typeof StudentTable>;

function kid(full_name: string, day: string | null, start_time: string | null): StudentRow {
  const classes: EnrolledClass[] = day
    ? [{ id: `c-${full_name}`, title: "T", coach_name: null, day, start: null, start_time }]
    : [];
  return {
    id: full_name,
    full_name,
    date_of_birth: null,
    gender: null,
    level_id: null,
    level_label: null,
    assignment_status: day ? "assigned" : "unassigned",
    is_active: true,
    inactivated_at: null,
    parent_id: "p",
    parent_name: "P",
    classes,
    class_sort_key: classSortKey(classes, full_name),
    coach_name: null,
    lessons: 0,
  };
}

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    // Given in NAME order, so a table that ignores the class keeps this order.
    students: [kid("Anna", "sunday", "08:45:00"), kid("Ben", null, null), kid("Cal", "monday", "10:15:00")],
    loading: false,
    levels: [],
    savingLevelFor: null,
    onSetLevel: vi.fn(),
    covMap: new Map(),
    busyId: null,
    onActions: vi.fn(),
    statusFilter: "Active",
    ...over,
  };
  render(<StudentTable {...props} />);
  return props;
}

const order = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("StudentTable", () => {
  it("opens sorted by Class, ascending: Monday before Sunday, no class last", () => {
    setup();
    expect(order()).toEqual(["Cal", "Anna", "Ben"]);
    expect(screen.getByRole("columnheader", { name: /Class/ }).getAttribute("aria-sort")).toBe("ascending");
  });

  it("one click on Class reverses the classes and keeps no class last", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Class/ }));
    expect(order()).toEqual(["Anna", "Cal", "Ben"]);
  });

  it("an empty list under a filter names the filter and points at All", () => {
    setup({ students: [], statusFilter: "Active" });
    expect(screen.getByText(/No students found\./).textContent).toContain("Showing Active only — try All.");
  });

  it("an empty list under All says only that nothing was found", () => {
    setup({ students: [], statusFilter: "All" });
    expect(screen.getByText(/No students found\./).textContent).not.toContain("try All");
  });
});
