// Parents page — the set-inactive / reactivate confirmation modal.

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { FamilyRow } from "../types";
import { activeChildCount } from "../domain/parentsRows";

type Props = {
  pending: FamilyRow | null;
  onClose: () => void;
  takeChildren: boolean;
  setTakeChildren: (v: boolean) => void;
  busy: boolean;
  actionError: string | null;
  apply: () => void;
};

export function FamilyStatusModal(p: Props) {
  const { pending } = p;
  return (
    <Modal
      title={
        pending?.is_active
          ? `Mark ${pending.full_name} inactive?`
          : `Reactivate ${pending?.full_name}?`
      }
      open={pending !== null}
      onClose={p.onClose}
    >
      {pending && (
        <div className="space-y-4">
          {pending.is_active ? (
            <>
              <p className="text-body text-ink-secondary">
                They stop appearing in your lists and stop counting toward
                attendance here. This only affects{" "}
                <strong>your business</strong> — if they also have a child with
                another coach, that is untouched.
              </p>
              {activeChildCount(pending) > 0 && (
                <div className="rounded-card border border-status-warning-border bg-status-warning-bg p-3 space-y-2">
                  <p className="text-body font-medium text-status-warning-text">
                    They have {activeChildCount(pending)} active{" "}
                    {activeChildCount(pending) === 1 ? "child" : "children"}{" "}
                    here.
                  </p>
                  <label className="flex items-start gap-2 text-body text-status-warning-text">
                    <input
                      type="radio"
                      className="mt-1"
                      checked={p.takeChildren}
                      onChange={() => p.setTakeChildren(true)}
                    />
                    <span>
                      Mark{" "}
                      {pending.children
                        .filter((c) => c.is_active)
                        .map((c) => c.full_name)
                        .join(", ")}{" "}
                      inactive too
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-body text-status-warning-text">
                    <input
                      type="radio"
                      className="mt-1"
                      checked={!p.takeChildren}
                      onChange={() => p.setTakeChildren(false)}
                    />
                    <span>Just the parent — leave the children attending</span>
                  </label>
                </div>
              )}
            </>
          ) : (
            <p className="text-body text-ink-secondary">
              They reappear in your lists. Their{" "}
              <strong>children stay inactive</strong> — reactivate and assign
              each one deliberately, so nobody lands on the wrong roster.
            </p>
          )}

          <p className="rounded-control border border-border bg-ground px-3 py-2 text-label text-ink-secondary">
            Nothing is deleted. Attendance, invoices and any credit balance are
            kept exactly as they are.
            {pending.is_active && (
              <>
                {" "}
                A <strong>pending charge</strong> (money the family owes) must be
                settled or written off — on the Invoices page — before they can be
                set inactive.
              </>
            )}
          </p>

          {p.actionError && (
            <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">
              {p.actionError}
            </p>
          )}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={p.onClose}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={p.busy} onClick={p.apply}>
              {p.busy
                ? "Saving…"
                : pending.is_active
                  ? "Set inactive"
                  : "Reactivate"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
