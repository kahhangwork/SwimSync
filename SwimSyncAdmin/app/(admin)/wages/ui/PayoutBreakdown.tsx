import { formatSgDate } from "@/lib/lessonDates";
import { Tag } from "@/components/ui/Tag";
import { LINE_LABELS, LINE_TONES } from "../constants";
import { lineDetail, money } from "../domain/wageRows";
import type { PayoutRow } from "../types";

// One payout's per-lesson breakdown (the expanded row). A cover is shown as a
// decision — a labelled line — never as a silently different number.
export function PayoutBreakdown({ p }: { p: PayoutRow }) {
  return p.lines.length === 0 ? (
    <p className="py-2 text-body text-ink-muted">
      This payout has no lesson lines.
    </p>
  ) : (
    <div className="py-1">
      <table className="w-full text-body">
        <tbody>
          {p.lines.map((line) => (
            <tr
              key={line.lesson_session_id}
              className="border-b border-border last:border-0"
            >
              <td className="py-1.5 pr-4 text-ink-muted whitespace-nowrap">
                {formatSgDate(line.session_date)}
              </td>
              <td className="py-1.5 pr-4 text-ink">
                {line.class_title}
                {LINE_LABELS[line.kind] && (
                  <Tag tone={LINE_TONES[line.kind]} className="ml-1.5">
                    {LINE_LABELS[line.kind]}
                  </Tag>
                )}
              </td>
              <td className="py-1.5 pr-4 text-label text-ink-muted whitespace-nowrap">
                {lineDetail(line)}
              </td>
              <td
                // A clawback is a reduction, not a fault: Ink with money()'s
                // true minus (DESIGN.md's Aligned Money Rule).
                className="py-1.5 text-right font-medium tabular-nums whitespace-nowrap text-ink"
              >
                {money(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
