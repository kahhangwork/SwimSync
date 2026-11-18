import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReferralsSection } from "./ReferralsSection";
import type { Referral } from "../types";

// ReferralsSection — the Void referral action (CARRIED_OVER_REFERRAL_BLOCK_PLAN Step 2).
// Load-bearing: the button appears on PENDING rows only, is labelled "Void referral"
// (never bare "Void" — the Rewards table's Void is a different action, plan RISK 7),
// passes the ROW's id, and is disabled while busy.
//
// MUTATION PROOFS (§7.25) — each applied, run, reverted:
//   1. canVoidReferral → `r.status !== "converted"`  → RED: "exactly one Void referral button…"
//   2. onClick → onVoid(referrals[0].id)              → RED: "passes the row's own id"

const row = (id: string, status: string): Referral => ({
  id, referrer: "Ann", referee: `Friend ${id}`, status, void_reason: status === "void" ? "same_household" : null,
  created_at: "2026-11-01T02:00:00Z", converted_at: status === "converted" ? "2026-11-05T02:00:00Z" : null,
});

describe("ReferralsSection — Void referral", () => {
  it("exactly one Void referral button for one pending, one converted and one void row", () => {
    render(<ReferralsSection referrals={[row("r1", "converted"), row("r2", "pending"), row("r3", "void")]}
                             busy={false} onVoid={() => {}} />);
    expect(screen.getAllByRole("button", { name: "Void referral" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Void" })).toBeNull();
  });

  it("passes the row's own id", () => {
    const onVoid = vi.fn();
    render(<ReferralsSection referrals={[row("r1", "converted"), row("r2", "pending")]} busy={false} onVoid={onVoid} />);
    fireEvent.click(screen.getByRole("button", { name: "Void referral" }));
    expect(onVoid).toHaveBeenCalledWith("r2");
  });

  it("is disabled while busy", () => {
    render(<ReferralsSection referrals={[row("r2", "pending")]} busy={true} onVoid={() => {}} />);
    expect((screen.getByRole("button", { name: "Void referral" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
