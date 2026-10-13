import { formatSgDate } from "@/lib/lessonDates";
import type { TrialsState } from "../domain/useTrials";

// Past and unmarked: the half that matters. A forgotten trial HOLDS THE
// BILLING MONTH OPEN (see the page header).
export function PastUnmarkedPanel(p: { t: TrialsState }) {
  return (
    <>
      {p.t.past.length > 0 && (
        <div className="mb-6 rounded-card border border-status-danger-border bg-status-danger-bg p-4">
          <p className="text-body font-semibold text-status-danger-text">
            {p.t.past.length} trial{p.t.past.length === 1 ? "" : "s"} still need marking
          </p>
          <p className="mt-0.5 mb-3 text-label text-status-danger-text">
            These lessons have passed and the coach hasn&apos;t recorded them.
            The billing month stays open until they do — mark them in the coach
            app, or cancel the booking if the trial never happened.
          </p>
          <ul className="space-y-1">
            {p.t.past.map((b) => (
              <li key={b.id} className="flex items-center gap-3 text-label text-ink">
                <span className="font-semibold">{b.student_name}</span>
                <span className="text-ink-muted">
                  {b.class_title} · {formatSgDate(b.session_date)}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => p.t.openConvert(b)}
                    className="rounded-control border border-border-strong bg-surface px-2 py-0.5 font-semibold text-ink hover:bg-ground"
                  >
                    Convert to enrolled
                  </button>
                  <button
                    onClick={() => p.t.handleCancel(b.id)}
                    className="rounded-control border border-border-strong px-2 py-0.5 font-semibold text-ink-secondary hover:bg-surface"
                  >
                    Cancel
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
