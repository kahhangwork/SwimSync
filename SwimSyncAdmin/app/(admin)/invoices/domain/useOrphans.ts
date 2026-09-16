import { useState } from "react";
import type { OrphanLine } from "../types";
import * as repo from "../dao/invoices.repo";
import * as rpc from "../dao/invoices.rpc";
import { settlementPayload } from "./settlementPayload";

/** The standing orphan-lesson report (Wave 4): lessons recorded into an
 *  already-BILLED month. A STANDING section, not a modal — the failure mode is
 *  silence, so each line persists until a settlement covers it. `loadOrphans`
 *  takes an explicit tenant id because loadTenant calls it with the freshly-read
 *  id before the tenant state has settled. */
export function useOrphans(tenantId: string | null) {
  const [orphans, setOrphans] = useState<OrphanLine[]>([]);
  const [orphanSettling, setOrphanSettling] = useState<string | null>(null);
  const [orphanAmount, setOrphanAmount] = useState<Record<string, string>>({});
  const [orphanError, setOrphanError] = useState<string | null>(null);

  /** Server-computed: the predicate ("billable, inside a sealed month, no
   *  invoice line, no live settlement") lives in unbilled_sealed_lessons() where
   *  pgTAP pins it — not re-derived here, where it would drift. */
  async function loadOrphans(tid: string) {
    const { data, error } = await rpc.unbilledSealedLessons(tid);
    if (!error) setOrphans((data ?? []) as OrphanLine[]);
  }

  /**
   * Settle one orphan line. Same mechanism as useUnclaimed's handleSettle — the
   * month is already sealed, so nothing is holding it open; the settlement is
   * purely the record of what happened to the money.
   *
   * `settled_through` is the line's LATEST lesson date: it covers exactly what
   * was reported and no more, so a lesson backdated in NEXT week reports again
   * and is decided deliberately.
   */
  async function handleSettleOrphan(
    line: OrphanLine,
    kind: "paid_outside" | "written_off",
    amount: number | null
  ) {
    if (!tenantId) return;
    setOrphanSettling(`${line.student_id}:${line.billing_month}`);
    const {
      data: { user },
    } = await repo.getUser();

    const { error } = await repo.insertSettlement(
      settlementPayload({
        tenantId,
        studentId: line.student_id,
        settledThrough: line.latest_session_date,
        kind,
        amount,
        recordedBy: user?.id,
      })
    );

    setOrphanSettling(null);
    if (error) {
      setOrphanError(error.message);
      return;
    }
    setOrphanError(null);
    // Refetch rather than filter: a settlement dated through this month also
    // covers the same child's EARLIER sealed months, so other lines can clear.
    await loadOrphans(tenantId);
  }

  return {
    orphans,
    orphanSettling,
    orphanAmount,
    setOrphanAmount,
    orphanError,
    loadOrphans,
    handleSettleOrphan,
  };
}
