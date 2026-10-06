import { describe, it, expect, vi, beforeEach } from "vitest";

// The Credit Notes page's MONEY read, pinned query-by-query (§7.314; Wave 8
// RISK 4). useCreditNoteList reads only `data` and every amount goes through
// Number(…): a dropped column shows S$0, and a dropped `credit_applications`
// embed silently disarms the part-spent guard (RISK 2 — has_applications false
// on every row). A hook test with the dao mocked cannot see either; this can.
//
// The supabase client is replaced by a CHAIN RECORDER: every builder method
// appends [name, ...args] to one log and returns the same proxy. The assertion is
// `toEqual` on the WHOLE log — a partial match would survive an added, dropped or
// reordered filter.
//
// MUTATION PROOFS (§7.25) — each applied by hand, seen red, reverted:
//   1. `credit_applications(credit_note_id, reversed_at)` deleted from the select
//      → RED: all three cases
//   2. the parent search's `profiles!inner` → `profiles`
//      → RED: "a parent search inner-joins the searched embed and filters in the DB"
//   3. the reference search's `"reference_number"` → `"student_name"`
//      → RED: "a reference search filters the base column, embeds left plain"

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

import { loadNotes } from "./creditNotes.repo";
import { ROW_LIMIT } from "../constants";

const COLS =
  "id, reference_number, amount, reason, status, applied_to_invoice_id, issued_at, student_name, email_sent_at, credit_note_email_state, tenant_id, credit_applications(credit_note_id, reversed_at), students(id, full_name), ";

beforeEach(() => {
  log.length = 0;
});

describe("loadNotes — the credit-note list (money)", () => {
  it("no search reads every money column and the live-application embed, LEFT-joined", () => {
    loadNotes("", "parent");
    expect(log).toEqual([
      ["from", "credit_notes"],
      ["select", `${COLS}parents(profiles(full_name))`],
      ["order", "issued_at", { ascending: false }],
      ["limit", ROW_LIMIT],
    ]);
  });

  it("a parent search inner-joins the searched embed and filters in the DB", () => {
    loadNotes("mum", "parent");
    expect(log).toEqual([
      ["from", "credit_notes"],
      ["select", `${COLS}parents!inner(profiles!inner(full_name))`],
      ["order", "issued_at", { ascending: false }],
      ["limit", ROW_LIMIT],
      ["ilike", "parents.profiles.full_name", "%mum%"],
    ]);
  });

  it("a reference search filters the base column, embeds left plain", () => {
    loadNotes("CN-1", "reference");
    expect(log).toEqual([
      ["from", "credit_notes"],
      ["select", `${COLS}parents(profiles(full_name))`],
      ["order", "issued_at", { ascending: false }],
      ["limit", ROW_LIMIT],
      ["ilike", "reference_number", "%CN-1%"],
    ]);
  });
});
