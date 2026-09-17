// Characterisation tests (Admin L-C, BATCH_C_PLAN.md): pin the row mapping and
// the derived "expired" status as they were inline on referrals/page.tsx. They
// pin existing behaviour, so §7.25's prove-it-red rule does not apply.
import { describe, it, expect } from "vitest";
import { displayStatus, toMemberships, toReferrals, toRewards } from "./referralRows";
import type { Reward } from "../types";

describe("toMemberships", () => {
  it("reads the name through an array OR object embed, and defaults to —", () => {
    const m = toMemberships([
      { id: "pt1", parent_id: "p1", referral_code: "REF-AAAAA", referral_code_disabled_at: null,
        parents: [{ profiles: [{ full_name: "Ann" }] }] },
      { id: "pt2", parent_id: "p2", parents: { profiles: { full_name: "Bob" } } },
      { id: "pt3", parent_id: "p3", parents: null },
    ]);
    expect(m.map((x) => x.name)).toEqual(["Ann", "Bob", "—"]);
    expect(m[0]).toEqual({ membership_id: "pt1", parent_id: "p1", name: "Ann", code: "REF-AAAAA", disabled_at: null });
    expect(m[1].code).toBeNull();
    expect(m[1].disabled_at).toBeNull();
  });

  it("null rows is an empty list", () => {
    expect(toMemberships(null)).toEqual([]);
  });
});

describe("toReferrals / toRewards", () => {
  const names = new Map([["p1", "Ann"]]);

  it("names resolve by parent id; an unknown id is —", () => {
    const [r] = toReferrals(
      [{ id: "r1", referrer_parent_id: "p1", referee_parent_id: "px", status: "pending", created_at: "2026-09-01" }],
      names
    );
    expect(r).toEqual({ id: "r1", referrer: "Ann", referee: "—", status: "pending",
      void_reason: null, created_at: "2026-09-01", converted_at: null });
  });

  it("reward maps beneficiary and nulls the optional fields", () => {
    const [w] = toRewards([{ id: "w1", parent_id: "p1", kind: "referrer", status: "available", earned_at: "e" }], names);
    expect(w).toEqual({ id: "w1", beneficiary: "Ann", kind: "referrer", status: "available",
      earned_at: "e", expires_at: null, void_reason: null });
  });
});

describe("displayStatus (RISK 14 — derived, no write)", () => {
  const base: Reward = { id: "w", beneficiary: "A", kind: "referrer", status: "available",
    earned_at: "2020-01-01", expires_at: null, void_reason: null };

  it("available + past expiry reads expired", () => {
    expect(displayStatus({ ...base, expires_at: "2000-01-01T00:00:00Z" })).toBe("expired");
  });
  it("available + future expiry, or no expiry, stays available", () => {
    expect(displayStatus({ ...base, expires_at: "2999-01-01T00:00:00Z" })).toBe("available");
    expect(displayStatus(base)).toBe("available");
  });
  it("a non-available reward is never relabelled, even past expiry", () => {
    expect(displayStatus({ ...base, status: "used", expires_at: "2000-01-01T00:00:00Z" })).toBe("used");
  });
});
