import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useGender — the Students page's "Set gender" (20261016000100). Pinned: a child with NO recorded gender opens
// with nothing selected (never a default — user, 2026-10-16); a recorded one opens selected; Save goes through
// set_student_gender and nothing else; a refusal is shown verbatim.
//
// MUTATION PROOFS (§7.25), each applied to useGender.ts and reverted:
//   1. pickerValue returns "male" for null        → RED "…opens with nothing selected", "…shows none", "Save with nothing…"
//   2. `if (!genderFor || !gender) return;` → `if (!genderFor) return;` → RED "Save with nothing chosen sends nothing"

const { rpc } = vi.hoisted(() => ({
  rpc: { setStudentGender: vi.fn(() => Promise.resolve({ data: null, error: null })) },
}));
vi.mock("../dao/students.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useGender test reached the real supabase client");
});

import { useGender, pickerValue } from "./useGender";

const kid = (gender: string | null) => ({ id: "s1", full_name: "Kai", gender }) as any;

describe("useGender", () => {
  it("a child with no gender opens with nothing selected", () => {
    const { result } = renderHook(() => useGender(vi.fn(() => Promise.resolve())));
    act(() => result.current.openGender(kid(null)));
    expect(result.current.gender).toBe("");
  });

  it("a recorded gender opens selected; 'other' (never offered) shows none", () => {
    expect(pickerValue("female")).toBe("female");
    expect(pickerValue("other")).toBe("");
  });

  it("Save with nothing chosen sends nothing", async () => {
    const { result } = renderHook(() => useGender(vi.fn(() => Promise.resolve())));
    act(() => result.current.openGender(kid(null)));
    const n = rpc.setStudentGender.mock.calls.length;
    await act(() => result.current.handleSaveGender());
    expect(rpc.setStudentGender.mock.calls.length).toBe(n);
  });

  it("Save sends set_student_gender, closes and reloads", async () => {
    const reload = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useGender(reload));
    act(() => result.current.openGender(kid(null)));
    act(() => result.current.setGender("female"));
    await act(() => result.current.handleSaveGender());
    expect(rpc.setStudentGender).toHaveBeenLastCalledWith("s1", "female");
    expect(result.current.genderFor).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it("a refusal is shown verbatim and the modal stays open", async () => {
    rpc.setStudentGender.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: "only this business's admin may set a child's gender" } }) as any
    );
    const { result } = renderHook(() => useGender(vi.fn(() => Promise.resolve())));
    act(() => result.current.openGender(kid("male")));
    await act(() => result.current.handleSaveGender());
    expect(result.current.genderError).toBe("only this business's admin may set a child's gender");
    expect(result.current.genderFor).not.toBeNull();
  });
});
