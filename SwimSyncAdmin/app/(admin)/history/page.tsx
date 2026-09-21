"use client";

import { PageHeader } from "@/components/PageHeader";
import { ROW_LIMIT } from "./constants";
import { useHistory } from "./domain/useHistory";
import { HistoryFilters } from "./ui/HistoryFilters";
import { HistoryTable } from "./ui/HistoryTable";

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
export default function HistoryPage() {
  const h = useHistory();

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

      <HistoryFilters
        entityFilter={h.entityFilter}
        setEntityFilter={h.setEntityFilter}
        dateFrom={h.dateFrom}
        setDateFrom={h.setDateFrom}
        dateTo={h.dateTo}
        setDateTo={h.setDateTo}
        anyFilter={h.anyFilter}
        clearFilters={h.clearFilters}
      />

      {h.loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the history: {h.loadError}. The list below is incomplete —
          do not read it as the full trail.
        </div>
      )}

      {!h.loading && !h.loadError && h.rows.length === ROW_LIMIT && (
        <p className="mb-3 text-sm text-amber-700">
          Showing the {ROW_LIMIT} most recent changes. Narrow the date range or
          type to see earlier ones.
        </p>
      )}

      <HistoryTable
        rows={h.rows}
        loading={h.loading}
        anyFilter={h.anyFilter}
      />
    </div>
  );
}
