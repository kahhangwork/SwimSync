// Parent Requests — the already-decided list, including the way back (Undo).

import { Button } from "@/components/Button";
import { formatSgDate } from "@/lib/lessonDates";
import type { Claim } from "../types";

type Props = {
  decided: Claim[];
  showDecided: boolean;
  setShowDecided: (fn: (s: boolean) => boolean) => void;
  busy: string | null;
  onUndo: (c: Claim) => void;
};

export function DecidedClaims(p: Props) {
  if (p.decided.length === 0) return null;
  return (
    <div className="mt-8">
      <button
        onClick={() => p.setShowDecided((s) => !s)}
        className="text-sm font-medium text-sky-600 hover:text-sky-700"
      >
        {p.showDecided ? "Hide" : "Show"} decided requests ({p.decided.length})
      </button>

      {p.showDecided && (
        <div className="mt-3 space-y-2">
          {p.decided.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              <div>
                <p className="text-sm text-gray-900">
                  <span className="font-medium">{c.student_name}</span>{" "}
                  {c.status === "approved" ? "linked to" : "not linked to"}{" "}
                  <span className="font-medium">{c.parent_name}</span>
                </p>
                <p className="text-xs text-gray-400">
                  {c.status}
                  {c.decided_at
                    ? ` · ${formatSgDate(c.decided_at.slice(0, 10), {
                        day: "numeric",
                        month: "short",
                      })}`
                    : ""}
                </p>
              </div>

              {/* ⚠ THE WAY BACK. A tenant admin cannot unlink a parent from
                  a child by any other route — parent_students_delete covers
                  the parent and the platform admin only — so without this
                  button a mis-approval is permanent short of SQL. It
                  refuses once an invoice covers that child. */}
              {c.status === "approved" && (
                <Button
                  variant="outline"
                  onClick={() => p.onUndo(c)}
                  disabled={p.busy === c.id}
                >
                  Undo this link
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
