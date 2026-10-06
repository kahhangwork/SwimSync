// coachPay.repo — the exact PostgREST chains of the coach's My Pay money read (Wave 8,
// RISK 4 / §7.314). RLS scopes payouts to the coach; these chains carry the order, the
// limits and the item filter — drop one and a coach's month silently misreads.
// `toEqual` on the WHOLE recorded list.
//
// MUTATION PROOFS (applied by hand, restored from HEAD, 2026-10-06):
//   1. `.limit(12)` → `.limit(6)` in fetchMyPayouts → RED "payouts …"
//   2. drop `is_adjustment` from fetchPayoutItems' select → RED "payout items …"
//   3. `.in("payout_id", …)` → `.in("id", …)` → RED "payout items …"
import { fetchMyPayouts, fetchPayoutItems } from "./coachPay.repo";
import { ITEM_LIMIT } from "../constants";

const mockChain: unknown[][] = [];
jest.mock("@/lib/supabase", () => {
  const proxy: any = new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === "then") return undefined;
        return (...args: unknown[]) => {
          mockChain.push([name, ...args]);
          return proxy;
        };
      },
    }
  );
  return { supabase: proxy };
});

beforeEach(() => {
  mockChain.length = 0;
});

describe("coachPay.repo money chains", () => {
  it("payouts: the coach's last 12 months, newest first (RLS scopes to the coach)", () => {
    fetchMyPayouts();
    expect(mockChain).toEqual([
      ["from", "coach_payouts"],
      ["select", "id, period_month, gross_amount, status"],
      ["order", "period_month", { ascending: false }],
      ["limit", 12],
    ]);
  });

  it("payout items: the lines of THESE payouts, adjustments marked, capped", () => {
    fetchPayoutItems(["p1", "p2"]);
    expect(mockChain).toEqual([
      ["from", "coach_payout_items"],
      ["select", "payout_id, class_title, session_date, amount, is_adjustment, original_period"],
      ["in", "payout_id", ["p1", "p2"]],
      ["limit", ITEM_LIMIT],
    ]);
  });
});
