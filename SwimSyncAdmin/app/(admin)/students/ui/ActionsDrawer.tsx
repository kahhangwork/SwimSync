// Slice 9 — the per-row Actions drawer (Decision 10). Stage 10 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.
//
// Each button opens the SAME modal the column opened before — no logic moved,
// only the trigger. The drawer closes FIRST so the modal is never launched
// behind it (RISK 8 / §7.10, §7.58); `act` below is that order, once.

import { Drawer } from "@/components/Drawer";
import type { ActionsDrawerState } from "../domain/useActionsDrawer";
import { isUnclaimed, statusLabel } from "../domain/studentRows";
import type { EnrolledClass, StudentRow } from "../types";
import { capitalizeDay } from "./dayLabel";

export type ActionsDrawerProps = {
  drawer: ActionsDrawerState;
  onInvite: (s: StudentRow) => void;
  onContact: (s: StudentRow) => void;
  onRename: (s: StudentRow) => void;
  onGrade: (s: StudentRow) => void;
  onInactive: (s: StudentRow) => void;
  onRemove: (s: StudentRow, cls: EnrolledClass) => void;
  onAddClass: (s: StudentRow) => void;
};

export function ActionsDrawer(p: ActionsDrawerProps) {
  const { drawerFor, drawerReferral } = p.drawer;
  const act = (fn: (s: StudentRow) => void) => () => {
    const s = drawerFor!;
    p.drawer.close();
    fn(s);
  };
  return (
    <Drawer
      open={drawerFor !== null}
      onClose={p.drawer.close}
      title={drawerFor?.full_name ?? "Actions"}
      subtitle={drawerFor ? statusLabel(drawerFor) : undefined}
    >
      {drawerFor && (
        <div className="space-y-6 px-6 py-5">
          <div>
            <h3 className="mb-2 text-label font-semibold uppercase tracking-wide text-ink-muted">
              Parent
            </h3>
            <div className="space-y-2">
              {drawerFor.is_active && isUnclaimed(drawerFor) && (
                <button
                  onClick={act(p.onInvite)}
                  className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-left text-body font-semibold text-ink hover:bg-ground disabled:bg-status-neutral-bg disabled:text-ink-muted"
                >
                  Invite parent
                </button>
              )}
              <button
                onClick={act(p.onContact)}
                className="w-full rounded-control border border-border px-3 py-2 text-left text-body font-semibold text-ink-secondary hover:bg-ground"
              >
                Contact details
              </button>
              {drawerReferral && (drawerReferral.referred || drawerReferral.brought > 0) && (
                <a
                  href="/referrals"
                  className="block rounded-control border border-border bg-ground px-3 py-2 text-label text-ink-secondary hover:bg-selected"
                >
                  {drawerReferral.referred ? "Referred by a friend" : ""}
                  {drawerReferral.referred && drawerReferral.brought > 0 ? " · " : ""}
                  {drawerReferral.brought > 0
                    ? `Referred ${drawerReferral.brought} ${drawerReferral.brought === 1 ? "friend" : "friends"}`
                    : ""}
                  <span className="text-primary"> → Referrals</span>
                </a>
              )}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-label font-semibold uppercase tracking-wide text-ink-muted">
              Student
            </h3>
            <div className="space-y-2">
              <button
                onClick={act(p.onRename)}
                className="w-full rounded-control border border-border px-3 py-2 text-left text-body font-semibold text-ink-secondary hover:bg-ground"
              >
                Rename
              </button>
              {/* The one-off correction. Whole classes are graded on the
                  Assessment tab; this is for the child who joined late or was
                  mis-graded. The drawer closes FIRST so the modal is never
                  stacked on top of it — the order every other action here
                  uses. */}
              <button
                onClick={act(p.onGrade)}
                className="w-full rounded-control border border-border px-3 py-2 text-left text-body font-semibold text-ink-secondary hover:bg-ground"
              >
                Grade skills
              </button>
              {drawerFor.is_active && (
                <button
                  onClick={act(p.onInactive)}
                  className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-left text-body font-semibold text-status-danger-text hover:bg-status-danger-bg disabled:bg-status-neutral-bg disabled:text-ink-muted"
                >
                  Set inactive
                </button>
              )}
            </div>
          </div>
          {/* Classes — the add / end-enrolment controls moved here from the
              table; the Class column is now view-only. Active students only,
              as the inline controls were. */}
          {drawerFor.is_active && (
            <div>
              <h3 className="mb-2 text-label font-semibold uppercase tracking-wide text-ink-muted">
                Classes
              </h3>
              <div className="space-y-2">
                {drawerFor.classes.length === 0 ? (
                  <p className="text-body text-ink-muted">Not in any class yet.</p>
                ) : (
                  drawerFor.classes.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded-control border border-border px-3 py-2"
                    >
                      <span className="text-body text-ink-secondary">
                        {c.day ? capitalizeDay(c.day) : c.title}
                        {c.start ? ` ${c.start}` : ""}
                        {c.coach_name ? (
                          <span className="text-ink-muted"> · {c.coach_name}</span>
                        ) : null}
                      </span>
                      <button
                        onClick={act((s) => p.onRemove(s, c))}
                        aria-label={`Remove ${drawerFor.full_name} from ${c.title}`}
                        className="rounded-control border border-border-strong bg-surface px-2 py-1 text-label font-semibold text-status-danger-text hover:bg-status-danger-bg"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
                <button
                  onClick={act(p.onAddClass)}
                  className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-left text-body font-semibold text-ink hover:bg-ground disabled:bg-status-neutral-bg disabled:text-ink-muted"
                >
                  + Add class
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
