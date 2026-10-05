import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// usePendingDebits — the Pending charges slice (WAVE3_RENDER_TESTS_PLAN.md 1.2.2).
// What is load-bearing:
//   • it reads with the tenant it is GIVEN (RISK 6 — the page passes its own);
//   • a write-off forgives THE ROW's (parent, tenant) — the RPC's arguments — but
//     the reload afterwards is the HOOK's tenant, never the row's. The fixture row
//     sits at tB while the hook is tenant-A, so the two cannot be confused by
//     accident (asserted below, so a fixture edit cannot make the proof vacuous);
//   • a write-off is a decision about money: cancel or a blank reason sends
//     NOTHING; the busy key is exactly `${parent}:${tenant}`, the format the
//     panel disables on;
//   • a failed read clears the list rather than leaving a stale one standing.
// jsdom does not implement window.prompt: every test stubs it, and the default
// stub THROWS so an unstubbed path fails loudly (RISK 9).
//
// MUTATION PROOFS (§7.25) — each applied to domain/usePendingDebits.ts via mutate.sh:
//   1. `if (tenantId) await loadPendingDebits(tenantId);` → `await loadPendingDebits(row.tenant_id);`
//      → RED: "a write-off forgives THE ROW's balance, then reloads the HOOK's tenant"
//   2. `if (reason.trim() === "") {` → `if (false) {`
//      → RED: "a blank reason sends nothing and says a reason is required"
//   3. `if (reason === null) return; // cancelled` → removed
//      → RED: "cancelling the prompt sends nothing"
//   4. `setPendingDebits([]); // don't leave a stale list` → removed
//      → RED: "a failed read clears the list and says why"
//   5. `const key = \`${row.parent_id}:${row.tenant_id}\`;` → `const key = row.parent_id;`
//      → RED: "the busy key is parent:tenant while the write-off is in flight"
//   6. `parent_name: row.parents?.profiles?.full_name ?? "—"` → `?? ""`
//      → RED: "maps a row exactly, and names a missing parent with a dash"

const { repo, rpc } = vi.hoisted(() => ({
  repo: { fetchPendingDebits: vi.fn() },
  rpc: { writeOffParentBalance: vi.fn() },
}));

vi.mock("../dao/invoices.repo", () => repo);
vi.mock("../dao/invoices.rpc", () => rpc);
vi.mock("@/lib/supabase", () => {
  throw new Error("tripwire: usePendingDebits test reached the real supabase client");
});

import { usePendingDebits } from "./usePendingDebits";

const HOOK_TENANT = "tenant-A";
const ROW_RAW = {
  parent_id: "p1",
  tenant_id: "tB",
  debit_balance: "12.50",
  parents: { profiles: { full_name: "Dan" } },
};
const ROW = { parent_id: "p1", tenant_id: "tB", parent_name: "Dan", debit_balance: 12.5 };

let promptSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  repo.fetchPendingDebits.mockReset();
  rpc.writeOffParentBalance.mockReset();
  repo.fetchPendingDebits.mockResolvedValue({ data: [ROW_RAW], error: null });
  rpc.writeOffParentBalance.mockResolvedValue({ error: null });
  // A test that reaches the prompt without saying what it returns fails.
  promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => {
    throw new Error("unstubbed prompt");
  });
});

afterEach(() => {
  promptSpy.mockRestore();
});

async function loaded() {
  const h = renderHook(() => usePendingDebits(HOOK_TENANT));
  await act(() => h.result.current.loadPendingDebits(HOOK_TENANT));
  return h;
}

describe("usePendingDebits", () => {
  it("reads with the tenant it is given", async () => {
    await loaded();
    expect(repo.fetchPendingDebits).toHaveBeenCalledTimes(1);
    expect(repo.fetchPendingDebits).toHaveBeenCalledWith(HOOK_TENANT);
  });

  it("maps a row exactly, and names a missing parent with a dash", async () => {
    repo.fetchPendingDebits.mockResolvedValue({
      data: [ROW_RAW, { parent_id: "p2", tenant_id: "tA", debit_balance: 3, parents: null }],
      error: null,
    });
    const { result } = await loaded();
    expect(result.current.pendingDebits).toEqual([
      ROW,
      { parent_id: "p2", tenant_id: "tA", parent_name: "—", debit_balance: 3 },
    ]);
    expect(result.current.pendingDebitError).toBeNull();
  });

  it("a failed read clears the list and says why", async () => {
    const { result } = await loaded();
    expect(result.current.pendingDebits).toEqual([ROW]);
    repo.fetchPendingDebits.mockResolvedValue({ data: null, error: { message: "nope" } });
    await act(() => result.current.loadPendingDebits(HOOK_TENANT));
    expect(result.current.pendingDebits).toEqual([]);
    expect(result.current.pendingDebitError).toBe("nope");
  });

  it("a write-off forgives THE ROW's balance, then reloads the HOOK's tenant", async () => {
    // The proof below is only real while these differ.
    expect(ROW.tenant_id).not.toEqual(HOOK_TENANT);
    const { result } = await loaded();
    promptSpy.mockImplementation(() => "  family left  ");
    await act(() => result.current.handleWriteOff(ROW));
    expect(rpc.writeOffParentBalance).toHaveBeenCalledTimes(1);
    expect(rpc.writeOffParentBalance).toHaveBeenCalledWith("p1", "tB", "family left");
    expect(repo.fetchPendingDebits.mock.calls).toEqual([[HOOK_TENANT], [HOOK_TENANT]]);
    expect(result.current.pendingDebitError).toBeNull();
    expect(result.current.writingOff).toBeNull();
  });

  it("cancelling the prompt sends nothing", async () => {
    const { result } = await loaded();
    promptSpy.mockImplementation(() => null);
    await act(() => result.current.handleWriteOff(ROW));
    expect(rpc.writeOffParentBalance).not.toHaveBeenCalled();
    expect(result.current.pendingDebitError).toBeNull();
  });

  it("a blank reason sends nothing and says a reason is required", async () => {
    const { result } = await loaded();
    promptSpy.mockImplementation(() => "   ");
    await act(() => result.current.handleWriteOff(ROW));
    expect(rpc.writeOffParentBalance).not.toHaveBeenCalled();
    expect(result.current.pendingDebitError).toBe(
      "A reason is required to write off a balance."
    );
  });

  it("the busy key is parent:tenant while the write-off is in flight", async () => {
    const { result } = await loaded();
    let release!: (v: { error: null }) => void;
    rpc.writeOffParentBalance.mockImplementation(
      () => new Promise((r) => (release = r))
    );
    promptSpy.mockImplementation(() => "reason");
    let done!: Promise<void>;
    act(() => {
      done = result.current.handleWriteOff(ROW);
    });
    expect(result.current.writingOff).toBe("p1:tB");
    await act(async () => {
      release({ error: null });
      await done;
    });
    expect(result.current.writingOff).toBeNull();
  });

  it("a refused write-off is said out loud and nothing is reloaded", async () => {
    const { result } = await loaded();
    rpc.writeOffParentBalance.mockResolvedValue({ error: { message: "refused" } });
    promptSpy.mockImplementation(() => "reason");
    await act(() => result.current.handleWriteOff(ROW));
    expect(result.current.pendingDebitError).toBe("refused");
    expect(repo.fetchPendingDebits).toHaveBeenCalledTimes(1);
    expect(result.current.writingOff).toBeNull();
  });
});
