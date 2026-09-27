// Admins page — the roster table. Owns its own useTableSort.

import { ShieldCheck } from "lucide-react";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import type { AdminRow, RoleOption } from "../types";
import { STATUS_PILL } from "../constants";

type Props = {
  admins: AdminRow[];
  loading: boolean;
  /** Admins & roles: Edit — shows the levers. The server decides each one. */
  isOwner: boolean;
  roles: RoleOption[];
  /** The roles this admin may give (display only — the RPC is the boundary). */
  assignable: RoleOption[];
  changeRole: (row: AdminRow, roleId: string) => void;
  busyRow: string | null;
  rowAction: (row: AdminRow, path: string) => void;
  openDelete: (row: AdminRow) => void;
};

export function AdminsTable(p: Props) {
  const sort = useTableSort<AdminRow>({
    key: "fullName",
    accessors: {
      roles: (a) => (a.isCoach ? 1 : 0),
      status: (a) => a.status,
    },
  });
  const visible = sort.apply(p.admins);

  return (
    <Table>
      <Thead>
        <Th sort={sort} sortKey="fullName">Name</Th>
        <Th sort={sort} sortKey="email">Email</Th>
        <Th sort={sort} sortKey="phone">Phone</Th>
        <Th sort={sort} sortKey="roles">Type</Th>
        <Th>Role</Th>
        <Th sort={sort} sortKey="status">Status</Th>
        <Th>Actions</Th>
      </Thead>
      <Tbody>
        {p.loading ? (
          <Tr>
            <Td className="text-center text-gray-400 py-8" colSpan={7}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="text-center text-gray-400 py-8" colSpan={7}>
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
              <Td className="text-xs">
                {admin.isOwner ? (
                  <span className="text-gray-500">Everything (owner)</span>
                ) : p.isOwner && p.assignable.length > 0 ? (
                  <select
                    aria-label={`Role for ${admin.fullName || admin.email}`}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
                    value={admin.roleId ?? ""}
                    disabled={p.busyRow === admin.id}
                    onChange={(e) => p.changeRole(admin, e.target.value)}
                  >
                    {/* The current role stays listed even if it is stronger
                        than the viewer's — they may move someone DOWN (D9). */}
                    {p.roles
                      .filter((r) => r.id === admin.roleId || p.assignable.some((a) => a.id === r.id))
                      .map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                  </select>
                ) : (
                  <span className="text-gray-500">
                    {p.roles.find((r) => r.id === admin.roleId)?.name ?? "—"}
                  </span>
                )}
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
                {p.isOwner && !admin.isOwner && (
                  <div className="flex flex-wrap gap-2">
                    {admin.status === "invited" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={p.busyRow === admin.id}
                        onClick={() =>
                          p.rowAction(admin, "/api/resend-admin-invite")
                        }
                      >
                        Resend invite
                      </Button>
                    )}
                    {admin.status === "deactivated" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={p.busyRow === admin.id}
                        onClick={() =>
                          p.rowAction(admin, "/api/reactivate-admin")
                        }
                      >
                        Reactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={p.busyRow === admin.id}
                        onClick={() =>
                          p.rowAction(admin, "/api/deactivate-admin")
                        }
                      >
                        Deactivate
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600"
                      disabled={p.busyRow === admin.id}
                      onClick={() => p.openDelete(admin)}
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
  );
}
