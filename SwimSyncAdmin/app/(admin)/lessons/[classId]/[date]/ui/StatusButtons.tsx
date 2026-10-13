// The per-row status control — moved verbatim from page.tsx at Stage 7 of
// docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md. Holds NO state (§7.249: the page
// unmounts everything below its loading switch on every reload).

import { cn } from "@/lib/utils";
import { Tag } from "@/components/ui/Tag";
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
// The CHOSEN status reads as a tag, as on the coach app (UI restyle 2.2 / 5.27):
// its tone's tint, a border in the tone's text colour, the word in that colour.
// Tones follow lib/statusTone.ts (Present success, Trial info, the rest neutral);
// whole literals so Tailwind keeps them (§7.191).
const TOP_ACTIVE: Record<Top, string> = {
  present: "bg-status-success-bg text-status-success-text border-status-success-text font-semibold",
  absent: "bg-status-neutral-bg text-status-neutral-text border-status-neutral-text font-semibold",
  cancelled: "bg-status-neutral-bg text-status-neutral-text border-status-neutral-text font-semibold",
  trial: "bg-status-info-bg text-status-info-text border-status-info-text font-semibold",
  holiday: "bg-status-neutral-bg text-status-neutral-text border-status-neutral-text font-semibold",
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
            "rounded-control border px-2.5 py-1 text-label font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            top === t ? TOP_ACTIVE[t] : "border-border-strong bg-surface text-ink-secondary hover:bg-ground"
          )}
        >
          {TOP_LABEL[t]}
        </button>
      ))}
      {top === "cancelled" && (
        <span className="ml-1 inline-flex overflow-hidden rounded-control border border-border-strong text-label" role="group" aria-label={`Cancellation reason for ${name}`}>
          {(["cancelled_rain", "cancelled_coach"] as const).map((s) => (
            <button key={s} type="button" data-status={s} aria-pressed={value === s} disabled={disabled} onClick={() => onChange(s)}
              className={cn("px-2 py-1", value === s ? "bg-selected font-semibold text-ink" : "bg-surface text-ink-secondary hover:bg-ground")}>
              {s === "cancelled_rain" ? "Rain" : "Coach"}
            </button>
          ))}
        </span>
      )}
      {top === "trial" && (
        <span className="ml-1 inline-flex overflow-hidden rounded-control border border-border-strong text-label" role="group" aria-label={`Trial type for ${name}`}>
          {(["trial_paid", "trial_free"] as const).map((s) => (
            <button key={s} type="button" data-status={s} aria-pressed={value === s} disabled={disabled} onClick={() => onChange(s)}
              className={cn("px-2 py-1", value === s ? "bg-selected font-semibold text-ink" : "bg-surface text-ink-secondary hover:bg-ground")}>
              {s === "trial_paid" ? "Paid" : "Free"}
            </button>
          ))}
        </span>
      )}
      {top === null && <Tag tone="warning" className="ml-1">Not marked</Tag>}
    </div>
  );
}
