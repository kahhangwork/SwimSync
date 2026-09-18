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
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">
            Assessing since
          </span>
          <input
            type="date"
            value={p.since}
            onChange={(e) => p.setSince(e.target.value || todayInSg())}
            className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="min-w-[16rem] flex-1">
          <p className="text-sm text-gray-700">
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
                <span className="font-semibold text-gray-600">
                  {p.progress.blockedStudents}{" "}
                  {p.progress.blockedStudents === 1 ? "child needs" : "children need"}{" "}
                  a level
                </span>
              </>
            ) : null}
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-sky-500 transition-all"
              style={{ width: `${p.pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
