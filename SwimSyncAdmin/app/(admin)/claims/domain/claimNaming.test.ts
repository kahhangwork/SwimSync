import { describe, it, expect } from "vitest";
import {
  defaultClaimName,
  shouldApplyName,
  approveNotes,
} from "./claimNaming";

describe("defaultClaimName — RISK 1, the certainty-dependent default", () => {
  it("pre-selects the PARENT's name when the claim is confirmed", () => {
    expect(defaultClaimName("confirmed", "Anya Rahman", "Anya (big)")).toBe(
      "Anya Rahman"
    );
  });

  it("keeps the CURRENT roster name when the claim is unsure", () => {
    // The core of RISK 1: a blind Approve on an unsure claim must NOT overwrite
    // the coach's name with an unverified guess.
    expect(defaultClaimName("unsure", "Anya Rahman", "Anya (big)")).toBe(
      "Anya (big)"
    );
  });
});

describe("shouldApplyName — only a real change is written", () => {
  it("applies a non-empty name that differs", () => {
    expect(shouldApplyName("Anya Rahman", "Anya (big)")).toBe(true);
  });
  it("does not apply an unchanged name", () => {
    expect(shouldApplyName("Anya (big)", "Anya (big)")).toBe(false);
  });
  it("does not apply an unchanged name that differs only by surrounding space", () => {
    expect(shouldApplyName("  Anya (big)  ", "Anya (big)")).toBe(false);
  });
  it("does not apply an empty / whitespace name", () => {
    expect(shouldApplyName("   ", "Anya (big)")).toBe(false);
  });
});

describe("approveNotes — RISK 3, a rename failure never reads as an approval failure", () => {
  it("reports a rename failure as 'linked, name not applied'", () => {
    const notes = approveNotes({
      studentName: "Anya (big)",
      parentName: "Sarah Lim",
      othersDeclined: 0,
      renameError: "Anya Rahman is already registered with this coach or school.",
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("was linked to Sarah Lim");
    expect(notes[0]).toContain("Rename them from the Students list");
    // It must NOT read as a failure to link.
    expect(notes[0]).not.toMatch(/could not link|approval failed/i);
  });

  it("is silent on a clean approve with no competing claim and no rename error", () => {
    expect(
      approveNotes({
        studentName: "Anya",
        parentName: "Sarah Lim",
        othersDeclined: 0,
        renameError: null,
      })
    ).toEqual([]);
  });

  it("still reports an auto-declined competing claim", () => {
    const notes = approveNotes({
      studentName: "Anya",
      parentName: "Sarah Lim",
      othersDeclined: 1,
      renameError: null,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("declined automatically");
  });

  it("reports BOTH the auto-decline and the rename failure when both happen", () => {
    const notes = approveNotes({
      studentName: "Anya",
      parentName: "Sarah Lim",
      othersDeclined: 2,
      renameError: "collision",
    });
    expect(notes).toHaveLength(2);
  });
});
