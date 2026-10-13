// The marking screen's status buttons (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 1) —
// moved verbatim from app/(coach)/classes/[id]/attendance.tsx.
import type { TopStatus } from "./types";
import type { BulkTop } from "@/lib/attendanceBulk";
import type { StatusTone } from "@/lib/statusTone";

export const TOP_STATUSES: {
  key: TopStatus;
  label: string;
}[] = [
  { key: "present",   label: "Present"   },
  { key: "absent",    label: "Absent"    },
  { key: "cancelled", label: "Cancelled" },
  { key: "trial",     label: "Trial"     },
];

// UI restyle step 2.2: the CHOSEN status reads as a tag — its own tone's tint, a
// border in the tone's text colour, the word in that colour — and an unchosen one
// is a plain outlined control. Labels are 13px: four buttons share a 318px card
// row at 390px, and "Cancelled" at 14px semibold does not fit its quarter. Which
// word takes which tone is lib/statusTone.ts's; these are only the classes, written whole so Tailwind keeps them (§7.191) —
// never `bg-status-${tone}-bg`. They live here, not in lib/: the app's Tailwind
// does not scan lib/ and would purge them with no error.
const SEGMENT = "flex-1 min-h-11 rounded-control border items-center justify-center";

export const SEGMENT_BOX: Record<StatusTone | "idle", string> = {
  idle: `${SEGMENT} bg-surface border-border-strong`,
  neutral: `${SEGMENT} bg-status-neutral-bg border-status-neutral-text`,
  info: `${SEGMENT} bg-status-info-bg border-status-info-text`,
  warning: `${SEGMENT} bg-status-warning-bg border-status-warning-text`,
  danger: `${SEGMENT} bg-status-danger-bg border-status-danger-text`,
  success: `${SEGMENT} bg-status-success-bg border-status-success-text`,
};

export const SEGMENT_LABEL: Record<StatusTone | "idle", string> = {
  idle: "text-body-secondary font-medium text-ink-secondary",
  neutral: "text-body-secondary font-semibold text-status-neutral-text",
  info: "text-body-secondary font-semibold text-status-info-text",
  warning: "text-body-secondary font-semibold text-status-warning-text",
  danger: "text-body-secondary font-semibold text-status-danger-text",
  success: "text-body-secondary font-semibold text-status-success-text",
};

/** The Set-all menu's 8px dot beside each word, by the status it writes. */
export const BULK_DOT: Record<BulkTop, string> = {
  present: "h-2 w-2 rounded-full bg-status-success-text",
  absent: "h-2 w-2 rounded-full bg-status-neutral-text",
  cancelled: "h-2 w-2 rounded-full bg-status-neutral-text",
};
