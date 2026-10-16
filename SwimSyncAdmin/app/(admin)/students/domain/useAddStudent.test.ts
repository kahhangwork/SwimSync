import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useAddStudent — gender is required, never pre-selected (20261016000100; user 2026-10-16). Every admin-added
// child before this had no gender: add_unclaimed_student took none.
//
// RED FIRST (§7.25) against useAddStudent before this change: "a student without a gender…" → the rpc was
// called; "the gender chosen is sent" → p_gender missing.

const { rpc, start } = vi.hoisted(() => ({
  rpc: {
    findRosterDuplicates: vi.fn(() => Promise.resolve({ data: [], error: null })),
    addUnclaimedStudent: vi.fn(() => Promise.resolve({ data: "s-new", error: null })),
  },
  start: {
    fetchStartBounds: vi.fn(() => Promise.resolve({ data: null, error: { message: "n/a" } })),
    setEnrolmentStart: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  },
}));
vi.mock("../dao/students.rpc", () => rpc);
vi.mock("@/lib/enrolmentStart.rpc", () => start);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useAddStudent test reached the real supabase client");
});

import { useAddStudent } from "./useAddStudent";

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

async function filled() {
  const reload = vi.fn(() => Promise.resolve());
  const h = renderHook(() => useAddStudent("t1", reload));
  act(() => h.result.current.open());
  act(() => {
    h.result.current.setAddName("Anya Tan");
    h.result.current.setAddClassId("c1");
    h.result.current.setAddPhone("9123 4567");
  });
  await settle();
  return h.result;
}

describe("useAddStudent — gender", () => {
  it("opens with no gender chosen", async () => {
    const result = await filled();
    expect(result.current.addGender).toBe("");
  });

  it("a student without a gender is not added", async () => {
    const result = await filled();
    const n = rpc.addUnclaimedStudent.mock.calls.length;
    await act(() => result.current.handleAddStudent());
    expect(rpc.addUnclaimedStudent.mock.calls.length).toBe(n);
  });

  it("the gender chosen is sent", async () => {
    const result = await filled();
    act(() => result.current.setAddGender("male"));
    await act(() => result.current.handleAddStudent());
    expect(rpc.addUnclaimedStudent).toHaveBeenLastCalledWith(
      expect.objectContaining({ p_full_name: "Anya Tan", p_kind: "ongoing", p_gender: "male" })
    );
  });

  it("reopening the form clears the last child's gender", async () => {
    const result = await filled();
    act(() => result.current.setAddGender("female"));
    act(() => result.current.close());
    act(() => result.current.open());
    expect(result.current.addGender).toBe("");
  });
});
