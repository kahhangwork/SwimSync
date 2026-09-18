import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AssessmentGrid } from "./AssessmentGrid";
import type { GradeLevel, GradeWrites, Level, RosterStudent, StrokeCell } from "@/lib/assessment";

/**
 * THE GRID'S WRITES, THROUGH THE INJECTED `writes` PROP (Admin L-D,
 * docs/refactor/BATCH_D_PLAN.md RISK 1).
 *
 * Until the writes were injected the grid held the supabase client, so nothing
 * but a Playwright driver could see what it sent. These pin the contract the
 * two callers (assessment/[classId] and the Students grading modal) rely on:
 * which write fires for which gesture, that a paint stroke is ONE deduped
 * request (§7.221 — a re-crossed cell otherwise fails the whole statement),
 * and that a failed stroke rolls back and re-reads.
 */

const T = "tenant-1";
const LEARNING: GradeLevel = { id: "g1", rank: 1, label: "Learning" };
const MASTERED: GradeLevel = { id: "g2", rank: 2, label: "Mastered" };
const SCALE = [LEARNING, MASTERED];

const LEVELS: Level[] = [
  {
    id: "L1",
    label: "Seahorse",
    sort_order: 1,
    skills: [
      { id: "k1", label: "Kick", sort_order: 1 },
      { id: "k2", label: "Float", sort_order: 2 },
    ],
  },
  { id: "L2", label: "Dolphin", sort_order: 2, skills: [] },
];

// Everything counts as this round, so freshness never hides a button.
const SINCE = "2000-01-01";
const NOW = "2026-09-18T02:00:00.000Z";

function child(progress: RosterStudent["progress"] = []): RosterStudent[] {
  return [{ id: "s1", full_name: "Maya", level_id: "L1", progress }];
}

function fakeWrites(fail = false) {
  const res = () => Promise.resolve({ error: fail ? { message: "boom" } : null });
  return {
    upsertGrades: vi.fn((_cells: StrokeCell[]) => res()),
    clearGrade: vi.fn((_studentId: string, _skillId: string) => res()),
    promoteStudent: vi.fn((_studentId: string, _levelId: string) => res()),
  } satisfies GradeWrites;
}

function mount(roster: RosterStudent[], writes: GradeWrites, onReload = vi.fn()) {
  const view = render(
    <AssessmentGrid
      tenantId={T}
      roster={roster}
      levels={LEVELS}
      scale={SCALE}
      since={SINCE}
      onReload={onReload}
      writes={writes}
    />
  );
  // The skill cells, in column order (k1, k2). Captured once: React keeps the
  // same DOM nodes across re-renders, so they stay valid after a paint.
  const cells = Array.from(view.container.querySelectorAll("tbody td button")).slice(0, 2);
  return { ...view, cells, onReload };
}

const flush = () => act(async () => {});

afterEach(() => {
  vi.useRealTimers();
});

describe("AssessmentGrid — injected writes", () => {
  it("(a) a cycle click on an ungraded cell upserts ONE cell, carrying tenant_id", async () => {
    const w = fakeWrites();
    const { cells } = mount(child(), w);

    fireEvent.click(cells[0]);
    await flush();

    expect(w.upsertGrades).toHaveBeenCalledTimes(1);
    expect(w.upsertGrades).toHaveBeenCalledWith([
      { student_id: "s1", skill_id: "k1", tenant_id: T, grade_level_id: "g1" },
    ]);
    expect(w.clearGrade).not.toHaveBeenCalled();
  });

  it("(b) cycling past the top grade CLEARS — a delete, never an upsert", async () => {
    const w = fakeWrites();
    const { cells } = mount(
      child([{ skill_id: "k1", grade_level_id: "g2", graded_at: NOW }]),
      w
    );

    fireEvent.click(cells[0]);
    await flush();

    expect(w.clearGrade).toHaveBeenCalledTimes(1);
    expect(w.clearGrade).toHaveBeenCalledWith("s1", "k1");
    expect(w.upsertGrades).not.toHaveBeenCalled();
  });

  it("(c) a paint stroke is ONE upsert, deduped (a re-crossed cell appears once)", async () => {
    vi.useFakeTimers();
    const w = fakeWrites();
    const { cells } = mount(child(), w);

    fireEvent.click(screen.getByRole("button", { name: "Learning" }));
    fireEvent.click(cells[0]);
    fireEvent.click(cells[1]);
    fireEvent.click(cells[0]); // re-cross
    expect(w.upsertGrades).not.toHaveBeenCalled(); // still collecting

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(w.upsertGrades).toHaveBeenCalledTimes(1);
    const sent = w.upsertGrades.mock.calls[0][0];
    expect(sent).toHaveLength(2);
    expect(sent.map((c) => c.skill_id).sort()).toEqual(["k1", "k2"]);
    expect(sent.every((c) => c.grade_level_id === "g1" && c.tenant_id === T)).toBe(true);
  });

  it("(d) a failed stroke restores EVERY painted cell and re-reads once", async () => {
    vi.useFakeTimers();
    const w = fakeWrites(true);
    const { cells, onReload } = mount(child(), w);

    fireEvent.click(screen.getByRole("button", { name: "Learning" }));
    fireEvent.click(cells[0]);
    fireEvent.click(cells[1]);
    expect(cells[0].textContent).toContain("Learning"); // optimistic

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await flush();

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(cells[0].textContent).toBe("—");
    expect(cells[1].textContent).toBe("—");
    expect(screen.getByText(/none of them were/)).toBeTruthy();
  });

  it("(e) Move up promotes through promoteStudent(studentId, nextLevelId)", async () => {
    const w = fakeWrites();
    const onReload = vi.fn();
    mount(
      child([
        { skill_id: "k1", grade_level_id: "g2", graded_at: NOW },
        { skill_id: "k2", grade_level_id: "g2", graded_at: NOW },
      ]),
      w,
      onReload
    );

    fireEvent.click(screen.getByRole("button", { name: /Move up to Dolphin/ }));
    await flush();

    expect(w.promoteStudent).toHaveBeenCalledTimes(1);
    expect(w.promoteStudent).toHaveBeenCalledWith("s1", "L2");
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Maya moved up to Dolphin.")).toBeTruthy();
  });
});
