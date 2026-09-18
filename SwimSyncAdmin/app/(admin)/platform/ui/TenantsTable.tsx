// The Businesses table. Stage 5 of docs/refactor/PLATFORM_REFACTOR_PLAN.md,
// markup verbatim from page.tsx lines 726-893.
//
// ⚠ DRIVER CONTRACT — verify-tenant-suspension and verify-tenant-provisioning
// both find a business with `page.locator("tr", { hasText })` and then read the
// row's TEXT. So the name, the admin email, the invited/active badge, `Resend`
// and `Suspend`/`Unsuspend` must all stay INSIDE that one <Tr>. Splitting any of
// them into a second row, or into a detail panel, breaks both drivers even
// though every element still exists on the page.
//
// ⚠ The sort lives HERE, with the table it sorts. Its `admin_status` accessor
// puts "no admin" FIRST when ascending: a business with no admin is joinable by
// parents but operable by nobody, which is the fault this page exists to
// surface — so it sorts to the top, not into alphabetical order.

import {
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  useTableSort,
} from "@/components/Table";
import { formatSgDate } from "@/lib/lessonDates";
import type { TenantRow } from "../types";

type Props = {
  tenants: TenantRow[];
  loadError: string | null;
  resending: string | null;
  onResend: (tenantId: string) => void;
  onChangeOwner: (t: TenantRow) => void;
  onSuspend: (m: { tenantId: string; tenantName: string; suspended: boolean }) => void;
};

export function TenantsTable({
  tenants,
  loadError,
  resending,
  onResend,
  onChangeOwner,
  onSuspend,
}: Props) {
  // All four sorts used to be declared above the page's two conditional returns
  // — "a hook after a conditional return is a hook that sometimes does not run".
  // Inside a ui/ component that constraint dissolves: this component only mounts
  // on the allowed branch, so its hook always runs.
  const tenantSort = useTableSort<TenantRow>({
    key: "display_name",
    accessors: {
      // "no admin" first when ascending. A business with no admin is joinable
      // by parents but operable by nobody, which is the fault this page exists
      // to surface — so it sorts to the top, not into alphabetical order.
      admin_status: (t) =>
        t.admin_status === "none" ? 0 : t.admin_status === "invited" ? 1 : 2,
    },
  });
  const visibleTenants = tenantSort.apply(tenants);

  return (
          <Table>
            <Thead>
              <Th sort={tenantSort} sortKey="display_name">Name</Th>
              <Th sort={tenantSort} sortKey="admin_status">Admin</Th>
              <Th sort={tenantSort} sortKey="join_code">Join code</Th>
              <Th sort={tenantSort} sortKey="active_families" firstDir="desc">Families</Th>
              <Th sort={tenantSort} sortKey="active_students" firstDir="desc">Students</Th>
              <Th sort={tenantSort} sortKey="active_classes" firstDir="desc">Classes</Th>
              <Th sort={tenantSort} sortKey="coaches" firstDir="desc">Coaches</Th>
              <Th sort={tenantSort} sortKey="last_attendance_date" firstDir="desc">Last attendance</Th>
              <Th sort={tenantSort} sortKey="sessions_this_month" firstDir="desc">Sessions this month</Th>
              <Th sort={tenantSort} sortKey="last_month_billing">Last month&apos;s billing</Th>
            </Thead>
            <Tbody>
              {tenants.length === 0 && !loadError && (
                <Tr>
                  <Td colSpan={11}>No businesses.</Td>
                </Tr>
              )}
              {visibleTenants.map((t) => (
                <Tr key={t.tenant_id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span>{t.display_name}</span>
                      {t.suspended_at && (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                          suspended
                        </span>
                      )}
                      <button
                        onClick={() =>
                          onSuspend({
                            tenantId: t.tenant_id,
                            tenantName: t.display_name,
                            suspended: t.suspended_at !== null,
                          })
                        }
                        className="text-xs font-medium text-sky-600 hover:text-sky-700"
                      >
                        {t.suspended_at ? "Unsuspend" : "Suspend"}
                      </button>
                    </div>
                  </Td>
                  <Td>
                    {/* A business with NO admin is the bad intermediate state of
                        provisioning: its join code works, so parents can join it,
                        but nobody can operate it. The route compensates by
                        deleting the tenant when an invite fails — this cell is the
                        backstop for any orphan that escapes that. */}
                    {t.admin_status === "none" ? (
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                          no admin
                        </span>
                        {/* The LOST-OWNER case: "no admin" means no OWNER — the
                            business may still hold live co-admins to promote,
                            and this button is the only remedy that isn't SQL. */}
                        <button
                          onClick={() => onChangeOwner(t)}
                          className="text-xs font-medium text-sky-600 hover:text-sky-700"
                        >
                          Set owner
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-700">
                          {t.admin_email}
                        </span>
                        {t.admin_status === "invited" ? (
                          <>
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                              invited
                            </span>
                            <button
                              onClick={() => onResend(t.tenant_id)}
                              disabled={resending === t.tenant_id}
                              className="text-xs font-medium text-sky-600 hover:text-sky-700 disabled:opacity-50"
                            >
                              {resending === t.tenant_id ? "Sending…" : "Resend"}
                            </button>
                          </>
                        ) : (
                          <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">
                            active
                          </span>
                        )}
                        <button
                          onClick={() => onChangeOwner(t)}
                          className="text-xs font-medium text-sky-600 hover:text-sky-700"
                        >
                          Change owner
                        </button>
                      </div>
                    )}
                  </Td>
                  <Td>
                    <span className="font-mono">{t.join_code}</span>
                  </Td>
                  <Td>{t.active_families}</Td>
                  <Td>{t.active_students}</Td>
                  <Td>{t.active_classes}</Td>
                  <Td>
                    {t.coaches}
                    {/* Only STAFF are flagged. A coach who owns the business has
                        no rate by design — their income is their parents'
                        invoices (PRD §7.13) — so warning about it would be noise
                        on every private coach's row forever. A coach who does NOT
                        own it and has no rate will be paid nothing by payroll,
                        which is the case worth catching before month end.
                        The owner is excluded IN SQL — see the type above for why
                        the browser scan that briefly replaced this column was
                        based on a backwards reading of the RPC. */}
                    {t.staff_without_rate > 0 && (
                      <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                        {t.staff_without_rate} unpaid
                      </span>
                    )}
                  </Td>
                  <Td>
                    {/* NEVER must be visually distinct from a date and from a
                        zero. This is the cell that shows a business has not
                        started using SwimSync at all — or has stopped. */}
                    {t.last_attendance_date ? (
                      formatSgDate(t.last_attendance_date)
                    ) : (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                        never
                      </span>
                    )}
                  </Td>
                  <Td>
                    {/* Sessions RECORDED, and how many are fully marked. This
                        deliberately does NOT claim to count lessons that were
                        never recorded — a lesson nobody touched has no session
                        row at all (PRD §7.5), and the rule that derives those
                        lives in lessonDates.ts. See the migration header. */}
                    {t.sessions_this_month === 0 ? (
                      <span className="text-gray-400">none recorded</span>
                    ) : (
                      <span
                        className={
                          t.sessions_fully_marked < t.sessions_this_month
                            ? "font-medium text-amber-700"
                            : ""
                        }
                      >
                        {t.sessions_fully_marked}/{t.sessions_this_month} marked
                      </span>
                    )}
                  </Td>
                  <Td>
                    {/* "never run" and "open" mean different things to an
                        operator and must not collapse into one word. */}
                    {t.last_month_billing === "sealed" && (
                      <span className="text-emerald-700">sealed</span>
                    )}
                    {t.last_month_billing === "open" && (
                      <span className="text-amber-700">open</span>
                    )}
                    {t.last_month_billing === "never run" && (
                      <span className="text-gray-400">never run</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
  );
}
