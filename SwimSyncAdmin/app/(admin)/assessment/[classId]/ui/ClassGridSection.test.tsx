import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ClassGridSection } from "./ClassGridSection";
import type { AssessClassState } from "../domain/useAssessClass";

// The bug: Move up flashed "X moved up to Y." and then called onReload, which
// flipped this section to "Loading…" — UNMOUNTING the grid, and the message
// with it. The child vanished from one sub-table with no word about it.
describe("ClassGridSection — a reload of the same class keeps the grid mounted", () => {
  const NOW = "2026-09-24T02:00:00.000Z";
  const base = {
    since: "2000-01-01",
    info: { title: "Sat", day_of_week: "Saturday", start_time: "10:00", location: null, tenant_id: "t1" },
    roster: [
      {
        id: "s1",
        full_name: "Maya",
        level_id: "L1",
        progress: [{ skill_id: "k1", grade_level_id: "g2", graded_at: NOW }],
      },
    ],
    levels: [
      { id: "L1", label: "Seahorse", sort_order: 1, skills: [{ id: "k1", label: "Kick", sort_order: 1 }] },
      { id: "L2", label: "Dolphin", sort_order: 2, skills: [] },
    ],
    scale: [
      { id: "g1", rank: 1, label: "Learning" },
      { id: "g2", rank: 2, label: "Mastered" },
    ],
    error: null,
    load: vi.fn(),
    gradeWrites: {
      upsertGrades: vi.fn(() => Promise.resolve({ error: null })),
      clearGrade: vi.fn(() => Promise.resolve({ error: null })),
      promoteStudent: vi.fn(() => Promise.resolve({ error: null })),
    },
    classId: "c1",
    loadedFor: "c1",
  };
  const state = (over: Partial<AssessClassState>) => ({ ...base, loading: false, ...over }) as unknown as AssessClassState;

  it("the 'moved up' message survives the re-read", async () => {
    const view = render(<ClassGridSection s={state({})} />);
    fireEvent.click(screen.getByRole("button", { name: /Move up to Dolphin/ }));
    await act(async () => {});
    expect(screen.getByText("Maya moved up to Dolphin.")).toBeTruthy();

    // The page re-reads: loading, same class.
    view.rerender(<ClassGridSection s={state({ loading: true })} />);
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByText("Maya moved up to Dolphin.")).toBeTruthy();
    // …but takes no clicks until the re-read lands.
    expect(view.container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("a DIFFERENT class still shows Loading, never the previous class's rows", () => {
    render(<ClassGridSection s={state({ loading: true, classId: "c2", loadedFor: "c1" })} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("Maya")).toBeNull();
  });
});
