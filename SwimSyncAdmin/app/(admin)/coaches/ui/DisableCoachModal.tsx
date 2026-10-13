// Coaches page — disable modal: replacement handover + the ⚠ RISK 8 unmarked-
// lessons list. Both the handover and the disable happen in one step, or not.

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { CoachRow } from "../types";
import type { UnmarkedOverrideLesson } from "../domain/coachDisableImpact";

type Props = {
  disableModal: CoachRow | null;
  onClose: () => void;
  replacementId: string;
  setReplacementId: (v: string) => void;
  replacementOptions: CoachRow[];
  impact: UnmarkedOverrideLesson[] | null;
  impactError: string | null;
  actionError: string | null;
  actionBusy: boolean;
  handleDisable: () => void;
};

export function DisableCoachModal(p: Props) {
  const { disableModal } = p;
  return (
    <Modal
      title={`Disable ${disableModal?.full_name ?? ""}?`}
      open={!!disableModal}
      onClose={p.onClose}
    >
      <div className="space-y-4">
        <p className="text-body text-ink-secondary">
          Their coach access ends immediately and their login is blocked.
          Their taught lessons and past pay are untouched — disabling is
          forward-looking.
        </p>

        {disableModal && disableModal.class_titles.length > 0 && (
          <div>
            <p className="text-body text-ink-secondary mb-2">
              They still teach{" "}
              <span className="font-medium">
                {disableModal.class_titles.join(", ")}
              </span>
              . Choose a replacement — the handover and the disable happen in
              one step, or not at all.
            </p>
            <select
              value={p.replacementId}
              onChange={(e) => p.setReplacementId(e.target.value)}
              className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
            >
              <option value="">Choose the replacement coach…</option>
              {p.replacementOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
            {p.replacementOptions.length === 0 && (
              <p className="mt-2 text-body text-ink-muted">
                No other active coach to hand these classes to — hire or
                reactivate one first.
              </p>
            )}
          </div>
        )}

        {/* ⚠ RISK 8: unmarked lessons whose substitute override names this
            coach. After the disable only an admin can mark them, and an
            unmarked lesson blocks billing with no override. */}
        {p.impactError ? (
          <p className="text-body text-status-danger-text bg-status-danger-bg rounded-card px-3 py-2">
            Could not check their unmarked lessons: {p.impactError}
          </p>
        ) : p.impact === null ? (
          <p className="text-body text-ink-muted">Checking unmarked lessons…</p>
        ) : p.impact.length > 0 ? (
          <div className="rounded-card bg-status-warning-bg p-3">
            <p className="text-body font-medium text-status-warning-text mb-1">
              Marking these falls to you (admin) after disabling:
            </p>
            <ul className="text-body text-status-warning-text space-y-0.5">
              {p.impact.map((l) => (
                <li key={l.sessionId}>
                  {l.sessionDate} — {l.title} ({l.unmarkedCount} unmarked)
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {p.actionError && (
          <p className="text-body text-status-danger-text bg-status-danger-bg rounded-card px-3 py-2">
            {p.actionError}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={p.onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={
              p.actionBusy ||
              ((disableModal?.class_titles.length ?? 0) > 0 && !p.replacementId)
            }
            onClick={p.handleDisable}
          >
            {p.actionBusy ? "Disabling…" : "Disable coach"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
