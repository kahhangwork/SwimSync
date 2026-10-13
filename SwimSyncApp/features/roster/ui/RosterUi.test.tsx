// The coach roster's UI (UI restyle step 2.4). Pinned:
//   • ONE empty state for an empty class — StudentList's card, with neither the
//     mark panel's nor Past Sessions' empty card beside it;
//   • Remove reaches the screen's handleRemove for THAT child (its confirm is
//     useRemoveStudent's confirmAction — never Alert.alert), and reads as
//     destructive (Danger text);
//   • a past lesson's state is a tag on the status scale.
//
// MUTATION PROOFS (§7.25) — each applied, run, reverted, `git diff --exit-code` clean:
//   1. MarkTargetPanel: deleted `if (!markTarget && students.length === 0) return null;`
//      → RED: "an empty class shows ONE empty state"
//   2. PastSessions: `if (sessions.length === 0 && nothingToMark) return null;` → deleted
//      → RED: "an empty class shows ONE empty state"
//   3. StudentList: `onPress={() => handleRemove(student)}` → `onPress={() => {}}`
//      → RED: "Remove reaches handleRemove for that child, in Danger text"
//   4. PastSessions: PROGRESS_TONE unmarked "warning" → "neutral"
//      → RED: "a past lesson's state is a status tag"
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { MarkTargetPanel } from "./MarkTargetPanel";
import { StudentList } from "./StudentList";
import { PastSessions } from "./PastSessions";
import type { Student, Session } from "../types";

jest.mock("expo-router", () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

const kid = (id: string, name: string): Student => ({
  id, full_name: name, date_of_birth: null, level_label: null, level_note: null, level_skills: [],
});

function renderRoster(students: Student[], sessions: Session[], markTarget: { date: string } | null) {
  const handleRemove = jest.fn();
  render(
    <>
      <MarkTargetPanel id="c1" markTarget={markTarget} todayDate="2026-10-13" windowStart={null} students={students} />
      <StudentList
        id="c1" students={students} duplicateNames={new Set()} removingId={null}
        handleRemove={handleRemove} openLevelFor={null} setOpenLevelFor={() => {}}
      />
      <PastSessions id="c1" sessions={sessions} nothingToMark={!markTarget} />
    </>
  );
  return { handleRemove };
}

describe("coach roster UI", () => {
  it("an empty class shows ONE empty state", () => {
    renderRoster([], [], null);
    expect(screen.getByText("No students enrolled")).toBeTruthy();
    expect(screen.queryByText("No lessons to mark yet")).toBeNull();
    expect(screen.queryByText("No sessions recorded yet")).toBeNull();
    expect(screen.queryByText("Past Sessions")).toBeNull();
  });

  it("students but no lesson yet: the mark panel says so", () => {
    renderRoster([kid("a", "Anna Tan")], [], null);
    expect(screen.getByText("No lessons to mark yet")).toBeTruthy();
  });

  it("Remove reaches handleRemove for that child, in Danger text", () => {
    const anna = kid("a", "Anna Tan");
    const ben = kid("b", "Ben Lim");
    const { handleRemove } = renderRoster([anna, ben], [], { date: "2026-10-10" });
    const removes = screen.getAllByText("Remove");
    fireEvent.press(removes[1]);
    expect(handleRemove).toHaveBeenCalledWith(ben);
    expect(removes[1].props.className).toContain("text-status-danger-text");
    expect(screen.getAllByText("Skills").length).toBe(2);
  });

  it("a past lesson's state is a status tag", () => {
    const s: Session = {
      id: null, session_date: "2026-10-10", summary: "",
      progress: { kind: "unmarked", total: 2 } as Session["progress"],
    };
    renderRoster([kid("a", "Anna Tan")], [s], { date: "2026-10-10" });
    expect(screen.getByText("Not marked").props.className).toContain("text-status-warning-text");
  });
});
