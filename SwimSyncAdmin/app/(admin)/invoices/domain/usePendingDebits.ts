import { useState } from "react";
import type { PendingDebit } from "../types";
import * as repo from "../dao/invoices.repo";
import * as rpc from "../dao/invoices.rpc";

/** A parent's pending DEBIT, before it bills (§8.83). Scoped to THIS tenant
 *  (RISK 6): a platform admin sees every tenant's invoices in the table, but the
 *  debit view is filtered to their own tenant, so tenant B's debit is never shown
 *  against tenant A's rows. `loadPendingDebits` takes an explicit tenant id
 *  because loadTenant / a generation run call it with a known id. */
export function usePendingDebits(tenantId: string | null) {
  const [pendingDebits, setPendingDebits] = useState<PendingDebit[]>([]);
  const [writingOff, setWritingOff] = useState<string | null>(null);
  const [pendingDebitError, setPendingDebitError] = useState<string | null>(null);

  async function loadPendingDebits(tid: string) {
    const { data, error } = await repo.fetchPendingDebits(tid);
    if (error) {
      setPendingDebitError(error.message);
      setPendingDebits([]); // don't leave a stale list standing behind an error
      return;
    }
    setPendingDebitError(null);
    setPendingDebits(
      (data ?? []).map((row: any) => ({
        parent_id: row.parent_id,
        tenant_id: row.tenant_id,
        parent_name: row.parents?.profiles?.full_name ?? "—",
        debit_balance: Number(row.debit_balance ?? 0),
      }))
    );
  }

  /**
   * Clear a parent's pending debit so a leaver can be offboarded. The RPC forgives
   * it in-app (audited); if the money is actually owed, the admin collects it
   * out-of-band (PayNow/cash) — there is deliberately no in-app charge for this
   * rare case. A reason is required.
   */
  async function handleWriteOff(row: PendingDebit) {
    const reason = window.prompt(
      `Write off S$${row.debit_balance.toFixed(2)} owed by ${row.parent_name}?\n\n` +
        `This clears the pending charge in SwimSync. Collect any money owed ` +
        `directly (PayNow/cash) first. Enter a reason for the record:`
    );
    if (reason === null) return; // cancelled
    if (reason.trim() === "") {
      setPendingDebitError("A reason is required to write off a balance.");
      return;
    }
    const key = `${row.parent_id}:${row.tenant_id}`;
    setWritingOff(key);
    const { error } = await rpc.writeOffParentBalance(
      row.parent_id,
      row.tenant_id,
      reason.trim()
    );
    setWritingOff(null);
    if (error) {
      setPendingDebitError(error.message);
      return;
    }
    setPendingDebitError(null);
    if (tenantId) await loadPendingDebits(tenantId);
  }

  return {
    pendingDebits,
    writingOff,
    pendingDebitError,
    loadPendingDebits,
    handleWriteOff,
  };
}
