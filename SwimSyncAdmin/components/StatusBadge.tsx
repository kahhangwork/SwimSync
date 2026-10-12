import { Tag } from "@/components/ui/Tag";
import { statusTone, type StatusTone } from "@/lib/statusTone";

/** A status as a WORD in a tag — colour is never the only signal (DESIGN.md).
 *  The word's tone is lib/statusTone.ts's; the classes are components/ui/Tag's.
 *  `tone` overrides the word's own tone where the caller knows more than the
 *  word does (a billing month's state). */
export function StatusBadge({ status, tone }: { status: string; tone?: StatusTone }) {
  return <Tag tone={tone ?? statusTone(status)}>{status}</Tag>;
}
