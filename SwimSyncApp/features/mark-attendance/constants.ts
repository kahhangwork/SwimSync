// The marking screen's status buttons (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 1) —
// moved verbatim from app/(coach)/classes/[id]/attendance.tsx.
import type { TopStatus } from "./types";

export const TOP_STATUSES: {
  key: TopStatus;
  label: string;
  ring: string;
  bg: string;
}[] = [
  { key: "present",   label: "Present",   ring: "border-green-500",  bg: "bg-green-500"  },
  { key: "absent",    label: "Absent",    ring: "border-gray-400",   bg: "bg-gray-400"   },
  { key: "cancelled", label: "Cancelled", ring: "border-orange-500", bg: "bg-orange-500" },
  { key: "trial",     label: "Trial",     ring: "border-blue-500",   bg: "bg-blue-500"   },
];
