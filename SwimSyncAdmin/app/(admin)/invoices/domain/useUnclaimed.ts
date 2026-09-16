import { useState } from "react";
import { settlementPayload } from "@/lib/settlementPayload";
import type { UnclaimedStudent } from "../types";
import * as repo from "../dao/invoices.repo";
import { formatBillingMonth } from "./invoiceRows";

/** Billable lessons with nobody to bill — they hold the month OPEN (the engine's
 *  fifth seal condition). `unclaimed` is also SET by the generation run, so the
 *  hook exposes `setUnclaimed` for useGenerate to fill; settling is a decision
 *  about money, so there is deliberately no bulk action. */
export function useUnclaimed({
  genMonth,
  setGenResult,
}: {
  genMonth: string;
  setGenResult: (s: string | null) => void;
}) {
  const [unclaimed, setUnclaimed] = useState<UnclaimedStudent[]>([]);
  const [settling, setSettling] = useState<string | null>(null);
  // Amount per student for the "paid outside SwimSync" path. Required by the
  // DB, deliberately: student_settlements CHECKs that a paid_outside row
  // carries an amount, so "the money arrived" can never be recorded without
  // saying how much. That is what makes these rows summable later
  // (BACKLOG → Revenue reporting).
  const [settleAmount, setSettleAmount] = useState<Record<string, string>>({});
  const [settleError, setSettleError] = useState<string | null>(null);

  /**
   * Record that an unclaimed student's lessons are settled — the money arrived
   * outside SwimSync, or is being written off. Either way the month can then
   * close.
   *
   * `settled_through` is the student's LATEST unbilled lesson in this run, not
   * "today": the settlement must cover exactly what was reported and no more,
   * so a lesson they attend next month still blocks and is still decided
   * deliberately.
   */
  async function handleSettle(
    u: UnclaimedStudent,
    kind: "paid_outside" | "written_off",
    amount: number | null
  ) {
    setSettling(u.student_id);
    const {
      data: { user },
    } = await repo.getUser();

    const { data: student } = await repo.fetchStudentTenant(u.student_id);

    const { error } = await repo.insertSettlement(
      settlementPayload({
        tenantId: student?.tenant_id,
        studentId: u.student_id,
        settledThrough: u.latest_session_date,
        kind,
        amount,
        recordedBy: user?.id,
      })
    );

    setSettling(null);
    if (error) {
      // Shown INSIDE the modal. genResult renders on the page behind it, so an
      // error surfaced there is invisible while the dialog is open — which is
      // how a failing insert first looked like a silent no-op.
      setSettleError(error.message);
      return;
    }
    setSettleError(null);
    setUnclaimed((prev) => prev.filter((x) => x.student_id !== u.student_id));
    setGenResult(
      `Recorded for ${u.student_name ?? "that student"}. Generate again to close ` +
        `${formatBillingMonth(genMonth)}.`
    );
  }

  return {
    unclaimed,
    setUnclaimed,
    settling,
    settleAmount,
    setSettleAmount,
    settleError,
    handleSettle,
    close: () => setUnclaimed([]),
  };
}
