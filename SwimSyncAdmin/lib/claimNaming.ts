// The naming decisions on the claim-approval screen, pure so they are testable
// away from the page and its Supabase calls. (STUDENT_RENAME_PLAN.md steps 3-4.)
//
// Two rules live here, both load-bearing:
//   • which name the picker DEFAULTS to (⚠ RISK 1), and
//   • what the admin is TOLD after approving (⚠ RISK 3).

export type Certainty = "confirmed" | "unsure";

/**
 * ⚠ RISK 1 — the default is certainty-dependent. Pre-fill the parent's typed
 * name only when they CONFIRMED the child is theirs; on an `unsure` claim keep
 * the current roster name so a blind Approve cannot overwrite the coach's name
 * with an unverified guess. Applying the parent's name on an unsure claim then
 * takes an explicit act by the admin.
 */
export function defaultClaimName(
  certainty: Certainty,
  claimedName: string,
  studentName: string
): string {
  return certainty === "confirmed" ? claimedName : studentName;
}

/**
 * Apply the chosen name only when it is a real change — a non-empty value that
 * differs from what the child already carries. Empty means "leave it".
 */
export function shouldApplyName(chosen: string, currentName: string): boolean {
  const trimmed = chosen.trim();
  return trimmed !== "" && trimmed !== currentName;
}

/**
 * ⚠ RISK 3 — what to surface after a successful approve. The link is the
 * irreversible half and has already happened; a rename FAILURE here is a
 * separate, retryable step and must read as "linked, name not applied", never
 * as an approval failure (re-approving throws "already decided"). A competing
 * auto-declined claim is also reported, because the admin would otherwise go
 * hunting for it.
 */
export function approveNotes(input: {
  studentName: string;
  parentName: string;
  othersDeclined: number;
  renameError: string | null;
}): string[] {
  const notes: string[] = [];
  if (input.othersDeclined > 0) {
    notes.push(
      `${input.studentName} is now linked to ${input.parentName}. ` +
        `${input.othersDeclined} other request on this child was declined automatically.`
    );
  }
  if (input.renameError) {
    notes.push(
      `${input.studentName} was linked to ${input.parentName}, but the name ` +
        `couldn't be changed: ${input.renameError} Rename them from the Students list.`
    );
  }
  return notes;
}
