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
      className="h-9 rounded-control border border-border-strong bg-surface px-3 text-body text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary"
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {formatMonth(m)}
        </option>
      ))}
    </select>
  );
}
