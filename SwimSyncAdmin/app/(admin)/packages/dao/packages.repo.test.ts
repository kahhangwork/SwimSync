import { describe, it, expect, vi, beforeEach } from "vitest";

// The Packages page's MONEY reads, pinned query-by-query (§7.314; Wave 8 RISK 4).
// usePackageList reads only `data`, and every money cell of the page goes through
// Number(…) — a malformed select or a dropped filter renders as a clean S$0 or an
// empty list, never an error. A hook test with the dao mocked cannot see a filter
// inside the dao; this can.
//
// The supabase client is replaced by a CHAIN RECORDER: every builder method
// appends [name, ...args] to one log and returns the same proxy. The assertion is
// `toEqual` on the WHOLE log — a partial match would survive an added, dropped or
// reordered filter.
//
// MUTATION PROOFS (§7.25) — each applied by hand, seen red, reverted:
//   1. `.is("reversed_at", null)` deleted from loadRefunds
//      → RED: "loadRefunds reads live (non-reversed) refunds only"
//   2. `amount_payable` deleted from loadPurchases' select
//      → RED: "loadPurchases reads every money column, newest first, capped"
//   3. `package_live_balances` → `package_balances` in liveBalances
//      → RED: "liveBalances calls package_live_balances with no args"

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

import { loadProducts, loadPurchases, loadRefunds } from "./packages.repo";
import { liveBalances, renewalCandidates } from "./packages.rpc";
import { ROW_LIMIT } from "../constants";

beforeEach(() => {
  log.length = 0;
});

describe("packages money reads", () => {
  it("loadPurchases reads every money column, newest first, capped", () => {
    loadPurchases();
    expect(log).toEqual([
      ["from", "parent_packages"],
      [
        "select",
        "id, parent_id, product_id, name, lesson_count, rate_per_lesson, total_value, amount_payable, discount_amount, value_remaining, status, confirmed_at, requested_at, start_date, expires_on, holiday_extension_days, cancel_extension_days, manual_extension_days, reference_number, offered_by, paid_claimed_at, superseded_by, public_token, class_categories(name), parents(profiles(full_name, email))",
      ],
      ["order", "status"],
      ["order", "requested_at", { ascending: false }],
      ["limit", ROW_LIMIT],
    ]);
  });

  it("loadProducts names the category FK (never bare — PGRST201) and reads holders", () => {
    loadProducts();
    expect(log).toEqual([
      ["from", "package_products"],
      [
        "select",
        "id, name, category_id, lesson_count, rate_per_lesson, validity_weeks, is_active, class_categories!package_products_category_id_fkey(name), parent_packages(id, status)",
      ],
      ["order", "is_active", { ascending: false }],
      ["order", "name"],
    ]);
  });

  it("loadRefunds reads live (non-reversed) refunds only", () => {
    loadRefunds();
    expect(log).toEqual([
      ["from", "package_refunds"],
      ["select", "id, parent_package_id, amount, refunded_on, note"],
      ["is", "reversed_at", null],
    ]);
  });

  it("liveBalances calls package_live_balances with no args", () => {
    liveBalances();
    expect(log).toEqual([["rpc", "package_live_balances"]]);
  });

  it("renewalCandidates calls package_renewal_candidates with no args", () => {
    renewalCandidates();
    expect(log).toEqual([["rpc", "package_renewal_candidates"]]);
  });
});
