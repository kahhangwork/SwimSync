"use client";

import { useCallback, useEffect, useState } from "react";
import { usePermissions } from "@/components/PermissionsProvider";
import { gridProblem, NO_ACCESS, type Grid } from "@/lib/permissions";
import * as repo from "../dao/roles.repo";
import { toRoleRows, type RoleRow } from "./rolesRows";

/** Everything the Roles page needs. Role CRUD is OWNER-only (D9) — the RPCs
 *  refuse anyone else; `canEdit` just keeps the page honest about it. */
export function useRoles() {
  const { isOwner } = usePermissions();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  // The grid being edited: an existing role's id, "new", or null (closed).
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftGrid, setDraftGrid] = useState<Grid>({ ...NO_ACCESS });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The role awaiting the Delete confirmation, or null (closed). Delete never
  // fires from the "…" menu itself — DESIGN.md puts every destructive action
  // behind a confirmation (BACKLOG "Deleting a role has no confirmation step").
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: r }, { data: p }, { data: h }] = await Promise.all([
      repo.loadRoles(),
      repo.loadRolePermissions(),
      repo.loadHolders(),
    ]);
    setRoles(toRoleRows(r ?? [], p ?? [], h ?? []));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    setEditing("new");
    setDraftName("");
    setDraftGrid({ ...NO_ACCESS, operations: "view" });
    setSaveError(null);
  }

  function openEdit(role: RoleRow) {
    setEditing(role.id);
    setDraftName(role.name);
    setDraftGrid({ ...role.grid });
    setSaveError(null);
  }

  async function save() {
    const problem = gridProblem(draftGrid);
    if (problem) return setSaveError(problem);
    if (!draftName.trim()) return setSaveError("Give the role a name.");
    setSaving(true);
    setSaveError(null);
    let error: { message: string } | null = null;
    if (editing === "new") {
      ({ error } = await repo.createRole(draftName.trim(), draftGrid));
    } else if (editing) {
      const current = roles.find((r) => r.id === editing);
      if (current && current.name !== draftName.trim()) {
        ({ error } = await repo.renameRole(editing, draftName.trim()));
      }
      if (!error) ({ error } = await repo.updateRolePermissions(editing, draftGrid));
    }
    setSaving(false);
    if (error) return setSaveError(error.message);
    setEditing(null);
    load();
  }

  function askRemove(role: RoleRow) {
    setDeleteError(null);
    setDeleteTarget(role);
  }

  async function confirmRemove() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    const { error } = await repo.deleteRole(deleteTarget.id);
    setDeleting(false);
    if (error) return setDeleteError(error.message);
    setDeleteTarget(null);
    load();
  }

  return {
    roles, loading, canEdit: isOwner,
    editing, setEditing, draftName, setDraftName, draftGrid, setDraftGrid,
    saving, saveError, openNew, openEdit, save,
    deleteTarget, setDeleteTarget, deleting, deleteError, askRemove, confirmRemove,
  };
}
