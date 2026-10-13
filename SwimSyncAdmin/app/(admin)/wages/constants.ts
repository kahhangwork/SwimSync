import type { Tone } from "@/components/ui/Tag";
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

// Each label is a decision worth explaining, not a problem — a Tag in a status
// tone, never a free colour (DESIGN.md; UI restyle 5.4). Covers and corrections
// are Info, a lesson handed away is Neutral.
export const LINE_TONES: Record<LessonLine["kind"], Tone> = {
  ordinary: "neutral",
  assigned: "info",
  shadow: "info",
  reassigned: "neutral",
  corrected: "info",
};
