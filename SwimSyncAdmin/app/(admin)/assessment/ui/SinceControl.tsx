import { todayInSg } from "@/lib/lessonDates";

// "Assessing since" — the round start. Chosen here and carried into each class
// link (see the page header for why it lives on the index).
export function SinceControl(p: { since: string; setSince: (v: string) => void }) {
  return (
    <div className="mb-6 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-label font-semibold text-ink-secondary">
            Assessing since
          </span>
          <input
            type="date"
            value={p.since}
            onChange={(e) => p.setSince(e.target.value || todayInSg())}
            className="mt-1 block rounded-control border border-border-strong px-3 py-2 text-body"
          />
        </label>
        <p className="max-w-md text-label text-ink-muted">
          Grades recorded on or after this date count as{" "}
          <span className="font-semibold">this round</span>. Anything older is
          shown greyed with its date, so a child assessed months ago is never
          mistaken for one you have already seen today.
        </p>
      </div>
    </div>
  );
}
