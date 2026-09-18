// The per-row status control — moved verbatim from page.tsx at Stage 7 of
// docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md. Holds NO state (§7.249: the page
// unmounts everything below its loading switch on every reload).

import { cn } from "@/lib/utils";
import { optionsForKind, type DbStatus, type RosterKind } from "../domain/lessonMarking";

// ── Status buttons — the coach app's shape (top status + a reason), not a dropdown ──
type Top = "present" | "absent" | "cancelled" | "trial" | "holiday";
function topOf(s: DbStatus | null): Top | null {
  if (!s) return null;
  if (s === "cancelled_rain" || s === "cancelled_coach") return "cancelled";
  if (s === "trial_paid" || s === "trial_free") return "trial";
  return s;
}
const TOP_LABEL: Record<Top, string> = { present: "Present", absent: "Absent", cancelled: "Cancelled", trial: "Trial", holiday: "Holiday" };
const TOP_ACTIVE: Record<Top, string> = {
  present: "bg-emerald-600 text-white border-emerald-600",
  absent: "bg-red-600 text-white border-red-600",
  cancelled: "bg-sky-600 text-white border-sky-600",
  trial: "bg-violet-600 text-white border-violet-600",
  holiday: "bg-gray-700 text-white border-gray-700",
};

export function StatusButtons({
  name,
  kind,
  value,
  disabled,
  onChange,
}: {
  name: string;
  kind: RosterKind;
  value: DbStatus | null;
  disabled: boolean;
  onChange: (next: DbStatus) => void;
}) {
  const allowed = optionsForKind(kind);
  const tops: Top[] = (["present", "absent", "cancelled", "trial", "holiday"] as Top[]).filter((t) =>
    t === "cancelled" ? allowed.includes("cancelled_rain") : t === "trial" ? allowed.includes("trial_paid") : allowed.includes(t as DbStatus)
  );
  const top = topOf(value);
  const pick = (t: Top) => {
    if (t === "cancelled") onChange(value === "cancelled_coach" ? "cancelled_coach" : "cancelled_rain");
    else if (t === "trial") onChange(value === "trial_free" ? "trial_free" : "trial_paid");
    else onChange(t);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Status for ${name}`}>
      {tops.map((t) => (
        <button
          key={t}
          type="button"
          data-status={t}
          aria-pressed={top === t}
          disabled={disabled}
          onClick={() => pick(t)}
          className={cn(
            "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
            top === t ? TOP_ACTIVE[t] : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          )}
        >
          {TOP_LABEL[t]}
        </button>
      ))}
      {top === "cancelled" && (
        <span className="ml-1 inline-flex overflow-hidden rounded-lg border border-sky-300 text-xs" role="group" aria-label={`Cancellation reason for ${name}`}>
          {(["cancelled_rain", "cancelled_coach"] as const).map((s) => (
            <button key={s} type="button" data-status={s} aria-pressed={value === s} disabled={disabled} onClick={() => onChange(s)}
              className={cn("px-2 py-1", value === s ? "bg-sky-100 font-semibold text-sky-900" : "bg-white text-gray-600 hover:bg-gray-50")}>
              {s === "cancelled_rain" ? "Rain" : "Coach"}
            </button>
          ))}
        </span>
      )}
      {top === "trial" && (
        <span className="ml-1 inline-flex overflow-hidden rounded-lg border border-violet-300 text-xs" role="group" aria-label={`Trial type for ${name}`}>
          {(["trial_paid", "trial_free"] as const).map((s) => (
            <button key={s} type="button" data-status={s} aria-pressed={value === s} disabled={disabled} onClick={() => onChange(s)}
              className={cn("px-2 py-1", value === s ? "bg-violet-100 font-semibold text-violet-900" : "bg-white text-gray-600 hover:bg-gray-50")}>
              {s === "trial_paid" ? "Paid" : "Free"}
            </button>
          ))}
        </span>
      )}
      {top === null && <span className="text-xs text-gray-400">Not marked</span>}
    </div>
  );
}
