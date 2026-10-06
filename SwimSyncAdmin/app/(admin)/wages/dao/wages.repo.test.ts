import { describe, it, expect, vi, beforeEach } from "vitest";

// The Wages page's MONEY reads and its two irreversible-ish writes, pinned
// query-by-query (§7.314; Wave 8 RISK 4). usePayroll and useWages read only
// `data`, and every amount goes through Number(…): a dropped tenant or period
// filter shows another tenant's or another month's payroll — beside a "Mark
// paid" button — and a malformed select shows S$0. A hook test with the dao
// mocked cannot see a filter inside the dao; this can.
//
// The supabase client is replaced by a CHAIN RECORDER: every builder method
// appends [name, ...args] to one log and returns the same proxy. The assertion is
// `toEqual` on the WHOLE log — a partial match would survive an added, dropped or
// reordered filter.
//
// MUTATION PROOFS (§7.25) — each applied by hand, seen red, reverted:
//   1. `.eq("period_month", period)` deleted from loadPayouts
//      → RED: "loadPayouts reads one tenant's month, with its items"
//   2. `role` deleted from loadCoaches' coach_rates embed
//      → RED: "loadCoaches reads one tenant's coaches with every rate and its role"
//   3. `p_payout_id` → `p_id` in markPayoutPaid
//      → RED: "markPayoutPaid passes its args through untouched"

const { log } = vi.hoisted(() => ({ log: [] as unknown[][] }));

vi.mock("@/lib/supabase", () => {
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        // Not a thenable — the test inspects the builder, it never awaits it.
        if (prop === "then") return undefined;
        return (...args: unknown[]) => {
          log.push([String(prop), ...args]);
          return chain;
        };
      },
    }
  );
  return { supabase: chain };
});

import { loadCoaches, loadPayouts } from "./wages.repo";
import { generateCoachPayouts, markPayoutPaid } from "./wages.rpc";

beforeEach(() => {
  log.length = 0;
});

describe("wages money reads", () => {
  it("loadPayouts reads one tenant's month, with its items", () => {
    loadPayouts("tenant-A", "2026-09");
    expect(log).toEqual([
      ["from", "coach_payouts"],
      [
        "select",
        "id, coach_id, gross_amount, status, coach_payout_items(id, lesson_session_id, class_title, session_date, basis, minutes, amount, is_adjustment, original_period)",
      ],
      ["eq", "tenant_id", "tenant-A"],
      ["eq", "period_month", "2026-09"],
    ]);
  });

  it("loadCoaches reads one tenant's coaches with every rate and its role", () => {
    loadCoaches("tenant-A");
    expect(log).toEqual([
      ["from", "coaches"],
      ["select", "id, profiles(full_name), coach_rates(amount, unit_minutes, effective_from, role)"],
      ["eq", "tenant_id", "tenant-A"],
    ]);
  });
});

describe("wages RPCs", () => {
  it("generateCoachPayouts passes its args through untouched", () => {
    generateCoachPayouts({ p_tenant_id: "tenant-A", p_period_month: "2026-09" });
    expect(log).toEqual([
      ["rpc", "generate_coach_payouts", { p_tenant_id: "tenant-A", p_period_month: "2026-09" }],
    ]);
  });

  it("markPayoutPaid passes its args through untouched", () => {
    markPayoutPaid({ p_payout_id: "payout-1" });
    expect(log).toEqual([["rpc", "mark_payout_paid", { p_payout_id: "payout-1" }]]);
  });
});
