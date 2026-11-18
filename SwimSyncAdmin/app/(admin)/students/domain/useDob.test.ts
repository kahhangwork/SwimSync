import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useDob — the Students page's "Date of birth" (20261118000100). Pinned: opens with the recorded DOB; an emptied field
// CLEARS it (sends null, never ""); Save goes through set_student_date_of_birth and nothing else; a refusal is shown
// verbatim and the modal stays open.
//
// MUTATION PROOFS (§7.25), each applied to useDob.ts and reverted:
//   1. `dob === "" ? null : dob` → `dob`                → RED "an emptied field clears the DOB"
//   2. `setDob(student.date_of_birth ?? "")` → `setDob("")` → RED "opens with the recorded DOB"

const { rpc } = vi.hoisted(() => ({
  rpc: { setStudentDateOfBirth: vi.fn(() => Promise.resolve({ data: null, error: null })) },
}));
vi.mock("../dao/students.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useDob test reached the real supabase client");
});

import { useDob } from "./useDob";

const kid = (date_of_birth: string | null) => ({ id: "s1", full_name: "Kai", date_of_birth }) as any;

describe("useDob", () => {
  it("opens with the recorded DOB", () => {
    const { result } = renderHook(() => useDob(vi.fn(() => Promise.resolve())));
    act(() => result.current.openDob(kid("2018-04-01")));
    expect(result.current.dob).toBe("2018-04-01");
  });

  it("Save sends set_student_date_of_birth, closes and reloads", async () => {
    const reload = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useDob(reload));
    act(() => result.current.openDob(kid(null)));
    act(() => result.current.setDob("2019-02-03"));
    await act(() => result.current.handleSaveDob());
    expect(rpc.setStudentDateOfBirth).toHaveBeenLastCalledWith("s1", "2019-02-03");
    expect(result.current.dobFor).toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it("an emptied field clears the DOB (null, never an empty string)", async () => {
    const { result } = renderHook(() => useDob(vi.fn(() => Promise.resolve())));
    act(() => result.current.openDob(kid("2018-04-01")));
    act(() => result.current.setDob(""));
    await act(() => result.current.handleSaveDob());
    expect(rpc.setStudentDateOfBirth).toHaveBeenLastCalledWith("s1", null);
  });

  it("a refusal is shown verbatim and the modal stays open", async () => {
    rpc.setStudentDateOfBirth.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: "a date of birth cannot be in the future" } }) as any
    );
    const { result } = renderHook(() => useDob(vi.fn(() => Promise.resolve())));
    act(() => result.current.openDob(kid(null)));
    act(() => result.current.setDob("2030-01-01"));
    await act(() => result.current.handleSaveDob());
    expect(result.current.dobError).toBe("a date of birth cannot be in the future");
    expect(result.current.dobFor).not.toBeNull();
  });
});
