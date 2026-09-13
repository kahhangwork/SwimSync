// CHARACTERISATION test (playbook §0): pins behaviour the claims page already
// had. Not a new rule, so §7.25's prove-red-first does not apply.

import { describe, expect, it } from "vitest";
import { contestedStudentIds, partitionClaims, reasonLabel } from "./claimsRows";
import type { Claim } from "../types";

const claim = (over: Partial<Claim>): Claim =>
  ({
    id: "c", status: "pending", certainty: "confirmed", match_reason: "email",
    created_at: "", decided_at: null, claimed_name: "", claimed_dob: null,
    student_id: "s", student_name: "", student_dob: null, lessons: 0,
    parent_id: "p", parent_name: "", parent_email: "", parent_phone: null,
    ...over,
  }) as Claim;

describe("claims domain — pure derivations", () => {
  it("labels known reasons, and falls back to the raw string", () => {
    expect(reasonLabel("name_dob")).toBe("Name and date of birth both match");
    expect(reasonLabel("something_else")).toBe("something_else");
  });

  it("partitions pending vs everything-else", () => {
    const claims = [
      claim({ id: "a", status: "pending" }),
      claim({ id: "b", status: "approved" }),
      claim({ id: "c", status: "declined" }),
      claim({ id: "d", status: "withdrawn" }),
    ];
    const { pending, decided } = partitionClaims(claims);
    expect(pending.map((c) => c.id)).toEqual(["a"]);
    expect(decided.map((c) => c.id)).toEqual(["b", "c", "d"]);
  });

  it("marks a student contested only when >1 PENDING claim names them", () => {
    const pending = [
      claim({ id: "1", student_id: "kid" }),
      claim({ id: "2", student_id: "kid" }),
      claim({ id: "3", student_id: "other" }),
    ];
    const contested = contestedStudentIds(pending);
    expect(contested.has("kid")).toBe(true);
    expect(contested.has("other")).toBe(false);
  });
});
