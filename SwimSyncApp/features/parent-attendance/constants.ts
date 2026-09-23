// The parent Attendance tab's module-level constants (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H) — moved verbatim from app/(parent)/attendance/index.tsx.
import type { DbStatus, FilterOption } from "./types";

export const FILTER_OPTIONS: FilterOption[] = ["All", "Present", "Absent", "Cancelled", "Trial"];

export const STATUS_LABEL: Record<DbStatus, string> = {
  present:          "Present",
  absent:           "Absent",
  cancelled_rain:   "Cancelled (Rain)",
  cancelled_coach:  "Cancelled (Coach)",
  trial_paid:       "Trial — Paid",
  trial_free:       "Trial — Free",
  holiday:          "Public Holiday",
};

export const STATUS_ICON: Record<DbStatus, { name: string; color: string }> = {
  present:         { name: "checkmark-circle", color: "#16a34a" },
  absent:          { name: "close-circle",     color: "#9ca3af" },
  cancelled_rain:  { name: "rainy",            color: "#ea580c" },
  cancelled_coach: { name: "ban",              color: "#ea580c" },
  trial_paid:      { name: "star",             color: "#2563eb" },
  trial_free:      { name: "star-outline",     color: "#2563eb" },
  holiday:         { name: "calendar",         color: "#9333ea" },
};
