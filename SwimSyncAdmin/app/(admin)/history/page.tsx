"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import {
  diffSnapshots,
  formatAuditValue,
  actorLabel,
  type AuditDiff,
} from "@/lib/auditDiff";

/**
 * Change History — a read-only window onto audit_log for the tenant admin.
 *
 * Deliberately "Change History", NOT "Audit log": the trail has holes BY DESIGN.
 * prepare_admin_delete() purges a deleted admin's rows, and a write with no JWT
 * actor records nothing at all (§7.120). The label must not promise a complete
 * legal record. RLS (audit_log_select) already scopes rows to this tenant.
 *
 * ONE global filtered list (not per-entity): entity type + a date range are
 * filters, exactly as the Attendance page does it. Both are applied in the
 * DATABASE so the ROW_LIMIT cap bites AFTER filtering, not before.
 */

type AuditRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: unknown;
  new_value: unknown;
};

// The closed set of entity types the backend writes. A stable enum, not user
// data — safe to hardcode for the filter dropdown.
const ENTITY_TYPES = [
  "Student",
  "Class",
  "Profile",
  "Tenant",
  "ParentTenant",
  "lesson_session",
  "Coach",
];

const ROW_LIMIT = 1000;

function formatWhen(ts: string): string {
  // Display only — never fed back into date logic. Explicit SGT so the row
  // reads in the admin's own timezone regardless of the browser's.
  return new Date(ts).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const KIND_LABEL: Record<AuditDiff["kind"], string> = {
  created: "Created",
  updated: "Changed",
  deleted: "Removed",
  unknown: "—",
};

export default function HistoryPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Re-queries when a filter moves, because both are applied in the DATABASE.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      let query = supabase
        .from("audit_log")
        .select(
          "id, created_at, actor_id, action, entity_type, entity_id, old_value, new_value, profiles(full_name)",
        )
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT);

      if (entityFilter !== "All") query = query.eq("entity_type", entityFilter);
      // A whole-day range on a timestamptz column: everything on `dateTo` too.
      if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00+08:00`);
      if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59+08:00`);

      const { data, error } = await query;
      if (cancelled) return;

      if (error) {
        setLoadError(error.message);
        setRows([]);
        setLoading(false);
        return;
      }

      setLoadError(null);
      setRows(
        (data ?? []).map((r: any) => ({
          id: r.id,
          created_at: r.created_at,
          actor_id: r.actor_id ?? null,
          actor_name: r.profiles?.full_name ?? null,
          action: r.action,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          old_value: r.old_value,
          new_value: r.new_value,
        })),
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [entityFilter, dateFrom, dateTo]);

  const anyFilter = entityFilter !== "All" || dateFrom !== "" || dateTo !== "";

  function clearFilters() {
    setEntityFilter("All");
    setDateFrom("");
    setDateTo("");
  }

  const inputClass =
    "rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400";

  return (
    <div>
      <PageHeader
        title="Change History"
        subtitle="Who changed what, and when — for resolving a dispute"
      />

      <p className="mb-4 max-w-2xl text-xs text-gray-500">
        A record of edits across your business — attendance, students, classes and
        more. Not a complete legal audit: some actions (a removed admin&apos;s
        history, a system data-fix) are not shown, so a gap here does not prove
        nothing happened.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Type
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className={inputClass}
          >
            <option value="All">All types</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          From
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          To
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className={inputClass}
          />
        </label>
        {anyFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="px-3 py-2.5 text-sm font-medium text-sky-600 hover:text-sky-700 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the history: {loadError}. The list below is incomplete —
          do not read it as the full trail.
        </div>
      )}

      {!loading && !loadError && rows.length === ROW_LIMIT && (
        <p className="mb-3 text-sm text-amber-700">
          Showing the {ROW_LIMIT} most recent changes. Narrow the date range or
          type to see earlier ones.
        </p>
      )}

      <Table>
        <Thead>
          <Th>When</Th>
          <Th>Who</Th>
          <Th>What</Th>
          <Th>Change</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={4}>
                Loading…
              </Td>
            </Tr>
          ) : rows.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={4}>
                {anyFilter
                  ? "No changes match these filters."
                  : "No changes recorded."}
              </Td>
            </Tr>
          ) : (
            rows.map((r) => {
              const diff = diffSnapshots(r.old_value, r.new_value);
              return (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap text-gray-500 text-xs">
                    {formatWhen(r.created_at)}
                  </Td>
                  <Td className="text-gray-700">
                    {actorLabel(r.actor_id, r.actor_name)}
                  </Td>
                  <Td className="text-gray-600">
                    <span className="font-medium text-gray-800">
                      {KIND_LABEL[diff.kind]}
                    </span>{" "}
                    <span className="text-gray-500">{r.entity_type}</span>
                    <div className="mt-0.5 text-xs text-gray-400">{r.action}</div>
                  </Td>
                  <Td className="text-xs">
                    {diff.changes.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {diff.changes.map((c) => (
                          <li key={c.field}>
                            <span className="font-medium text-gray-700">
                              {c.field}
                            </span>
                            :{" "}
                            {diff.kind === "created" ? (
                              <span className="text-green-700">
                                {formatAuditValue(c.to)}
                              </span>
                            ) : diff.kind === "deleted" ? (
                              <span className="text-red-700 line-through">
                                {formatAuditValue(c.from)}
                              </span>
                            ) : (
                              <>
                                <span className="text-red-700 line-through">
                                  {formatAuditValue(c.from)}
                                </span>{" "}
                                <span className="text-gray-400">→</span>{" "}
                                <span className="text-green-700">
                                  {formatAuditValue(c.to)}
                                </span>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>
                </Tr>
              );
            })
          )}
        </Tbody>
      </Table>
    </div>
  );
}
