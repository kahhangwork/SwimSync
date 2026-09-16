"use client";

import { formatSgDate } from "@/lib/lessonDates";
import { Button } from "@/components/Button";
import type { OrphanLine } from "../types";
import { formatBillingMonth } from "../domain/invoiceRows";

/** Lessons recorded into an already-BILLED month (Wave 4). A STANDING section,
 *  deliberately not a modal or a one-time warning: the failure mode is silence,
 *  and a message that can be dismissed is gone. Each line persists until a
 *  settlement covers it. No bulk action — settling is a decision about money. */
export function OrphanReport({
  orphans,
  orphanAmount,
  setOrphanAmount,
  orphanSettling,
  orphanError,
  onSettle,
}: {
  orphans: OrphanLine[];
  orphanAmount: Record<string, string>;
  setOrphanAmount: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  orphanSettling: string | null;
  orphanError: string | null;
  onSettle: (
    line: OrphanLine,
    kind: "paid_outside" | "written_off",
    amount: number | null
  ) => void;
}) {
  if (orphans.length === 0) return null;

  return (
    <div
      data-testid="orphan-report"
      className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4"
    >
      <p className="text-sm font-semibold text-amber-900">
        Recorded after billing — nobody was billed for these lessons
      </p>
      <p className="mt-1 text-xs text-amber-800">
        These lessons sit inside a month that was already billed and
        sealed, so no invoice can ever include them. They were recorded
        afterwards — usually a backdated enrolment, make-up, or an
        attendance correction. Record what happened to the money; each
        line stays here until you do.
      </p>

      <ul className="mt-3 space-y-3">
        {orphans.map((line) => {
          const key = `${line.student_id}:${line.billing_month}`;
          return (
            <li
              key={key}
              className="rounded-lg border border-amber-200 bg-white px-3 py-2.5"
            >
              <p className="text-sm font-semibold text-gray-800">
                {line.student_name ?? "Unnamed student"}
                <span className="ml-2 font-normal text-gray-500">
                  {formatBillingMonth(line.billing_month)}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-gray-600">
                {line.lessons} billable lesson
                {line.lessons === 1 ? "" : "s"} ·{" "}
                {line.earliest_session_date === line.latest_session_date
                  ? formatSgDate(line.earliest_session_date)
                  : `${formatSgDate(line.earliest_session_date)} – ${formatSgDate(
                      line.latest_session_date
                    )}`}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-xs text-gray-600">
                  S$
                  <input
                    value={orphanAmount[key] ?? ""}
                    onChange={(e) =>
                      setOrphanAmount((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`Amount received for ${line.student_name ?? "student"}`}
                    className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={
                    orphanSettling === key || !(Number(orphanAmount[key]) > 0)
                  }
                  onClick={() =>
                    onSettle(line, "paid_outside", Number(orphanAmount[key]))
                  }
                >
                  Paid outside SwimSync
                </Button>
                <Button
                  variant="outline"
                  disabled={orphanSettling === key}
                  onClick={() => onSettle(line, "written_off", null)}
                >
                  Write off
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {orphanError && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {orphanError}
        </p>
      )}
    </div>
  );
}
