import { describe, it, expect, vi, beforeEach } from "vitest";

// fetchPendingDebits — the CLIENT half of the Pending charges tenant scope
// (PARTIAL_PAYMENT_FOLLOWUPS_PLAN.md RISK 6; WAVE3_RENDER_TESTS_PLAN.md 1.2.1).
// The scope is enforced in TWO places: this query's `.eq("tenant_id", …)` and the
// parent_tenant_balances_select policy's `tenant_id = current_tenant_id()` arm.
// A platform admin sees every tenant's invoices on this page, so if the filter
// went, one tenant's pending debit could be listed — and written off — under
// another's Invoices page. This pins the client half only; pgTAP owns the policy.
//
// The supabase client is replaced by a CHAIN RECORDER: every builder method
// appends [name, ...args] to one log and returns the same proxy. The assertion is
// `toEqual` on the WHOLE log — a partial match (arrayContaining) would survive an
// added, dropped or reordered filter.
//
// MUTATION PROOFS (§7.25) — each applied to dao/invoices.repo.ts via mutate.sh:
//   1. `.eq("tenant_id", tenantId)` deleted from fetchPendingDebits
//      → RED: "reads one tenant's pending debits, and only debits"
//   2. `.eq("tenant_id", tenantId)` → `.eq("tenant_id", "x")`
//      → RED: "reads one tenant's pending debits, and only debits"
//   3. `.gt("debit_balance", 0)` → `.gte("debit_balance", 0)`
//      → RED: "reads one tenant's pending debits, and only debits"
//
// Wave 8 (the invoice list + the may-not-have-arrived read, §7.314), each applied
// by hand, seen red, reverted:
//   4. `net_amount` deleted from fetchInvoices' select
//      → RED: both "fetchInvoices — …" cases
//   5. the parent search's `profiles!inner` → `profiles`
//      → RED: "fetchInvoices — a parent search inner-joins and filters in the DB"
//   6. `.eq("invoice_email_state", "MAY_HAVE_SENT")` deleted
//      → RED: "fetchMayNotHaveArrived — one tenant's MAY_HAVE_SENT invoices, oldest claim first"

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

import { fetchInvoices, fetchMayNotHaveArrived, fetchPendingDebits } from "./invoices.repo";
import { ROW_LIMIT } from "../constants";

beforeEach(() => {
  log.length = 0;
});

describe("fetchPendingDebits", () => {
  it("reads one tenant's pending debits, and only debits", () => {
    fetchPendingDebits("tenant-A");
    expect(log).toEqual([
      ["from", "parent_tenant_balances"],
      ["select", "parent_id, tenant_id, debit_balance, parents(profiles(full_name))"],
      ["eq", "tenant_id", "tenant-A"],
      ["gt", "debit_balance", 0],
    ]);
  });
});

describe("fetchInvoices — the invoice list (money)", () => {
  it("fetchInvoices — no search reads every money column, LEFT-joined, newest first, capped", () => {
    fetchInvoices("", "parent");
    expect(log).toEqual([
      ["from", "invoices"],
      ["select", "id, billing_month, gross_amount, package_applied, credit_applied, balance_adjustment, net_amount, status, reference_number, public_token, reminded_at, paid_claimed_at, parents(profiles(full_name, phone)), invoice_items(student_name, students(full_name))"],
      ["order", "generated_at", { ascending: false }],
      ["limit", ROW_LIMIT],
    ]);
  });

  it("fetchInvoices — a parent search inner-joins and filters in the DB", () => {
    fetchInvoices("ann", "parent");
    expect(log).toEqual([
      ["from", "invoices"],
      ["select", "id, billing_month, gross_amount, package_applied, credit_applied, balance_adjustment, net_amount, status, reference_number, public_token, reminded_at, paid_claimed_at, parents!inner(profiles!inner(full_name, phone)), invoice_items(student_name, students(full_name))"],
      ["order", "generated_at", { ascending: false }],
      ["limit", ROW_LIMIT],
      ["ilike", "parents.profiles.full_name", "%ann%"],
    ]);
  });
});

describe("fetchMayNotHaveArrived", () => {
  it("fetchMayNotHaveArrived — one tenant's MAY_HAVE_SENT invoices, oldest claim first", () => {
    fetchMayNotHaveArrived("tenant-A");
    expect(log).toEqual([
      ["from", "invoices"],
      ["select", "id, billing_month, reference_number, invoice_email_claimed_at, parents(profiles(full_name))"],
      ["eq", "tenant_id", "tenant-A"],
      ["eq", "invoice_email_state", "MAY_HAVE_SENT"],
      ["order", "invoice_email_claimed_at", { ascending: true }],
    ]);
  });
});
