import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// useReferrals.voidReferral (CARRIED_OVER_REFERRAL_BLOCK_PLAN Step 2). Load-bearing:
//   • cancelling the prompt sends NOTHING — the void is irreversible;
//   • the reason is trimmed (blank → the server's "Voided by admin");
//   • the RPC's refusal (e.g. a discount the family has already paid) is shown, and
//     no reload hides it.
// jsdom does not implement window.prompt: every test stubs it.
//
// MUTATION PROOFS (§7.25) — each applied to domain/useReferrals.ts, run, reverted:
//   1. `if (reason === null) return;` removed            → RED: "cancelling the prompt sends nothing"
//   2. `p_referral_id: id, p_reason: reason.trim()` → `…: reason` → RED: "sends the referral id and the trimmed reason"
//   3. `if (error) setError(error.message);` → `if (error) load();` → RED: "a refusal is shown"

const { repo, rpc } = vi.hoisted(() => ({
  repo: {
    myTenantId: vi.fn(), loadSettings: vi.fn(), loadMemberships: vi.fn(),
    loadReferrals: vi.fn(), loadRewards: vi.fn(), saveSettings: vi.fn(),
  },
  rpc: { voidReferral: vi.fn(), voidReferralReward: vi.fn(), grantReferralReward: vi.fn(), setReferralCodeDisabled: vi.fn() },
}));
vi.mock("../dao/referrals.repo", () => repo);
vi.mock("../dao/referrals.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: useReferrals test reached the real supabase client");
});

import { useReferrals } from "./useReferrals";

let promptSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.values(repo).forEach((f) => f.mockReset());
  Object.values(rpc).forEach((f) => f.mockReset());
  repo.myTenantId.mockResolvedValue("t1");
  repo.loadSettings.mockResolvedValue({ data: null, error: null });
  repo.loadMemberships.mockResolvedValue({ data: [], error: null });
  repo.loadReferrals.mockResolvedValue({ data: [], error: null });
  repo.loadRewards.mockResolvedValue({ data: [], error: null });
  rpc.voidReferral.mockResolvedValue({ error: null });
  promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => {
    throw new Error("unstubbed window.prompt");
  });
});
afterEach(() => promptSpy.mockRestore());

async function mounted() {
  const h = renderHook(() => useReferrals());
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
}

describe("useReferrals.voidReferral", () => {
  it("cancelling the prompt sends nothing", async () => {
    const h = await mounted();
    promptSpy.mockReturnValue(null);
    await act(() => h.result.current.voidReferral("r1"));
    expect(rpc.voidReferral).not.toHaveBeenCalled();
  });

  it("sends the referral id and the trimmed reason, then reloads", async () => {
    const h = await mounted();
    promptSpy.mockReturnValue("  Existing customer  ");
    const loadsBefore = repo.loadReferrals.mock.calls.length;
    await act(() => h.result.current.voidReferral("r1"));
    expect(rpc.voidReferral).toHaveBeenCalledWith({ p_referral_id: "r1", p_reason: "Existing customer" });
    await waitFor(() => expect(repo.loadReferrals.mock.calls.length).toBe(loadsBefore + 1));
  });

  it("a refusal is shown, not reloaded away", async () => {
    const h = await mounted();
    promptSpy.mockReturnValue("x");
    rpc.voidReferral.mockResolvedValue({
      error: { message: "This reward is on a package the family has already paid — it cannot be voided." },
    });
    const loadsBefore = repo.loadReferrals.mock.calls.length;
    await act(() => h.result.current.voidReferral("r1"));
    expect(h.result.current.error).toBe("This reward is on a package the family has already paid — it cannot be voided.");
    expect(repo.loadReferrals.mock.calls.length).toBe(loadsBefore);
  });
});
