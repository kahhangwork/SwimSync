"use client";

import { Button } from "@/components/Button";
import type { PendingDebit } from "../types";

/** A parent's pending charge — money owed from a correction to an already-paid
 *  invoice, folded onto their next invoice automatically. Shown here so a LEAVER
 *  with no next invoice can be written off and offboarded. No bulk action —
 *  settling is a decision about money. */
export function PendingDebits({
  pendingDebits,
  writingOff,
  pendingDebitError,
  onWriteOff,
}: {
  pendingDebits: PendingDebit[];
  writingOff: string | null;
  pendingDebitError: string | null;
  onWriteOff: (row: PendingDebit) => void;
}) {
  return (
    <>
      {pendingDebitError && (
        <p
          data-testid="pending-debit-error"
          className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {pendingDebitError}
        </p>
      )}

      {pendingDebits.length > 0 && (
        <div
          data-testid="pending-debits"
          className="mb-5 rounded-2xl border border-indigo-300 bg-indigo-50 p-4"
        >
          <p className="text-sm font-semibold text-indigo-900">
            Pending charges — not yet invoiced
          </p>
          <p className="mt-1 text-xs text-indigo-800">
            A correction to an already-paid invoice left this amount owing. It is
            folded onto the family&apos;s next invoice automatically. If the family
            is leaving and has no next invoice, collect it directly, then write it
            off here so they can be offboarded.
          </p>

          <ul className="mt-3 space-y-3">
            {pendingDebits.map((row) => {
              const key = `${row.parent_id}:${row.tenant_id}`;
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2.5"
                >
                  <p className="text-sm font-semibold text-gray-800">
                    {row.parent_name}
                    <span className="ml-2 font-normal text-gray-600">
                      owes S${row.debit_balance.toFixed(2)}
                    </span>
                  </p>
                  <Button
                    variant="outline"
                    disabled={writingOff === key}
                    onClick={() => onWriteOff(row)}
                  >
                    Write off
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
