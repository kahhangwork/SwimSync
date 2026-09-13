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
          <div className="rounded-xl bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-800">
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
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-800">
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
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Type <span className="font-mono font-bold">DELETE</span> to confirm
          </label>
          <input
            type="text"
            value={p.deleteWord}
            onChange={(e) => p.setDeleteWord(e.target.value)}
            placeholder="DELETE"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </div>

        {p.deleteError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {p.deleteError}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={p.onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1 bg-red-600 hover:bg-red-700"
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
