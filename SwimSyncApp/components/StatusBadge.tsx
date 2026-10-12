import React from "react";
import { Tag } from "@/components/ui/Tag";
import { statusTone } from "@/lib/statusTone";

// The word's tone is lib/statusTone.ts's; the classes are components/ui/Tag's
// (this app's Tailwind does not scan lib/ — §7.191).

// A display override for a word whose stored status is not a reader's word.
const LABEL: Record<string, string> = { "Not Marked": "–" };

interface Props {
  status: string;
  /** Kept for existing callers; the tag is one size (12px, the text floor). */
  size?: "sm" | "md";
}

/** A status as a WORD in a tag — colour is never the only signal (DESIGN.md). */
export default function StatusBadge({ status }: Props) {
  return <Tag label={LABEL[status] ?? status} tone={statusTone(status)} />;
}
