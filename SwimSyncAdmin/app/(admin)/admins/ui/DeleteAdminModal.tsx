// Admins page — typed-confirmation delete / demote modal. Deletion is refused
// for an admin with any audit history; Deactivate is the route (see the copy).

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { AdminRow } from "../types";

type Props = {
  deleteTarget: AdminRow | null;
  onClose: () => void;
  deleteWord: string;
  setDeleteWord: (v: string) => void;
  deleting: boolean;
  deleteError: string | null;
  handleDelete: () => void;
};

export function DeleteAdminModal(p: Props) {
  const { deleteTarget } = p;
  return (
    <Modal
      title={
        deleteTarget?.isCoach
          ? `Remove ${deleteTarget?.fullName || "this admin"}'s admin role`
          : `Delete ${deleteTarget?.fullName || "this admin"}`
      }
      open={!!deleteTarget}
      onClose={p.onClose}
    >
      <div className="space-y-4">
        {deleteTarget?.isCoach ? (
          <div className="rounded-card bg-status-warning-bg border border-status-warning-border p-4 text-body text-status-warning-text">
            <p className="font-semibold mb-1">
              This removes only the admin role.
            </p>
            <p>
              {deleteTarget.fullName || "They"} will remain a coach — their
              classes, attendance history and coach app access are untouched.
              They will no longer be able to use the admin panel. This cannot
              be undone from here; re-adding them as an admin means a fresh
              invite.
            </p>
          </div>
        ) : (
          <div className="rounded-card bg-status-danger-bg border border-status-danger-border p-4 text-body text-status-danger-text">
            <p className="font-semibold mb-1">This cannot be undone.</p>
            <p className="mb-2">
              The account is permanently deleted. Deletion is{" "}
              <strong>refused for an admin who has any history</strong> — a
              student edited, work recorded, anything they did that was
              written to the audit trail. The audit trail is never destroyed
              to make a deletion possible.
            </p>
            <p>
              In practice that means most admins cannot be deleted, and{" "}
              <strong>Deactivate</strong> is the route: it revokes their
              access immediately, keeps the record of what they did, and can
              be reversed.
            </p>
          </div>
        )}

        <div>
          <label className="block text-body font-medium text-ink-secondary mb-1.5">
            Type <span className="font-mono font-semibold">DELETE</span> to confirm
          </label>
          <input
            type="text"
            value={p.deleteWord}
            onChange={(e) => p.setDeleteWord(e.target.value)}
            placeholder="DELETE"
            className="h-9 w-full rounded-control border border-border-strong bg-surface px-3 text-body text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary"
          />
        </div>

        {p.deleteError && (
          <p className="text-body text-status-danger-text bg-status-danger-bg rounded-card px-3 py-2">
            {p.deleteError}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={p.onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={p.deleteWord !== "DELETE" || p.deleting}
            onClick={p.handleDelete}
          >
            {p.deleting
              ? "Working…"
              : deleteTarget?.isCoach
                ? "Remove admin role"
                : "Delete account"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
