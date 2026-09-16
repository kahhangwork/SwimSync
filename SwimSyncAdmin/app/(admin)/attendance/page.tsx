"use client";

// Attendance — read-only audit trail of every lesson record, with a make-up
// entry point from a missed lesson.
//
// Composition only (Admin L-B): all state + the DB-scoped loads + the money-axis
// attribution (RISK 6/7 cap checks) live in domain/useAttendance; the pure
// mappings/filters in domain/attendanceRows (characterised); the make-up gating
// helper in domain/makeupFromAttendance (moved from @/lib — sole importer); data
// in dao/attendance.repo; markup in ui/. See docs/refactor/BATCH_B_PLAN.md.

import { PageHeader } from "@/components/PageHeader";
import { useAttendance } from "./domain/useAttendance";
import { AttendanceFilters } from "./ui/AttendanceFilters";
import { AttendanceTable } from "./ui/AttendanceTable";
import { MakeupModal } from "./ui/MakeupModal";
import { ROW_LIMIT } from "./constants";

export default function AttendancePage() {
  const a = useAttendance();

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Read-only audit trail of all lesson records" />

      <AttendanceFilters
        search={a.search}
        coachFilter={a.coachFilter}
        classFilter={a.classFilter}
        statusFilter={a.statusFilter}
        dateFrom={a.dateFrom}
        dateTo={a.dateTo}
        coaches={a.coaches}
        classes={a.classes}
        anyFilter={a.anyFilter}
        exportDisabled={a.visible.length === 0}
        onSearch={a.setSearch}
        onCoach={a.setCoachFilter}
        onClass={a.setClassFilter}
        onStatus={a.setStatusFilter}
        onDateFrom={a.setDateFrom}
        onDateTo={a.setDateTo}
        onClear={a.clearFilters}
        onExport={a.handleExportCsv}
      />

      {a.exportNotice && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {a.exportNotice}
        </div>
      )}

      {a.mkSuccess && (
        <div className="mb-3 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <span className="flex-1">{a.mkSuccess}</span>
          <button onClick={() => a.setMkSuccess(null)} className="font-semibold text-green-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {a.loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the attendance records: {a.loadError}. The table below is
          incomplete — do not read it as the full trail.
        </div>
      )}

      {a.attribError && !a.loadError && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {a.attribError} The records below are complete, but the Coach column is
          shown as &ldquo;—&rdquo; rather than risk naming the wrong coach.
        </div>
      )}

      {!a.loading && !a.loadError && a.rows.length === ROW_LIMIT && (
        <p className="mb-3 text-sm text-amber-700">
          Showing the {ROW_LIMIT} most recent records. Narrow the date range to
          see earlier ones.
        </p>
      )}

      <AttendanceTable
        loading={a.loading}
        visible={a.visible}
        loadError={a.loadError}
        anyFilter={a.anyFilter}
        covMap={a.covMap}
        coachNameById={a.coachNameById}
        sort={a.sort}
        canBookMakeup={a.canBookMakeup}
        openMakeup={a.openMakeup}
      />

      <MakeupModal
        makeupRow={a.makeupRow}
        makeupHosts={a.makeupHosts}
        mkHost={a.mkHost}
        mkDate={a.mkDate}
        mkBusy={a.mkBusy}
        mkError={a.mkError}
        onClose={() => a.setMakeupRow(null)}
        onHost={a.setMkHost}
        onDate={a.setMkDate}
        datesFor={a.makeupDatesFor}
        onBook={a.handleBookMakeup}
      />
    </div>
  );
}
