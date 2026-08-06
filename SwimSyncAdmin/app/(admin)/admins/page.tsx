"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

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

type AdminRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  isOwner: boolean;
  isCoach: boolean;
  /** null = invited-vs-active not known yet (the one auth-layer fact). */
  status: "active" | "invited" | "deactivated" | null;
};

function Field({
  label,
  placeholder,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
    </div>
  );
}

const STATUS_PILL: Record<NonNullable<AdminRow["status"]>, string> = {
  active: "bg-green-100 text-green-700",
  invited: "bg-amber-100 text-amber-700",
  deactivated: "bg-gray-200 text-gray-600",
};

export default function AdminsPage() {
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

  async function authedFetch(path: string, body?: unknown) {
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
  }

  // Two-phase load, deliberately. Everything except invited-vs-active is
  // client-readable under RLS (profiles, coaches, the owner column), so the
  // table paints in one direct round-trip like every other page. The ONE fact
  // the browser cannot read — auth.users.last_sign_in_at — comes from the
  // server route, which sits behind a serverless cold start; its pills fill
  // in when it arrives rather than holding the whole page hostage.
  const loadAdmins = useCallback(async () => {
    setPageError(null);
    const { data: auth } = await supabase.auth.getUser();
    const myId = auth.user?.id;

    const [{ data: profiles }, { data: tenants }, { data: coachRows }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, phone, admin_disabled_at")
          .eq("role", "tenant_admin")
          .order("created_at"),
        supabase.from("tenants").select("id, owner_profile_id"),
        supabase.from("coaches").select("profile_id"),
      ]);

    const ownerId = (tenants ?? [])[0]?.owner_profile_id ?? null;
    const coachIds = new Set((coachRows ?? []).map((c) => c.profile_id));

    setAdmins(
      (profiles ?? []).map((p) => ({
        id: p.id,
        fullName: p.full_name,
        email: p.email,
        phone: p.phone,
        isOwner: p.id === ownerId,
        isCoach: coachIds.has(p.id),
        // Deactivation is client-readable; invited-vs-active is not (yet null).
        status: p.admin_disabled_at ? ("deactivated" as const) : null,
      }))
    );
    setIsOwner(!!myId && myId === ownerId);
    setLoading(false);

    // Phase 2: the auth-layer half. On failure the pills quietly stay "—";
    // the roster above is already correct and the actions carry their own
    // errors, so a red banner here would outshout a cosmetic gap.
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/list-admins", {
      headers: {
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
    }).catch(() => null);
    if (!res?.ok) return;
    const json = await res.json().catch(() => null);
    if (!json?.admins) return;
    const statusById = new Map<string, AdminRow["status"]>(
      json.admins.map((a: AdminRow) => [a.id, a.status])
    );
    setAdmins((rows) =>
      rows.map((r) => ({ ...r, status: statusById.get(r.id) ?? r.status }))
    );
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
      // Demotion, not deletion: the RPC is owner-gated in the database and
      // touches nothing at the auth layer, so it is called directly.
      const { error } = await supabase.rpc("remove_admin_role", {
        p_profile_id: deleteTarget.id,
      });
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

  const sort = useTableSort<AdminRow>({
    key: "fullName",
    accessors: {
      roles: (a) => (a.isCoach ? 1 : 0),
      status: (a) => a.status,
    },
  });
  const visible = sort.apply(admins);

  return (
    <div>
      <PageHeader
        title="Admins"
        subtitle={`${admins.length} admin ${admins.length === 1 ? "account" : "accounts"}`}
        action={
          isOwner ? (
            <Button
              onClick={() => {
                setName("");
                setEmail("");
                setPhone("");
                setIsCoachInvite(false);
                setInviteError(null);
                setShowInvite(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Invite admin
            </Button>
          ) : undefined
        }
      />

      {pageError && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {pageError}
        </p>
      )}

      {inviteLinkWarning && (
        <div className="mb-4 rounded-xl bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-800">
          <p className="font-semibold mb-1">
            The invite email could not be sent.
          </p>
          <p className="mb-2">
            The account exists — pass this one-time link to them yourself:
          </p>
          <code className="block break-all text-xs bg-white rounded-lg p-2 border border-yellow-200">
            {inviteLinkWarning}
          </code>
          <button
            className="mt-2 text-xs font-medium text-yellow-700 hover:underline"
            onClick={() => setInviteLinkWarning(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <Table>
        <Thead>
          <Th sort={sort} sortKey="fullName">Name</Th>
          <Th sort={sort} sortKey="email">Email</Th>
          <Th sort={sort} sortKey="phone">Phone</Th>
          <Th sort={sort} sortKey="roles">Roles</Th>
          <Th sort={sort} sortKey="status">Status</Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={6}>
                Loading…
              </Td>
            </Tr>
          ) : visible.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={6}>
                No admin accounts.
              </Td>
            </Tr>
          ) : (
            visible.map((admin) => (
              <Tr key={admin.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700 text-sm font-bold">
                      {admin.fullName?.charAt(0) || "?"}
                    </div>
                    <span className="font-medium text-gray-900">
                      {admin.fullName || "—"}
                    </span>
                  </div>
                </Td>
                <Td className="text-gray-500">{admin.email}</Td>
                <Td className="text-gray-500">{admin.phone ?? "—"}</Td>
                <Td className="text-gray-500 text-xs">
                  {admin.isCoach ? "Admin + Coach" : "Admin"}
                </Td>
                <Td>
                  {admin.isOwner ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-700">
                      <ShieldCheck className="h-3 w-3" /> Owner
                    </span>
                  ) : admin.status ? (
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL[admin.status]}`}
                    >
                      {admin.status}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </Td>
                <Td>
                  {/* No actions on the owner's row — the owner cannot be
                      deactivated or deleted, so offering the buttons would
                      only manufacture an error. */}
                  {isOwner && !admin.isOwner && (
                    <div className="flex flex-wrap gap-2">
                      {admin.status === "invited" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyRow === admin.id}
                          onClick={() =>
                            rowAction(admin, "/api/resend-admin-invite")
                          }
                        >
                          Resend invite
                        </Button>
                      )}
                      {admin.status === "deactivated" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyRow === admin.id}
                          onClick={() =>
                            rowAction(admin, "/api/reactivate-admin")
                          }
                        >
                          Reactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyRow === admin.id}
                          onClick={() =>
                            rowAction(admin, "/api/deactivate-admin")
                          }
                        >
                          Deactivate
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600"
                        disabled={busyRow === admin.id}
                        onClick={() => {
                          setDeleteWord("");
                          setDeleteError(null);
                          setDeleteTarget(admin);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      {/* Invite Modal */}
      <Modal
        title="Invite an admin"
        open={showInvite}
        onClose={() => setShowInvite(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            They&apos;ll get an email with a link to set their password. A
            co-admin can do everything you can — except manage admin accounts.
          </p>
          <Field
            label="Full Name"
            placeholder="Priya Nair"
            value={name}
            onChange={setName}
          />
          <Field
            label="Email"
            placeholder="admin@example.com"
            type="email"
            value={email}
            onChange={setEmail}
          />
          <Field
            label="Phone (optional)"
            placeholder="+65 9876 5432"
            value={phone}
            onChange={setPhone}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isCoachInvite}
              onChange={(e) => setIsCoachInvite(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-400"
            />
            They also teach — create a coach account too
          </label>

          {inviteError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {inviteError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowInvite(false)}
            >
              Cancel
            </Button>
            <Button className="flex-1" disabled={inviting} onClick={handleInvite}>
              {inviting ? "Inviting…" : "Send invite"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Modal — typed confirmation */}
      <Modal
        title={
          deleteTarget?.isCoach
            ? `Remove ${deleteTarget?.fullName || "this admin"}'s admin role`
            : `Delete ${deleteTarget?.fullName || "this admin"}`
        }
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
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
                The account is permanently deleted, and{" "}
                <strong>
                  every audit-log entry recorded by this admin is removed with
                  it
                </strong>
                . If they have recorded any work (students added, invoices
                confirmed, bookings made), deletion is refused — deactivate
                them instead.
              </p>
              <p>
                If you only want to revoke their access, use{" "}
                <strong>Deactivate</strong> — it keeps the history and can be
                reversed.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Type <span className="font-mono font-bold">DELETE</span> to
              confirm
            </label>
            <input
              type="text"
              value={deleteWord}
              onChange={(e) => setDeleteWord(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>

          {deleteError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {deleteError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700"
              disabled={deleteWord !== "DELETE" || deleting}
              onClick={handleDelete}
            >
              {deleting
                ? "Working…"
                : deleteTarget?.isCoach
                  ? "Remove admin role"
                  : "Delete account"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
