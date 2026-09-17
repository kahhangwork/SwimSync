import { formatSgDate } from "@/lib/lessonDates";
import { LINE_LABELS, LINE_STYLES } from "../constants";
import { lineDetail, money } from "../domain/wageRows";
import type { PayoutRow } from "../types";

// One payout's per-lesson breakdown (the expanded row). A cover is shown as a
// decision — a labelled line — never as a silently different number.
export function PayoutBreakdown({ p }: { p: PayoutRow }) {
  return p.lines.length === 0 ? (
    <p className="py-2 text-sm text-gray-500">
      This payout has no lesson lines.
    </p>
  ) : (
    <div className="py-1">
      <table className="w-full text-sm">
        <tbody>
          {p.lines.map((line) => (
            <tr
              key={line.lesson_session_id}
              className="border-b border-gray-200 last:border-0"
            >
              <td className="py-1.5 pr-4 text-gray-500 whitespace-nowrap">
                {formatSgDate(line.session_date)}
              </td>
              <td className="py-1.5 pr-4 text-gray-900">
                {line.class_title}
                {LINE_LABELS[line.kind] && (
                  <span
                    className={`ml-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${LINE_STYLES[line.kind]}`}
                  >
                    {LINE_LABELS[line.kind]}
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-4 text-xs text-gray-500 whitespace-nowrap">
                {lineDetail(line)}
              </td>
              <td
                className={`py-1.5 text-right font-medium whitespace-nowrap ${
                  line.amount < 0
                    ? "text-red-700"
                    : "text-gray-900"
                }`}
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
