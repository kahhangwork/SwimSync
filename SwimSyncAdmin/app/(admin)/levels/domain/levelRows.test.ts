import { describe, it, expect } from "vitest";
import { toLevels } from "./levelRows";

// Characterisation: pins what the page's load() computed before it moved here
// (Admin L-D). A change is a behaviour change, not a refactor.

describe("toLevels", () => {
  it("counts ACTIVE and FORMER children apart, off the joined students", () => {
    const [l] = toLevels([
      {
        id: "L1", label: "Seahorse", sort_order: 1, note: "Progress to B3",
        students: [{ id: "a", is_active: true }, { id: "b", is_active: false }, { id: "c", is_active: true }],
        tenant_level_skills: [],
      },
    ]);
    expect(l).toEqual({
      id: "L1", label: "Seahorse", sort_order: 1, note: "Progress to B3",
      student_count: 2, inactive_count: 1, skills: [],
    });
  });

  it("keeps a level held ONLY by departed children (0 active) — it must not vanish", () => {
    const [l] = toLevels([
      { id: "L2", label: "Dolphin", sort_order: 2, note: null, students: [{ id: "x", is_active: false }], tenant_level_skills: null },
    ]);
    expect(l.student_count).toBe(0);
    expect(l.inactive_count).toBe(1);
  });

  it("orders skills by sort_order, then label (PostgREST can't order an embed)", () => {
    const [l] = toLevels([
      {
        id: "L1", label: "A", sort_order: 1, note: null, students: null,
        tenant_level_skills: [
          { id: "s3", label: "Kick", sort_order: 2 },
          { id: "s2", label: "Bubbles", sort_order: 1 },
          { id: "s1", label: "Aeroplane", sort_order: 1 },
        ],
      },
    ]);
    expect(l.skills.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(l.student_count).toBe(0);
  });

  it("does not mutate the embedded skills array", () => {
    const embedded = [{ id: "b", label: "B", sort_order: 2 }, { id: "a", label: "A", sort_order: 1 }];
    toLevels([{ id: "L", label: "L", sort_order: 1, note: null, students: [], tenant_level_skills: embedded }]);
    expect(embedded.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("null data is an empty ladder", () => {
    expect(toLevels(null)).toEqual([]);
  });
});
