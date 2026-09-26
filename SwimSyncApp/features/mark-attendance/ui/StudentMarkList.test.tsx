// StudentMarkList — one card per child: the current mark, the status buttons, and
// the cancelled/trial sub-type pickers. Every press here becomes an attendance
// row, and the row's status IS the charge (present/absent bill, cancelled_* and
// trial_free do not, trial_paid bills at the trial rate). So what is pinned:
//   • each press reports the RIGHT child and the RIGHT status/sub-type;
//   • the current mark is visible (selected = white label; unmarked says so);
//   • a make-up guest cannot be marked Trial (that would price it at the trial
//     rate — the engine prices a mismark at the class rate, this is the
//     affordance);
//   • a public-holiday void is read-only: no buttons at all;
//   • read-only (a past, sealed view) disables every press.
//
// MUTATION PROOFS (§7.25) — each applied to StudentMarkList.tsx, run, reverted,
// `git diff --exit-code` clean after:
//   1. `onPress={() => setTop(student.id, key)}` → `setTop(students[0].id, key)`
//      → RED: "pressing a status reports that child and that status"
//   2. Removed the `!(student.isMakeup && key === "trial")` filter (→ `true`)
//      → RED: "a make-up guest is never offered Trial"
//   3. `state.top !== "holiday"` → `true` (buttons shown on a holiday void)
//      → RED: "a public-holiday void shows no buttons …"
//   4. `disabled={readOnly}` on the status buttons → `disabled={false}`
//      → RED: "read-only disables every status and sub-type press"
//   5. Trial sub-type `setSub(student.id, key)` → `setSub(student.id, "paid")`
//      → RED: "the trial sub-type reports paid vs free …"
//   6. `isSelected ? "text-white"` → `isSelected ? "text-gray-500"`
//      → RED: "renders each child's current mark"
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react-native";
import StudentMarkList from "./StudentMarkList";
import type { AttState, StudentRow } from "../types";

const ANNA: StudentRow = { id: "s-anna", full_name: "Anna Tan" };
const BEN: StudentRow = { id: "s-ben", full_name: "Ben Lim" };
const MAKEUP: StudentRow = {
  id: "s-mia",
  full_name: "Mia Ong",
  attendedOnly: true,
  isMakeup: true,
};
const TRIAL: StudentRow = {
  id: "s-tom",
  full_name: "Tom Goh",
  attendedOnly: true,
  isTrial: true,
};

function renderList(
  over: Partial<{
    students: StudentRow[];
    attendance: Record<string, AttState>;
    readOnly: boolean;
  }> = {}
) {
  const setTop = jest.fn();
  const setSub = jest.fn();
  render(
    <StudentMarkList
      students={over.students ?? [ANNA, BEN]}
      attendance={over.attendance ?? {}}
      readOnly={over.readOnly ?? false}
      setTop={setTop}
      setSub={setSub}
    />
  );
  return { setTop, setSub };
}

/** The card for one child — the nearest ancestor holding its status row. */
function card(name: string) {
  let node = screen.getByText(name).parent;
  while (node && within(node).queryAllByText("Absent").length === 0) {
    node = node.parent;
  }
  if (!node) throw new Error(`no card for ${name}`);
  return within(node);
}

/** Under jest NativeWind does NOT compile className to a style — the class
 *  string arrives on the host element as-is. The selected label is white. */
function isSelected(el: ReturnType<typeof screen.getByText>) {
  return /\btext-white\b/.test(el.props.className ?? "");
}

describe("StudentMarkList", () => {
  it("says so when nobody is enrolled", () => {
    renderList({ students: [] });
    expect(screen.getByText("No students enrolled")).toBeTruthy();
    expect(screen.queryByText("Present")).toBeNull();
  });

  it("renders each child's current mark", () => {
    renderList({
      attendance: {
        [ANNA.id]: { top: "present", sub: null },
        // BEN has no entry → unmarked
      },
    });
    const anna = card("Anna Tan");
    const ben = card("Ben Lim");
    expect(anna.queryByText("Not yet marked")).toBeNull();
    expect(ben.getByText("Not yet marked")).toBeTruthy();
    // Selected button's label is white; the others are grey.
    expect(isSelected(anna.getByText("Present"))).toBe(true);
    expect(isSelected(anna.getByText("Absent"))).toBe(false);
    expect(isSelected(ben.getByText("Present"))).toBe(false);
  });

  it("pressing a status reports that child and that status", () => {
    const { setTop } = renderList();
    fireEvent.press(card("Ben Lim").getByText("Absent"));
    expect(setTop).toHaveBeenLastCalledWith("s-ben", "absent");
    fireEvent.press(card("Anna Tan").getByText("Cancelled"));
    expect(setTop).toHaveBeenLastCalledWith("s-anna", "cancelled");
    fireEvent.press(card("Ben Lim").getByText("Present"));
    expect(setTop).toHaveBeenLastCalledWith("s-ben", "present");
    expect(setTop).toHaveBeenCalledTimes(3);
  });

  it("the cancelled sub-type reports rain vs coach for that child", () => {
    const { setSub } = renderList({
      attendance: { [BEN.id]: { top: "cancelled", sub: null } },
    });
    // Only the cancelled child gets the Reason picker.
    expect(card("Anna Tan").queryByText("Reason:")).toBeNull();
    fireEvent.press(card("Ben Lim").getByText("Rain"));
    expect(setSub).toHaveBeenLastCalledWith("s-ben", "rain");
    fireEvent.press(card("Ben Lim").getByText("Coach"));
    expect(setSub).toHaveBeenLastCalledWith("s-ben", "coach");
  });

  it("the trial sub-type reports paid vs free — the difference is the charge", () => {
    const { setSub } = renderList({
      students: [TRIAL],
      attendance: { [TRIAL.id]: { top: "trial", sub: null } },
    });
    expect(screen.getByText("Trial type:")).toBeTruthy();
    fireEvent.press(screen.getByText("Free"));
    expect(setSub).toHaveBeenLastCalledWith("s-tom", "free");
    fireEvent.press(screen.getByText("Paid"));
    expect(setSub).toHaveBeenLastCalledWith("s-tom", "paid");
  });

  it("a make-up guest is never offered Trial; a regular and a trial are", () => {
    renderList({ students: [ANNA, MAKEUP, TRIAL] });
    expect(card("Mia Ong").getByText("Make-up")).toBeTruthy();
    expect(card("Mia Ong").queryByText("Trial")).toBeNull();
    expect(card("Mia Ong").getByText("Present")).toBeTruthy();
    expect(card("Anna Tan").getByText("Trial")).toBeTruthy();
    // The trial child's chip AND its Trial button.
    expect(card("Tom Goh").getAllByText("Trial")).toHaveLength(2);
  });

  it("a public-holiday void shows no buttons — the coach cannot change it", () => {
    const { setTop } = renderList({
      students: [ANNA],
      attendance: { [ANNA.id]: { top: "holiday", sub: null } },
    });
    expect(screen.getByText("Public holiday — no charge")).toBeTruthy();
    for (const label of ["Present", "Absent", "Cancelled", "Trial"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(setTop).not.toHaveBeenCalled();
  });

  it("read-only disables every status and sub-type press", () => {
    const { setTop, setSub } = renderList({
      students: [ANNA, TRIAL],
      attendance: {
        [ANNA.id]: { top: "cancelled", sub: "rain" },
        [TRIAL.id]: { top: "trial", sub: "paid" },
      },
      readOnly: true,
    });
    for (const label of ["Present", "Absent", "Cancelled"]) {
      fireEvent.press(card("Anna Tan").getByText(label));
    }
    fireEvent.press(card("Anna Tan").getByText("Coach"));
    fireEvent.press(card("Tom Goh").getByText("Free"));
    expect(setTop).not.toHaveBeenCalled();
    expect(setSub).not.toHaveBeenCalled();
  });
});
