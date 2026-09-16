"use client";

import { formatSgDate } from "@/lib/lessonDates";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { UnclaimedStudent } from "../types";
import { formatBillingMonth } from "../domain/invoiceRows";

/** ── Billable lessons with nobody to bill ────────────────────────────
 *  These hold the month OPEN (the engine's fifth seal condition). The remedy is
 *  offered INLINE rather than as a link elsewhere: this is the one screen where
 *  the admin is already thinking about closing the month, and a single forgotten
 *  walk-in stalls every family's invoice. There is deliberately no bulk "settle
 *  all" — that would turn a deliberate decision about money into one careless tap. */
export function UnclaimedModal({
  unclaimed,
  genMonth,
  settling,
  settleAmount,
  setSettleAmount,
  settleError,
  onSettle,
  onClose,
}: {
  unclaimed: UnclaimedStudent[];
  genMonth: string;
  settling: string | null;
  settleAmount: Record<string, string>;
  setSettleAmount: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  settleError: string | null;
  onSettle: (
    u: UnclaimedStudent,
    kind: "paid_outside" | "written_off",
    amount: number | null
  ) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Some lessons have no parent account to bill"
      open={unclaimed.length > 0}
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          These children attended billable lessons but have no parent account
          yet, so nobody can be invoiced. {formatBillingMonth(genMonth)} stays
          open until each is resolved — otherwise the month would close over
          them and the lessons could never be billed, even after the parent
          registers.
        </p>

        <ul className="space-y-3">
          {unclaimed.map((u) => (
            <li
              key={u.student_id}
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
            >
              <p className="text-sm font-semibold text-gray-800">
                {u.student_name ?? "Unnamed student"}
              </p>
              <p className="mt-0.5 text-xs text-gray-600">
                {u.lessons} billable lesson{u.lessons === 1 ? "" : "s"} ·{" "}
                {u.earliest_session_date === u.latest_session_date
                  ? formatSgDate(u.earliest_session_date)
                  : `${formatSgDate(u.earliest_session_date)} – ${formatSgDate(
                      u.latest_session_date
                    )}`}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-xs text-gray-600">
                  S$
                  <input
                    value={settleAmount[u.student_id] ?? ""}
                    onChange={(e) =>
                      setSettleAmount((prev) => ({
                        ...prev,
                        [u.student_id]: e.target.value,
                      }))
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`Amount received for ${u.student_name ?? "student"}`}
                    className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={
                    settling === u.student_id ||
                    !(Number(settleAmount[u.student_id]) > 0)
                  }
                  onClick={() =>
                    onSettle(u, "paid_outside", Number(settleAmount[u.student_id]))
                  }
                >
                  Paid outside SwimSync
                </Button>
                <Button
                  variant="outline"
                  disabled={settling === u.student_id}
                  onClick={() => onSettle(u, "written_off", null)}
                >
                  Write off
                </Button>
              </div>
            </li>
          ))}
        </ul>

        {settleError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {settleError}
          </p>
        )}

        <p className="text-xs text-gray-600">
          The better fix is usually to <strong>invite the parent</strong> from
          the Students page — then the lessons bill normally and nothing is
          written off. Settle only when the money was genuinely handled
          elsewhere, or is not being collected.
        </p>
        <Button className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
