import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useStudentStatus — the confirmation after Set inactive (user, 2026-10-16).
// The list opens on Active now, so a child set inactive LEAVES the table; the
// old "Inactive" badge was the only confirmation and it no longer shows. The
// hook names who was set inactive and where to find them.
// PROOF (§7.25): run against the hook before this change and recorded RED there
// (it returned no `flash`).

const { rpc } = vi.hoisted(() => ({
  rpc: {
    familyActiveChildren: vi.fn(() =>
      Promise.resolve({
        children: [
          { student_id: "s1", full_name: "Ethan Tan", is_self: true },
          { student_id: "s2", full_name: "Mia Tan", is_self: false },
        ],
      })
    ),
    setStudentsActive: vi.fn(() => Promise.resolve({ error: undefined as string | undefined })),
    removeFromClass: vi.fn(() => Promise.resolve({ error: undefined as string | undefined })),
  },
}));
vi.mock("../dao/students.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useStudentStatus test reached the real supabase client");
});

import { useStudentStatus } from "./useStudentStatus";

const ethan = { id: "s1", full_name: "Ethan Tan" } as any;

describe("useStudentStatus — after Set inactive", () => {
  it("names the child and says where they went", async () => {
    const { result } = renderHook(() => useStudentStatus(vi.fn(() => Promise.resolve())));
    await act(() => result.current.openInactive(ethan));
    await act(() => result.current.handleStatusChange(ethan, "inactive"));
    expect(result.current.flash).toBe("Ethan Tan set inactive. Find them under the Inactive filter.");
    act(() => result.current.dismissFlash());
    expect(result.current.flash).toBeNull();
  });

  it("names every sibling taken along", async () => {
    const { result } = renderHook(() => useStudentStatus(vi.fn(() => Promise.resolve())));
    await act(() => result.current.openInactive(ethan));
    act(() => result.current.setTakeSiblings(true));
    await act(() => result.current.handleStatusChange(ethan, "inactive"));
    expect(result.current.flash).toBe("Ethan Tan and Mia Tan set inactive. Find them under the Inactive filter.");
  });

  it("says nothing on a refusal — the error says it instead", async () => {
    rpc.setStudentsActive.mockImplementationOnce(() => Promise.resolve({ error: "nope" }));
    const { result } = renderHook(() => useStudentStatus(vi.fn(() => Promise.resolve())));
    await act(() => result.current.openInactive(ethan));
    await act(() => result.current.handleStatusChange(ethan, "inactive"));
    expect(result.current.flash ?? null).toBeNull();
    expect(result.current.actionError).toContain("nope");
  });
});
