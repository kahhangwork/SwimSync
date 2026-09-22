// TopStatus/sub <-> DBStatus, and the header's date (COACH_ATTENDANCE_REFACTOR_PLAN.md,
// Stage 1) — moved verbatim from app/(coach)/classes/[id]/attendance.tsx.
import { formatSgStamp } from "@/lib/lessonDates";
import type { DBStatus, TopStatus } from "../types";

export function toDBStatus(top: TopStatus, sub: string | null): DBStatus | null {
  if (top === "unmarked") return null;
  if (top === "present") return "present";
  if (top === "absent") return "absent";
  if (top === "cancelled" && sub === "rain") return "cancelled_rain";
  if (top === "cancelled" && sub === "coach") return "cancelled_coach";
  if (top === "trial" && sub === "paid") return "trial_paid";
  if (top === "trial" && sub === "free") return "trial_free";
  return null;
}

export function fromDBStatus(status: DBStatus): { top: TopStatus; sub: string | null } {
  switch (status) {
    case "present":         return { top: "present",   sub: null };
    case "absent":          return { top: "absent",    sub: null };
    case "cancelled_rain":  return { top: "cancelled", sub: "rain" };
    case "cancelled_coach": return { top: "cancelled", sub: "coach" };
    case "trial_paid":      return { top: "trial",     sub: "paid" };
    case "trial_free":      return { top: "trial",     sub: "free" };
    case "holiday":         return { top: "holiday",   sub: null };
  }
}

export function formatDate(dateStr: string): string {
  return formatSgStamp(dateStr, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
