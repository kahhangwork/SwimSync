"use client";

import { PageHeader } from "@/components/PageHeader";
import { useAdmins } from "./domain/useAdmins";
import { InviteAdminButton } from "./ui/InviteAdminButton";
import { InviteLinkWarning } from "./ui/InviteLinkWarning";
import { AdminsTable } from "./ui/AdminsTable";
import { InviteAdminModal } from "./ui/InviteAdminModal";
import { DeleteAdminModal } from "./ui/DeleteAdminModal";

/**
 * Who administers this business, and — for the OWNER only — the levers:
 * invite, resend, deactivate/reactivate, delete. Visible to every admin
 * (seeing who runs the business is not a privilege); every button is
 * owner-gated server-side, so hiding them here is honesty, not the boundary.
 *
 * Deleting is deliberately two different things (20260806000100):
 *   - an admin who is ALSO a coach loses only the admin role (demotion via
 *     the remove_admin_role RPC) — their coach account, classes and history
 *     survive;
 *   - a PURE admin's account is deleted outright, along with their audit-log
 *     history — which is why that path demands the word DELETE typed first.
 */
export default function AdminsPage() {
  const p = useAdmins();

  return (
    <div>
      <PageHeader
        title="Admins"
        subtitle={`${p.admins.length} admin ${p.admins.length === 1 ? "account" : "accounts"}`}
        action={p.isOwner ? <InviteAdminButton onOpen={p.openInvite} /> : undefined}
      />

      {p.pageError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {p.pageError}
        </p>
      )}

      {p.inviteLinkWarning && (
        <InviteLinkWarning
          link={p.inviteLinkWarning}
          onDismiss={() => p.setInviteLinkWarning(null)}
        />
      )}

      <AdminsTable
        admins={p.admins}
        loading={p.loading}
        isOwner={p.isOwner}
        busyRow={p.busyRow}
        rowAction={p.rowAction}
        openDelete={p.openDelete}
      />

      <InviteAdminModal
        open={p.showInvite}
        onClose={() => p.setShowInvite(false)}
        name={p.name}
        setName={p.setName}
        email={p.email}
        setEmail={p.setEmail}
        phone={p.phone}
        setPhone={p.setPhone}
        isCoachInvite={p.isCoachInvite}
        setIsCoachInvite={p.setIsCoachInvite}
        inviting={p.inviting}
        inviteError={p.inviteError}
        handleInvite={p.handleInvite}
      />

      <DeleteAdminModal
        deleteTarget={p.deleteTarget}
        onClose={() => p.setDeleteTarget(null)}
        deleteWord={p.deleteWord}
        setDeleteWord={p.setDeleteWord}
        deleting={p.deleting}
        deleteError={p.deleteError}
        handleDelete={p.handleDelete}
      />
    </div>
  );
}
