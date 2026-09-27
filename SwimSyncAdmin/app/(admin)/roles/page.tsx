"use client";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { useRoles } from "./domain/useRoles";
import { STANDARD_BLURB } from "./domain/rolesRows";
import { RoleGrid } from "./ui/RoleGrid";

/**
 * Roles (ROLES_PERMISSIONS_PLAN.md §5.5): what each co-admin role may see and
 * change, as 8 areas × None / View / Edit. Everyone with Admins & roles access
 * reads it — a co-admin must see the grid of the roles they may hand out —
 * but only the OWNER creates, edits, renames or deletes (D9); the role RPCs
 * refuse anyone else. The owner is never on a role and can always do
 * everything (D1). A role somebody holds cannot be deleted (P3).
 */
export default function RolesPage() {
  const p = useRoles();

  return (
    <div>
      <PageHeader
        title="Roles"
        subtitle="What each co-admin can see and change. The owner can always do everything."
        action={p.canEdit ? <Button onClick={p.openNew}>New role</Button> : undefined}
      />

      {p.pageError && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{p.pageError}</p>
      )}
      {!p.canEdit && !p.loading && (
        <p className="mb-4 text-sm text-gray-500">Only the business owner can change roles.</p>
      )}

      {p.loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {p.roles.map((role) => (
            <div key={role.id} className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="mb-1 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-gray-900">{role.name}</h2>
                  <p className="text-xs text-gray-500">
                    {role.holders === 0 ? "Nobody holds this role" : `${role.holders} admin${role.holders === 1 ? "" : "s"}`}
                  </p>
                </div>
                {p.canEdit && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => p.openEdit(role)}>Edit</Button>
                    {role.holders === 0 && (
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => p.remove(role)}>
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {role.standardKey && STANDARD_BLURB[role.standardKey] && (
                <p className="mb-3 text-sm text-gray-600">{STANDARD_BLURB[role.standardKey]}</p>
              )}
              <RoleGrid grid={role.grid} />
            </div>
          ))}
        </div>
      )}

      <Modal
        title={p.editing === "new" ? "New role" : "Edit role"}
        open={p.editing !== null}
        onClose={() => p.setEditing(null)}
      >
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Name</span>
            <input
              aria-label="Role name"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={p.draftName}
              onChange={(e) => p.setDraftName(e.target.value)}
            />
          </label>
          <RoleGrid grid={p.draftGrid} onChange={p.setDraftGrid} />
          {p.saveError && <p className="text-sm text-red-600">{p.saveError}</p>}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => p.setEditing(null)}>Cancel</Button>
            <Button className="flex-1" disabled={p.saving} onClick={p.save}>
              {p.saving ? "Saving…" : "Save role"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
