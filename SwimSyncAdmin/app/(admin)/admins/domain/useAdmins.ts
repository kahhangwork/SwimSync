// Admins page — all state and orchestration. The page composes this hook.

import { useCallback, useEffect, useState } from "react";
import type { AdminRow } from "../types";
import * as repo from "../dao/admins.repo";
import { removeAdminRole } from "../dao/admins.rpc";
import { authedFetch, listAdmins } from "../dao/admins.api";
import { mergeStatuses, toAdminRows } from "./adminsRows";

export function useAdmins() {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isCoachInvite, setIsCoachInvite] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  // An invite whose email failed: the account exists, the link must be handed
  // over by hand. A warning with the link, never a plain success.
  const [inviteLinkWarning, setInviteLinkWarning] = useState<string | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AdminRow | null>(null);
  const [deleteWord, setDeleteWord] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [busyRow, setBusyRow] = useState<string | null>(null);

  // Two-phase load, deliberately. Everything except invited-vs-active is
  // client-readable under RLS, so the table paints in one round-trip; the ONE
  // fact the browser cannot read — auth.users.last_sign_in_at — comes from the
  // server route and its pills fill in when it arrives.
  const loadAdmins = useCallback(async () => {
    setPageError(null);
    const { data: auth } = await repo.getUser();
    const myId = auth.user?.id;

    const [{ data: profiles }, { data: tenants }, { data: coachRows }] =
      await Promise.all([
        repo.loadProfiles(),
        repo.loadTenants(),
        repo.loadCoaches(),
      ]);

    const ownerId = (tenants ?? [])[0]?.owner_profile_id ?? null;
    const coachIds = new Set((coachRows ?? []).map((c) => c.profile_id));

    setAdmins(toAdminRows(profiles ?? [], ownerId, coachIds));
    setIsOwner(!!myId && myId === ownerId);
    setLoading(false);

    // Phase 2: the auth-layer half. On failure the pills quietly stay "—".
    const json = await listAdmins();
    if (!json?.admins) return;
    setAdmins((rows) => mergeStatuses(rows, json.admins as AdminRow[]));
  }, []);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  async function handleInvite() {
    if (!name.trim() || !email.trim()) {
      setInviteError("Name and email are required.");
      return;
    }
    setInviting(true);
    setInviteError(null);
    const { ok, json } = await authedFetch("/api/invite-admin", {
      name,
      email,
      phone,
      isCoach: isCoachInvite,
    });
    setInviting(false);
    if (!ok) {
      setInviteError(json.error ?? "Failed to invite the admin.");
      return;
    }
    setShowInvite(false);
    setName("");
    setEmail("");
    setPhone("");
    setIsCoachInvite(false);
    if (!json.emailSent && json.inviteLink) {
      setInviteLinkWarning(json.inviteLink);
    }
    loadAdmins();
  }

  async function rowAction(row: AdminRow, path: string) {
    setBusyRow(row.id);
    setPageError(null);
    const { ok, json } = await authedFetch(path, { profileId: row.id });
    setBusyRow(null);
    if (!ok) {
      setPageError(json.error ?? "The action failed.");
      if (json.inviteLink) setInviteLinkWarning(json.inviteLink);
      return;
    }
    if (json.inviteLink) setInviteLinkWarning(json.inviteLink);
    loadAdmins();
  }

  async function handleDelete() {
    if (!deleteTarget || deleteWord !== "DELETE") return;
    setDeleting(true);
    setDeleteError(null);

    if (deleteTarget.isCoach) {
      const { error } = await removeAdminRole(deleteTarget.id);
      setDeleting(false);
      if (error) {
        setDeleteError(error.message);
        return;
      }
    } else {
      const { ok, json } = await authedFetch("/api/delete-admin", {
        profileId: deleteTarget.id,
      });
      setDeleting(false);
      if (!ok) {
        setDeleteError(json.error ?? "Failed to delete the admin.");
        return;
      }
    }

    setDeleteTarget(null);
    setDeleteWord("");
    loadAdmins();
  }

  function openInvite() {
    setName("");
    setEmail("");
    setPhone("");
    setIsCoachInvite(false);
    setInviteError(null);
    setShowInvite(true);
  }

  function openDelete(admin: AdminRow) {
    setDeleteWord("");
    setDeleteError(null);
    setDeleteTarget(admin);
  }

  return {
    admins,
    isOwner,
    loading,
    pageError,
    showInvite,
    setShowInvite,
    name,
    setName,
    email,
    setEmail,
    phone,
    setPhone,
    isCoachInvite,
    setIsCoachInvite,
    inviting,
    inviteError,
    inviteLinkWarning,
    setInviteLinkWarning,
    deleteTarget,
    setDeleteTarget,
    deleteWord,
    setDeleteWord,
    deleting,
    deleteError,
    busyRow,
    handleInvite,
    rowAction,
    handleDelete,
    openInvite,
    openDelete,
  };
}
