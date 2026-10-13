import type { ClassRow } from "../domain/substituteRows";

const inputClass =
  "rounded-control border border-border-strong bg-surface px-3 py-2.5 text-body focus:outline-none focus:ring-2 focus:ring-primary";

type Props = {
  classes: ClassRow[];
  classId: string;
  month: string;
  onClass: (id: string) => void;
  onMonth: (m: string) => void;
};

export function SubstitutesFilters({ classes, classId, month, onClass, onMonth }: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-label font-medium text-ink-muted">
        Class
        <select value={classId} onChange={(e) => onClass(e.target.value)} className={inputClass}>
          <option value="">Choose a class…</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.is_active ? c.title : `${c.title} (retired)`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-label font-medium text-ink-muted">
        Month
        <input type="month" value={month} onChange={(e) => onMonth(e.target.value)} className={inputClass} />
      </label>
    </div>
  );
}
