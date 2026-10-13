// The coach's read-only skills screen — app/(coach)/classes/[id]/grade.tsx — with its
// one hook mocked. Pinned (UI restyle step 2.5): each skill's grade is a status TAG,
// the top grade (done) in Success and anything short of it — or no grade yet —
// neutral, the word saying which.
//
// MUTATION PROOF (§7.25): `tone={sk.done ? "success" : "neutral"}` → `tone="neutral"`
// → RED: "the top grade is a Success tag; the rest are neutral".
import React from "react";
import { render, screen } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useFocusEffect: () => {},
}));
jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

const mockScale = [
  { id: "g1", rank: 1, label: "Learning" },
  { id: "g2", rank: 2, label: "Achieved" },
];
const mockSkills = [
  { id: "k1", label: "Float", sort_order: 1 },
  { id: "k2", label: "Kick", sort_order: 2 },
  { id: "k3", label: "Breathe", sort_order: 3 },
];
jest.mock("@/features/grade/domain/useStudentGrades", () => ({
  useStudentGrades: () => ({
    loading: false,
    student: { full_name: "Anna Tan", level_label: "Level 1", level_note: null },
    skills: mockSkills,
    scale: mockScale,
    loadData: () => {},
    summary: jest.requireActual("@/lib/skillProgress").summariseSkillProgress(
      mockSkills,
      [
        { skill_id: "k1", grade_level_id: "g2" },
        { skill_id: "k2", grade_level_id: "g1" },
      ],
      mockScale
    ),
  }),
}));

// eslint-disable-next-line import/first
import StudentSkillsScreen from "@/app/(coach)/classes/[id]/grade";

describe("coach skills screen", () => {
  it("the top grade is a Success tag; the rest are neutral", () => {
    render(<StudentSkillsScreen />);
    expect(screen.getByText("Achieved").props.className).toContain("text-status-success-text");
    expect(screen.getByText("Learning").props.className).toContain("text-status-neutral-text");
    expect(screen.getByText("Not yet graded").props.className).toContain("text-status-neutral-text");
  });
});
