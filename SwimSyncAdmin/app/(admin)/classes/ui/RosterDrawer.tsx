import { Tag } from "@/components/ui/Tag";
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
 * the shadow Add/End are payroll facts, not roster edits.
 *
 * ONE roster write, deliberately (Wave 4, 20261005000100): *Change* beside
 * "Joined" moves WHEN an enrolled child started — it adds, drops and moves
 * nobody. It exists because the 04 Oct 2026 case (a child who swam before
 * being assigned) was found after the add, and the only fix was SQL on
 * production. set_enrolment_start owns its rules and audits it.
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
  onChangeStart,
}: {
  drawerClass: ClassRow | null;
  onClose: () => void;
  /** Open "Change start date" for an enrolled child of the open class. */
  onChangeStart: (s: { student_id: string; full_name: string; enrolled_at: string }) => void;
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
        <p className="rounded-card bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">
          Couldn&apos;t load the roster: {rosterError}
        </p>
      ) : (
        <div className="space-y-8">
          <section>
            <h3 className="text-headline font-semibold text-ink">
              Shadow coaches
            </h3>
            <p className="mt-0.5 text-label text-ink-muted">
              A shadow watches every lesson of this class and is paid their own
              shadow rate for each one. It lasts until you end it — this is not
              a per-lesson arrangement. To record a one-off cover instead, use{" "}
              <span className="font-medium">Substitutes</span>.
            </p>

            {/* role="alert" / role="status" are how verify-class-admin finds
                these two lines — never their colour classes (UI restyle 5.10,
                §7.375). */}
            {shadowError && (
              <p role="alert" className="mt-2 rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">
                {shadowError}
              </p>
            )}

            {shadows.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {shadows.map((sh) => (
                  <li
                    key={sh.id}
                    className="flex flex-wrap items-center gap-2 text-body"
                  >
                    <span className="font-medium text-ink">
                      {sh.coach_name}
                    </span>
                    <span className="text-label text-ink-muted">
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
                        className="text-label font-medium text-ink-muted underline disabled:opacity-50"
                      >
                        End
                      </button>
                    ) : (
                      <Tag tone="neutral">ended</Tag>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={shadowPick}
                onChange={(e) => onShadowPick(e.target.value)}
                className="rounded-control border border-border-strong px-2 py-1 text-body"
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
                className="rounded-control border border-border-strong px-2 py-1 text-body"
                aria-label="Shadowing from"
              />
              <button
                type="button"
                disabled={shadowBusy || !shadowPick}
                onClick={onAssignShadow}
                className="rounded-control bg-primary px-3 py-1 text-body font-medium text-white disabled:opacity-50"
              >
                Add
              </button>
              <span className="text-label text-ink-muted">
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
                <p role="status" className="mt-2 rounded-card border border-status-warning-border bg-status-warning-bg px-3 py-2 text-label text-status-warning-text">
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
            <h3 className="mb-3 text-label font-semibold uppercase tracking-wide text-ink-muted">
              Enrolled ({openRoster.enrolled.length})
            </h3>
            {openRoster.enrolled.length === 0 ? (
              <p className="text-body text-ink-muted">
                Nobody is enrolled in this class yet.
              </p>
            ) : (
              <ul className="divide-y divide-divider">
                {openRoster.enrolled.map((s) => (
                  <li key={s.student_id} className="py-2.5">
                    <p className="text-body font-medium text-ink">
                      {s.full_name}
                      <span className="ml-1.5">
                        <PackageChip coverage={covMap.get(s.student_id)} />
                      </span>
                    </p>
                    <p className="mt-0.5 text-label text-ink-muted">
                      {s.level_label ?? "No level set"} · Joined{" "}
                      {formatSgDate(toSgDate(s.enrolled_at), {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {" · "}
                      <button
                        type="button"
                        onClick={() => onChangeStart(s)}
                        aria-label={`Change start date for ${s.full_name}`}
                        className="font-medium text-primary hover:underline"
                      >
                        Change
                      </button>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {openRoster.trials.length > 0 && (
            <section>
              <h3 className="mb-3 text-label font-semibold uppercase tracking-wide text-ink-muted">
                Trials coming up ({openRoster.trials.length})
              </h3>
              <ul className="divide-y divide-divider">
                {openRoster.trials.map((t) => (
                  <li key={t.student_id} className="py-2.5">
                    <p className="text-body font-medium text-ink">
                      {t.full_name}
                      <span className="ml-1.5">
                        <PackageChip coverage={covMap.get(t.student_id)} />
                      </span>
                    </p>
                    <p className="mt-0.5 text-label text-ink-muted">
                      {t.level_label ?? "No level set"} · Trial on{" "}
                      {formatSgDate(t.session_date)}
                    </p>
                  </li>
                ))}
              </ul>
              {/* The consequence, in words. A reader who takes the "+1" for
                  class membership is one click from breaking a billing
                  month, so the screen says what would happen. */}
              <p className="mt-3 rounded-card border border-status-warning-border bg-status-warning-bg px-3 py-2 text-label text-status-warning-text">
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
