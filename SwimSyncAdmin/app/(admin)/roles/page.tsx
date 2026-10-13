"use client";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
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
        <p className="mb-4 rounded-card bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">{p.pageError}</p>
      )}
      {!p.canEdit && !p.loading && (
        <p className="mb-4 text-body text-ink-muted">Only the business owner can change roles.</p>
      )}

      {p.loading ? (
        <p className="text-ink-muted">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {p.roles.map((role) => (
            <div key={role.id} className="rounded-card border border-border bg-surface p-4">
              <div className="mb-1 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-headline font-semibold text-ink">{role.name}</h2>
                  <p className="text-label text-ink-muted">
                    {role.holders === 0 ? "Nobody holds this role" : `${role.holders} admin${role.holders === 1 ? "" : "s"}`}
                  </p>
                </div>
                {p.canEdit && (
                  // Edit inline; Delete (only offered while nobody holds the
                  // role) in the "…" menu — no inline destructive button
                  // (DESIGN.md; UI restyle 5.25). Same handlers.
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => p.openEdit(role)}>Edit</Button>
                    <RowMenu>
                      {role.holders === 0 && (
                        <RowMenuItem destructive onClick={() => p.remove(role)}>
                          Delete
                        </RowMenuItem>
                      )}
                    </RowMenu>
                  </div>
                )}
              </div>
              {role.standardKey && STANDARD_BLURB[role.standardKey] && (
                <p className="mb-3 text-body text-ink-secondary">{STANDARD_BLURB[role.standardKey]}</p>
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
          <label className="block text-body">
            <span className="mb-1 block font-medium text-ink-secondary">Name</span>
            <input
              aria-label="Role name"
              className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
              value={p.draftName}
              onChange={(e) => p.setDraftName(e.target.value)}
            />
          </label>
          <RoleGrid grid={p.draftGrid} onChange={p.setDraftGrid} />
          {p.saveError && <p className="text-body text-status-danger-text">{p.saveError}</p>}
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
