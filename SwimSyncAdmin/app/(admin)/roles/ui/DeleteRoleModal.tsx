// Roles page — the confirmation in front of Delete. Only a role nobody holds
// is offered for deletion (P3, and the delete RPC refuses otherwise), so this
// is a plain confirm, not the Admins page's typed DELETE.

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { RoleRow } from "../domain/rolesRows";

type Props = {
  role: RoleRow | null;
  onClose: () => void;
  deleting: boolean;
  deleteError: string | null;
  onConfirm: () => void;
};

export function DeleteRoleModal(p: Props) {
  return (
    <Modal title={`Delete the role ${p.role?.name ?? ""}?`} open={!!p.role} onClose={p.onClose}>
      <div className="space-y-4">
        <p className="text-body text-ink-secondary">
          Nobody holds this role, so no admin loses access. The role and its permissions are removed for good — to use it
          again you would set it up from scratch.
        </p>
        {p.deleteError && (
          <p className="rounded-card bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">{p.deleteError}</p>
        )}
        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={p.onClose}>Cancel</Button>
          <Button variant="danger" className="flex-1" disabled={p.deleting} onClick={p.onConfirm}>
            {p.deleting ? "Deleting…" : "Delete role"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
