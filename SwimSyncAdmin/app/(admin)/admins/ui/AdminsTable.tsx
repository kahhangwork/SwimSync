// Admins page — the roster table. Owns its own useTableSort.

import { Tag } from "@/components/ui/Tag";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { ShieldCheck } from "lucide-react";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import type { AdminRow, RoleOption } from "../types";
import { STATUS_TONE } from "../constants";

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
            <Td className="text-center text-ink-muted py-8" colSpan={7}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={7}>
              No admin accounts.
            </Td>
          </Tr>
        ) : (
          visible.map((admin) => (
            <Tr key={admin.id}>
              <Td>
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-selected text-body font-semibold text-ink-secondary">
                    {admin.fullName?.charAt(0) || "?"}
                  </div>
                  <span className="font-medium text-ink">
                    {admin.fullName || "—"}
                  </span>
                </div>
              </Td>
              <Td className="text-ink-muted">{admin.email}</Td>
              <Td className="text-ink-muted">{admin.phone ?? "—"}</Td>
              <Td className="text-ink-muted text-label">
                {admin.isCoach ? "Admin + Coach" : "Admin"}
              </Td>
              <Td className="text-label">
                {admin.isOwner ? (
                  <span className="text-ink-muted">Everything (owner)</span>
                ) : p.isOwner && p.assignable.length > 0 ? (
                  <select
                    aria-label={`Role for ${admin.fullName || admin.email}`}
                    className="h-[1.875rem] rounded-control border border-border-strong bg-surface px-2 text-label text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary"
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
                  <span className="text-ink-muted">
                    {p.roles.find((r) => r.id === admin.roleId)?.name ?? "—"}
                  </span>
                )}
              </Td>
              <Td>
                {admin.isOwner ? (
                  <Tag tone="neutral" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> Owner
                  </Tag>
                ) : admin.status ? (
                  <Tag tone={STATUS_TONE[admin.status]}>{admin.status}</Tag>
                ) : (
                  <span className="text-label text-ink-muted">—</span>
                )}
              </Td>
              <Td>
                {/* No actions on the owner's row — the owner cannot be
                    deactivated or deleted, so offering the buttons would
                    only manufacture an error. */}
                {/* One inline action — the one the row's state calls for (an
                    invite to resend, a deactivated admin to bring back); the
                    rest in the row "…" menu (DESIGN.md → Tables; UI restyle
                    5.24). Every handler is the one it was. */}
                {p.isOwner && !admin.isOwner && (
                  <div className="flex items-center gap-1.5">
                    {admin.status === "invited" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={p.busyRow === admin.id}
                        onClick={() =>
                          p.rowAction(admin, "/api/resend-admin-invite")
                        }
                      >
                        Resend invite
                      </Button>
                    )}
                    {admin.status === "deactivated" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={p.busyRow === admin.id}
                        onClick={() =>
                          p.rowAction(admin, "/api/reactivate-admin")
                        }
                      >
                        Reactivate
                      </Button>
                    )}
                    <RowMenu>
                      {admin.status !== "deactivated" && (
                        <RowMenuItem
                          disabled={p.busyRow === admin.id}
                          onClick={() =>
                            p.rowAction(admin, "/api/deactivate-admin")
                          }
                        >
                          Deactivate
                        </RowMenuItem>
                      )}
                      <RowMenuItem
                        destructive
                        disabled={p.busyRow === admin.id}
                        onClick={() => p.openDelete(admin)}
                      >
                        Delete
                      </RowMenuItem>
                    </RowMenu>
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
