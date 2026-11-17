// Phase 2 — ONE invoice per parent, across all their classes — moved verbatim out
// of generateForTenant (EDGE_FUNCTIONS_REFACTOR_PLAN.md B9).
//
// The writes stay per parent and in the same order — insert, items, credit — so one
// parent's failed write still skips only that parent and holds the seal
// (`invoiceWriteFailed`). `created` and `log` are the run's own arrays, pushed in
// the same order as before.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import * as repo from "../dao/billing.repo.ts";
import * as rpc from "../dao/billing.rpc.ts";
import type { CreatedInvoice, InvoiceItem } from "../types.ts";

export async function writeInvoices(
  supabase: SupabaseClient<Database>,
  parentItems: Map<string, InvoiceItem[]>,
  c: {
    tenantId: string;
    billingMonth: string;
    deferredParents: ReadonlySet<string>;
    created: CreatedInvoice[];
    log: unknown[];
  }
): Promise<{ invoicesCreated: number; invoiceWriteFailed: boolean }> {
  const { tenantId, billingMonth, deferredParents, created, log } = c;
  let invoicesCreated = 0;
  // A month with a failed write must never be sealed — sealing would lock out
  // the very retry that would have fixed it.
  let invoiceWriteFailed = false;

  // ── Phase 2: create ONE invoice per parent, across all their classes ──────
  // Two READS that used to run per parent are batched here, once for the
  // tenant-month: which parents already have an invoice, and every balance.
  // The WRITES stay per parent and in the same order — insert, items, credit —
  // so one parent's failed write still skips only that parent (and holds the
  // seal), exactly as before.
  //
  // What batching moves: these rows are read just before the loop instead of
  // just before each parent's insert — a window of one run (~ms on a
  // same-region call). Both reads were already only advisory:
  //   • "already has an invoice" — UNIQUE (parent_id, tenant_id, billing_month)
  //     is the real guard. A concurrent run that bills a parent inside the
  //     window makes THIS run's insert fail (logged, month not sealed by this
  //     run) instead of skipping it. No double bill either way.
  //   • the balance — an ESTIMATE; apply_credit_to_invoice locks and draws from
  //     the real rows. A credit note issued inside the window may be left for
  //     next month's invoice instead of this one (it is never lost or doubled).
  // ⚠ FAIL CLOSED: an unreadable existing-invoice set would bill duplicates
  // into the UNIQUE guard, and an unreadable balance would skip credit; both
  // throw (readPaged) before anything is written.
  const billingAny = [...parentItems.values()].some((items) => items.length > 0);
  const [existingInvoices, balanceRows] = billingAny
    ? await Promise.all([
        repo.readExistingInvoices(supabase, tenantId, billingMonth),
        repo.readBalances(supabase, tenantId),
      ])
    : [[], []];
  const alreadyInvoiced = new Set(existingInvoices.map((i) => i.parent_id));
  const balanceByParent = new Map(balanceRows.map((b) => [b.parent_id, b]));
  // Note: deferredParents can no longer be populated on a run that reaches
  // here (the hard stop above returns first). The check below is kept as an
  // inner guard — it is correct, it costs nothing, and it is the right
  // behaviour if the block is ever relaxed to per-parent.
  // Sorted for deterministic ordering across runs.
  for (const parentId of [...parentItems.keys()].sort()) {
    const items = parentItems.get(parentId)!;
    if (!items.length) continue;

    // A child of theirs sits in a class with unmarked attendance — bill
    // nothing this run rather than lock in a partial invoice.
    if (deferredParents.has(parentId)) {
      log.push({
        parent_id: parentId,
        billing_month: billingMonth,
        skipped: "deferred_incomplete_class",
        pending_items: items.length,
      });
      continue;
    }

    // Chronological, so the invoice and its email read in lesson order even
    // when items come from several classes.
    items.sort(
      (a, b) =>
        a.session_date.localeCompare(b.session_date) ||
        a.class_title.localeCompare(b.class_title) ||
        a.student_id.localeCompare(b.student_id)
    );

    // Skip if this parent already has an invoice for the billing month.
    // Cannot fire within a run any more (each parent is visited exactly
    // once) — this guards RE-RUNS: the daily cron on an unsealed month, or
    // a manual run after an auto one. Removing it reopens double-billing.
    // (batched above — one read for the tenant-month)
    if (alreadyInvoiced.has(parentId)) {
      log.push({
        parent_id: parentId,
        billing_month: billingMonth,
        skipped: "already_exists",
      });
      continue;
    }

    // Credit available FROM THIS TENANT. Never crosses: a note earned at a
    // school is not spendable against a private coach's invoice, or one
    // business ends up paying another's bill. Pools freely across this parent's
    // children WITHIN the tenant.
    // (batched above; no row = no balance, as maybeSingle() returned null)
    const balanceRow = balanceByParent.get(parentId);

    const available = Number(balanceRow?.credit_balance ?? 0);
    // A DEBIT (parent owes us, from a voided-then-paid credit — 20260822000100)
    // is folded onto THIS invoice by apply_credit_to_invoice, which draws credit
    // against the debit-inclusive base so the two net. The values below are an
    // ESTIMATE for the insert; the RPC trues up net/credit/balance_adjustment.
    const debit = Number(balanceRow?.debit_balance ?? 0);
    // Every line is ad-hoc (a package-funded lesson was drawn at marking and
    // dropped above), so credit notes apply to the whole gross.
    const gross = items.reduce((s, i) => s + i.amount, 0);
    const credit = Math.min(available, Math.max(gross, 0));
    const net = gross - credit;

    // Insert invoice
    // package_applied 0 and status from net: see the dao. due_date comes back from the
    // BEFORE INSERT trigger — never sent, never computed here.
    const { data: invoice, error: invErr } = await repo.insertInvoice(
      supabase, parentId, tenantId, billingMonth, gross, credit, net
    );

    if (invErr || !invoice) {
      invoiceWriteFailed = true;
      log.push({
        parent_id: parentId,
        error: invErr?.message ?? "invoice insert failed",
      });
      continue;
    }

    // Insert invoice items. A failure here is NOT cosmetic: the invoice row
    // (carrying gross) is already committed and there is no transaction across
    // these calls, so silently continuing would draw down credit and email a
    // parent an invoice with no line items — and the credit-note trigger,
    // which keys off invoice_items, could never fire for those lessons.
    // Stop before touching money.
    const { error: itemsErr } = await repo.insertInvoiceItems(supabase, items, invoice);

    if (itemsErr) {
      invoiceWriteFailed = true;
      log.push({
        parent_id: parentId,
        invoice_id: invoice.id,
        error: `invoice_items insert failed: ${itemsErr.message}`,
      });
      continue;
    }

    // ── Draw credit + true up the invoice in ONE DB transaction (Item 2) ─────
    // apply_credit_to_invoice (20260818000200) locks the balance row and the
    // notes FOR UPDATE — serialising against the credit-note trigger's
    // un-correction, which also takes FOR UPDATE (20260818000100), and against
    // Item 3's void — draws FIFO, and writes the invoice's OWN
    // credit_applied/net_amount/status. It is idempotent per invoice, so the
    // §7.17 retry path cannot draw the same credit twice. The engine keeps only
    // the RETURNED allocation, for the email/log figures: `credit`/`net`
    // computed above were an ESTIMATE for the insert, which the RPC has now
    // trued up. They agree except when the pooled balance and the note ledger
    // disagree — exactly the double-decrement window this closes.
    // Only when the estimate drew something: with credit === 0 nothing is drawn
    // and the insert's credit_applied/net (both from the same estimate) are
    // already the truth, so there is no discrepancy to reconcile and no
    // double-draw window to guard — skip the round-trip.
    let creditApplied = credit;
    let balanceAdjustment = 0;
    let netApplied = gross - creditApplied;
    if (credit > 0 || debit > 0) {
      const { data: allocated, error: creditErr } = await rpc.applyCreditToInvoice(supabase, invoice);
      if (creditErr) {
        invoiceWriteFailed = true;
        log.push({
          parent_id: parentId,
          invoice_id: invoice.id,
          error: `apply_credit_to_invoice failed: ${creditErr.message}`,
        });
        continue;
      }
      creditApplied = Number(allocated ?? 0);
      // Re-read the trued-up invoice: the RPC folded any pending debit into
      // net_amount and set balance_adjustment. These — not the pre-fold estimate
      // — are the authoritative figures for the email/log.
      const { data: settled, error: readErr } = await repo.readSettledInvoice(supabase, invoice);
      if (readErr || !settled) {
        invoiceWriteFailed = true;
        log.push({
          parent_id: parentId,
          invoice_id: invoice.id,
          error: `re-read settled invoice failed: ${readErr?.message ?? "no row"}`,
        });
        continue;
      }
      balanceAdjustment = Number(settled.balance_adjustment ?? 0);
      netApplied = Number(settled.net_amount ?? netApplied);
    }

    invoicesCreated++;
    created.push({
      invoice_id: invoice.id,
      parent_id: parentId,
      tenant_id: tenantId,
      billing_month: billingMonth,
      gross,
      package: 0,
      credit: creditApplied,
      balance_adjustment: balanceAdjustment,
      net: netApplied,
      due_date: invoice.due_date as string,
      items: items.map((i) => ({
        student_id: i.student_id,
        session_date: i.session_date,
        class_title: i.class_title,
        amount: i.amount,
      })),
    });
    log.push({
      parent_id: parentId,
      invoice_id: invoice.id,
      billing_month: billingMonth,
      gross,
      package: 0,
      credit: creditApplied,
      net: netApplied,
    });
  }

  return { invoicesCreated, invoiceWriteFailed };
}
