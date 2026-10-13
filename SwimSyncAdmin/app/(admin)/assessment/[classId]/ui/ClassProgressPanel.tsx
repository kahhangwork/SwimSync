import type { RoundProgress } from "@/lib/assessment";
import { todayInSg } from "@/lib/lessonDates";

// "Assessing since" + this round's progress for the class. Editing the date
// regroups what is already loaded; it does not refetch (see domain/useAssessClass).
export function ClassProgressPanel(p: {
  since: string;
  setSince: (v: string) => void;
  progress: RoundProgress;
  pct: number;
}) {
  return (
    <div className="mb-6 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
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

        <div className="min-w-[16rem] flex-1">
          <p className="text-body text-ink-secondary">
            <span className="font-semibold">
              {p.progress.gradedSkills} of {p.progress.totalSkills}
            </span>{" "}
            skills graded this round ·{" "}
            <span className="font-semibold">
              {p.progress.assessedStudents} of {p.progress.totalStudents}
            </span>{" "}
            children done
            {/* Counted apart, never folded into either bucket: a child with
                no level is work for whoever sets levels, not for the
                assessor, and hiding them in "outstanding" or "done" is how
                they get skipped. */}
            {p.progress.blockedStudents > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-ink-secondary">
                  {p.progress.blockedStudents}{" "}
                  {p.progress.blockedStudents === 1 ? "child needs" : "children need"}{" "}
                  a level
                </span>
              </>
            ) : null}
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-status-neutral-bg">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${p.pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
