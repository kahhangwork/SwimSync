import type { LessonLine } from "./domain/payoutItems";

export const LINE_LABELS: Record<LessonLine["kind"], string | null> = {
  ordinary: null,
  assigned: "Assigned to cover",
  shadow: "Shadowing",
  reassigned: "Reassigned to another coach",
  // The cover was cleared after the clawback was emitted, so the roster no
  // longer says who or why — but an unlabelled negative line is worse.
  corrected: "Correction to a settled month",
};

export const LINE_STYLES: Record<LessonLine["kind"], string> = {
  ordinary: "",
  assigned: "bg-amber-100 text-amber-800",
  shadow: "bg-sky-100 text-sky-800",
  reassigned: "bg-gray-200 text-gray-700",
  corrected: "bg-violet-100 text-violet-700",
};
