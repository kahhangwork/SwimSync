import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// useContact — the CLAIMED mode, editable since 2026-11-18 (user feedback: a wrong detail on a linked family meant
// deleting and recreating the child). Pinned: a linked parent's name + phone load into an edit keyed by parents.id;
// Save sends set_parent_contact with a blank phone as NULL and never the email; Unlink sends
// unlink_parent_from_student for THAT parent and this child, then re-reads the contact (the child may now be
// unclaimed); a refusal lands on the parent it names, verbatim.
//
// MUTATION PROOFS (§7.25), each applied to useContact.ts and reverted:
//   1. saveParent's `blankToNull(edit.phone)` → `edit.phone`   → RED "Save sends set_parent_contact…"
//   2. unlinkParent's `await openContact(student)` removed      → RED "Unlink … re-reads the contact"

const { repo, rpc } = vi.hoisted(() => ({
  repo: {
    fetchStudentContact: vi.fn(),
    countPendingClaims: vi.fn(() => Promise.resolve({ count: 0, error: null })),
    updateStudentContact: vi.fn(),
  },
  rpc: {
    setParentContact: vi.fn(() => Promise.resolve({ data: null, error: null })),
    unlinkParentFromStudent: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));
vi.mock("../dao/students.repo", () => repo);
vi.mock("../dao/students.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useContact test reached the real supabase client");
});

import { useContact } from "./useContact";

const kid = { id: "s1", full_name: "Kai" } as any;
const linked = {
  data: {
    provisional_contact_name: null, provisional_contact_phone: null, provisional_contact_email: null,
    parent_students: [{ parents: { id: "p1", profiles: { full_name: "Sarah Lmi", email: "s@x.sg", phone: "9123 456" } } }],
  },
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  repo.fetchStudentContact.mockImplementation(() => Promise.resolve(linked));
});

describe("useContact — a linked parent", () => {
  it("loads the parent's name and phone into an edit keyed by parents.id", async () => {
    const { result } = renderHook(() => useContact(vi.fn(() => Promise.resolve())));
    await act(() => result.current.openContact(kid));
    expect(result.current.contactClaimed).toBe(true);
    expect(result.current.parentEdits.p1).toEqual({ name: "Sarah Lmi", phone: "9123 456" });
  });

  it("Save sends set_parent_contact — trimmed name, blank phone as NULL, no email — and reloads", async () => {
    const reload = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useContact(reload));
    await act(() => result.current.openContact(kid));
    act(() => result.current.setParentField("p1", "name", "  Sarah Lim "));
    act(() => result.current.setParentField("p1", "phone", "  "));
    await act(() => result.current.saveParent("p1"));
    expect(rpc.setParentContact).toHaveBeenCalledWith("p1", "Sarah Lim", null);
    expect(result.current.parentSaved).toBe("p1");
    expect(reload).toHaveBeenCalled();
  });

  it("a blank name sends nothing", async () => {
    const { result } = renderHook(() => useContact(vi.fn(() => Promise.resolve())));
    await act(() => result.current.openContact(kid));
    act(() => result.current.setParentField("p1", "name", "   "));
    await act(() => result.current.saveParent("p1"));
    expect(rpc.setParentContact).not.toHaveBeenCalled();
    expect(result.current.parentError?.id).toBe("p1");
  });

  it("Unlink sends unlink_parent_from_student for that parent and child, reloads, and re-reads the contact", async () => {
    const reload = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useContact(reload));
    await act(() => result.current.openContact(kid));
    repo.fetchStudentContact.mockImplementation(() =>
      Promise.resolve({ data: { ...linked.data, parent_students: [] }, error: null })
    );
    await act(() => result.current.unlinkParent("p1"));
    expect(rpc.unlinkParentFromStudent).toHaveBeenCalledWith("p1", "s1");
    expect(reload).toHaveBeenCalled();
    expect(repo.fetchStudentContact).toHaveBeenCalledTimes(2);
    expect(result.current.contactClaimed).toBe(false);
  });

  it("a refused unlink shows the server's reason on that parent and keeps the link", async () => {
    rpc.unlinkParentFromStudent.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: "This link cannot be removed: Kai has already been billed" } }) as any
    );
    const { result } = renderHook(() => useContact(vi.fn(() => Promise.resolve())));
    await act(() => result.current.openContact(kid));
    await act(() => result.current.unlinkParent("p1"));
    expect(result.current.parentError).toEqual({ id: "p1", message: "This link cannot be removed: Kai has already been billed" });
    expect(result.current.contactClaimed).toBe(true);
  });
});
