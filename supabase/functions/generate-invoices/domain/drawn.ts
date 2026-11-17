// Lessons a package already paid for at marking, dropped from the tally — moved
// verbatim out of generateForTenant (EDGE_FUNCTIONS_REFACTOR_PLAN.md B8).
//
// FAIL CLOSED is the whole point of this file: an unreadable drawn set is
// `{ stop: package_mode_unreadable }` — no invoice, no seal, never a throw — and
// never an empty set, which would bill a lesson the family already paid for.
// `parentItems` is filtered IN PLACE, exactly as before.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import * as repo from "../dao/billing.repo.ts";
import type { GenerateResult, InvoiceItem } from "../types.ts";

export async function dropDrawnLessons(
  supabase: SupabaseClient<Database>,
  parentItems: Map<string, InvoiceItem[]>,
  c: { tenantId: string; billingMonth: string; mode: "auto" | "manual"; force: boolean; log: unknown[] }
): Promise<{ stop: GenerateResult } | { go: true }> {
  const { tenantId, billingMonth, mode, force, log } = c;

  // ── Lessons a package ALREADY paid for at marking ─────────────────────────
  // docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md. Attendance triggers draw
  // the package the moment a lesson is marked (package_candidates_for is the one
  // matching rule), so a drawn lesson is PAID and must never reach an invoice
  // line (the DB backstop on invoice_items would refuse it — PK002 — and fail
  // the run's write). The engine matches no package itself: the pay-at-the-run
  // matcher and its tenants.package_draw_at_marking switch were removed
  // (BACKLOG Wave 9 item 9). Every remaining item is ad-hoc at its class price.
  //
  // ⚠ FAIL CLOSED (RISK 1, §7.325): an unreadable drawn set returns
  // package_mode_unreadable — no invoice, no seal, never a throw (§7.265). Do NOT
  // default the drawn set to empty: that bills a lesson the family already paid
  // for.
  const itemSessionIds = [
    ...new Set([...parentItems.values()].flat().map((i) => i.lesson_session_id)),
  ];
  const drawnKeys = new Set<string>();
  // Chunked: an .in() list rides the URL, and a month of sessions can be long.
  for (let i = 0; i < itemSessionIds.length; i += 200) {
    const { data: drawnRows, error: drawnErr } = await repo.readDrawnChunk(supabase, itemSessionIds, i);
    if (drawnErr || !drawnRows) {
      return { stop: packageModeUnreadable(
        drawnErr ? drawnErr.message : "the package draws could not be read"
      ) };
    }
    for (const r of drawnRows) {
      drawnKeys.add(`${r.lesson_session_id}:${r.student_id}`);
    }
  }
  if (drawnKeys.size) {
    for (const [parentId, items] of parentItems) {
      parentItems.set(
        parentId,
        items.filter((i) => !drawnKeys.has(`${i.lesson_session_id}:${i.student_id}`))
      );
    }
  }

  function packageModeUnreadable(reason: string): GenerateResult {
    return {
      tenant_id: tenantId,
      billing_month: billingMonth,
      mode,
      forced: force,
      status: "package_mode_unreadable",
      invoices_created: 0,
      sealed: false,
      message:
        `Could not read which lessons a package has already paid for (${reason}). ` +
        `No invoices were generated and the month was left open — generate again.`,
      results: log,
    };
  }

  return { go: true };
}
