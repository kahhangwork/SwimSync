import { formatMonth } from "../domain/accounting";

// The PageHeader action: the closed-month picker. The page renders it only when
// there are months (PageHeader wraps any non-null action in a <div>).
export function MonthPicker({
  months,
  selected,
  onSelect,
}: {
  months: string[];
  selected: string | null;
  onSelect: (m: string) => void;
}) {
  return (
    <select
      value={selected ?? ""}
      onChange={(e) => onSelect(e.target.value)}
      data-testid="month-picker"
      className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {formatMonth(m)}
        </option>
      ))}
    </select>
  );
}
