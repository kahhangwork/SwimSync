import { Drawer } from "@/components/Drawer";
import { PackageChip } from "@/components/PackageChip";
import { assignableClassShadows } from "@/lib/sessionRoster";
import { todayInSg, toSgDate, formatSgDate } from "@/lib/lessonDates";
import { formatTime } from "@/lib/utils";
import type { StudentCoverage } from "@/lib/packageCoverage";
import { capitalize, shadowRateWarning } from "../domain/classRows";
import type { buildClassRoster } from "../domain/classRoster";
import type { ClassRow, Coach, ShadowAssignment } from "../types";

type OpenRoster = ReturnType<typeof buildClassRoster>;

/**
 * Who is in this class — read-only, two groups, never merged.
 * DELIBERATELY NO WRITE CONTROLS. Not an oversight: the one action an admin
 * might reach for here is putting a trial child onto the class roster, and that
 * is precisely the action that breaks billing (PRD §7.17). No button here may
 * add, drop, or move a child, and this drawer takes no class-list refresh prop —
 * the shadow Add/End are payroll facts, not roster edits, and are the only
 * writes it performs.
 */
export function RosterDrawer({
  drawerClass,
  onClose,
  rosterError,
  shadows,
  shadowError,
  shadowBusy,
  shadowPick,
  onShadowPick,
  shadowFrom,
  onShadowFrom,
  onAssignShadow,
  onEndShadow,
  coaches,
  openRoster,
  covMap,
}: {
  drawerClass: ClassRow | null;
  onClose: () => void;
  rosterError: string | null;
  shadows: ShadowAssignment[];
  shadowError: string | null;
  shadowBusy: boolean;
  shadowPick: string;
  onShadowPick: (v: string) => void;
  shadowFrom: string;
  onShadowFrom: (v: string) => void;
  onAssignShadow: () => void;
  onEndShadow: (coachId: string) => void;
  coaches: Coach[];
  openRoster: OpenRoster;
  covMap: Map<string, StudentCoverage>;
}) {
  return (
    <Drawer
      open={drawerClass !== null}
      onClose={onClose}
      title={drawerClass?.title ?? ""}
      subtitle={
        drawerClass
          ? `${capitalize(drawerClass.day_of_week)} · ${formatTime(
              drawerClass.start_time
            )} – ${formatTime(drawerClass.end_time)} · ${
              drawerClass.location_name
            }`
          : undefined
      }
    >
      {rosterError ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          Couldn&apos;t load the roster: {rosterError}
        </p>
      ) : (
        <div className="space-y-8">
          <section>
            <h3 className="text-sm font-semibold text-gray-900">
              Shadow coaches
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              A shadow watches every lesson of this class and is paid their own
              shadow rate for each one. It lasts until you end it — this is not
              a per-lesson arrangement. To record a one-off cover instead, use{" "}
              <span className="font-medium">Substitutes</span>.
            </p>

            {shadowError && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {shadowError}
              </p>
            )}

            {shadows.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {shadows.map((sh) => (
                  <li
                    key={sh.id}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="font-medium text-gray-900">
                      {sh.coach_name}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatSgDate(sh.effective_from)} –{" "}
                      {sh.effective_to
                        ? formatSgDate(sh.effective_to)
                        : "ongoing"}
                    </span>
                    {sh.effective_to === null ? (
                      <button
                        type="button"
                        disabled={shadowBusy}
                        onClick={() => onEndShadow(sh.coach_id)}
                        className="text-xs font-medium text-gray-500 underline disabled:opacity-50"
                      >
                        End
                      </button>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        ended
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={shadowPick}
                onChange={(e) => onShadowPick(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
              >
                <option value="">Add a shadow…</option>
                {assignableClassShadows(
                  drawerClass?.coach_id ?? "",
                  shadows
                    .filter((sh) => sh.effective_to === null)
                    .map((sh) => sh.coach_id),
                  coaches.map((c) => ({ id: c.id, name: c.full_name }))
                ).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={shadowFrom}
                onChange={(e) => onShadowFrom(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                aria-label="Shadowing from"
              />
              <button
                type="button"
                disabled={shadowBusy || !shadowPick}
                onClick={onAssignShadow}
                className="rounded-lg bg-sky-500 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
              >
                Add
              </button>
              <span className="text-xs text-gray-400">
                from today if left blank
              </span>
            </div>

            {/* Met HERE rather than at payroll, deliberately. A shadow with no
                shadow rate makes generate_coach_payouts refuse for the WHOLE
                business, months later, with the run blocked until somebody
                works out why. Here it costs one sentence. The predicate is
                domain/classRows.shadowRateWarning (⚠ A DATE, NOT A BOOLEAN). */}
            {(() => {
              if (!shadowPick) return null;
              const from =
                coaches.find((c) => c.id === shadowPick)?.shadowRateFrom ?? null;
              // Compared against the date the ASSIGNMENT starts, because that is
              // the earliest lesson payroll will price for them. Clock read in
              // the ui, never the dao (§7.7).
              const startsOn = shadowFrom || todayInSg();
              const warn = shadowRateWarning(from, startsOn);
              if (warn === null) return null;
              return (
                <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {warn === "late"
                    ? `This coach's shadow rate only starts on ${formatSgDate(from!)}, after this assignment does.`
                    : "This coach has no shadow rate yet."}{" "}
                  Set one on <span className="font-medium">Wages</span> before
                  payroll — without a rate in force the whole business&apos;s
                  payroll run will refuse rather than pay the wrong rate.
                </p>
              );
            })()}
          </section>

          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Enrolled ({openRoster.enrolled.length})
            </h3>
            {openRoster.enrolled.length === 0 ? (
              <p className="text-sm text-gray-400">
                Nobody is enrolled in this class yet.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {openRoster.enrolled.map((s) => (
                  <li key={s.student_id} className="py-2.5">
                    <p className="text-sm font-medium text-gray-900">
                      {s.full_name}
                      <span className="ml-1.5">
                        <PackageChip coverage={covMap.get(s.student_id)} />
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {s.level_label ?? "No level set"} · Joined{" "}
                      {formatSgDate(toSgDate(s.enrolled_at), {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {openRoster.trials.length > 0 && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Trials coming up ({openRoster.trials.length})
              </h3>
              <ul className="divide-y divide-gray-100">
                {openRoster.trials.map((t) => (
                  <li key={t.student_id} className="py-2.5">
                    <p className="text-sm font-medium text-gray-900">
                      {t.full_name}
                      <span className="ml-1.5">
                        <PackageChip coverage={covMap.get(t.student_id)} />
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {t.level_label ?? "No level set"} · Trial on{" "}
                      {formatSgDate(t.session_date)}
                    </p>
                  </li>
                ))}
              </ul>
              {/* The consequence, in words. A reader who takes the "+1" for
                  class membership is one click from breaking a billing
                  month, so the screen says what would happen. */}
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                A guest for this one lesson — not part of the class. Adding
                them to it would make them expected every week, and a lesson
                nobody marks blocks the whole month from being invoiced.
              </p>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
