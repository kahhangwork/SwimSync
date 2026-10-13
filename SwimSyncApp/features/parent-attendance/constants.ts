// The parent Attendance tab's module-level constants (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H) — moved verbatim from app/(parent)/attendance/index.tsx. Icon colours
// are DESIGN.md's status-text hexes since UI restyle step 3.7 (the word beside the
// icon carries the meaning; the colour only repeats it).
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
  present:         { name: "checkmark-circle", color: "#166534" }, // success
  absent:          { name: "close-circle",     color: "#6b6b6b" }, // neutral
  cancelled_rain:  { name: "rainy",            color: "#6b6b6b" }, // neutral
  cancelled_coach: { name: "ban",              color: "#6b6b6b" }, // neutral
  trial_paid:      { name: "star",             color: "#1e40af" }, // info
  trial_free:      { name: "star-outline",     color: "#1e40af" }, // info
  holiday:         { name: "calendar",         color: "#6b6b6b" }, // neutral
};
