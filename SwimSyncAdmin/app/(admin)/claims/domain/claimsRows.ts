// Parent Requests (claims) — pure derivations and labels. No React, no network.
// Carries unit tests (claimsRows.test.ts). (claimNaming.ts, the naming rules,
// lives beside this — moved here from lib/ as this is its sole importer.)

import { formatSgDate, toSgDate } from "@/lib/lessonDates";
import type { Claim } from "../types";

export function reasonLabel(reason: string): string {
  switch (reason) {
    case "email":
      return "Their registered email matches the address recorded on this child";
    case "phone":
      return "Their registered phone matches the contact number on this child";
    case "name_dob":
      return "Name and date of birth both match";
    case "name_only":
      return "Name is similar — no date of birth to check against";
    case "name_only_phone_differs":
      return "⚠ Name is similar, but the contact number on this child is DIFFERENT from the parent's. Could be the child's other parent — check before approving.";
    default:
      return reason;
  }
}

export function partitionClaims(claims: Claim[]): {
  pending: Claim[];
  decided: Claim[];
} {
  return {
    pending: claims.filter((c) => c.status === "pending"),
    decided: claims.filter((c) => c.status !== "pending"),
  };
}

// Two pending requests on ONE child is a conflict the admin must see BEFORE
// choosing, not after — approving either one closes the other.
export function contestedStudentIds(pending: Claim[]): Set<string> {
  return new Set(
    pending
      .map((c) => c.student_id)
      .filter((id, i, arr) => arr.indexOf(id) !== i)
  );
}

/** The day a claim was asked or decided, as "26 Jul" — from its timestamptz.
 *  The SINGAPORE day: `stamp.slice(0, 10)` was the UTC day, a day early for
 *  anything 00:00–07:59 SGT (Bug ledger #5, §7.7). Callers pass a non-null stamp
 *  (created_at is NOT NULL; decided_at is checked before the call). */
export function claimDayLabel(stamp: string): string {
  return formatSgDate(toSgDate(stamp), { day: "numeric", month: "short" });
}
