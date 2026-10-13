"use client";

// Holidays — public-holiday dates, and voiding a day's lessons so nobody is
// charged and every covering package extends by holiday_extension_days.
//
// Composition only (Admin L-B): state + loads + writes in domain/useHolidays,
// the void-count tally + ext-days clamp in domain/holidayRows, the CSV parser in
// domain/holidaysCsv (moved from @/lib — sole importer), data in
// dao/holidays.repo, markup in ui/. See docs/refactor/BATCH_B_PLAN.md.

import { PageHeader } from "@/components/PageHeader";
import { useHolidays } from "./domain/useHolidays";
import { HolidaysActions } from "./ui/HolidaysActions";
import { HolidaysTable } from "./ui/HolidaysTable";
import { AddHolidayModal } from "./ui/AddHolidayModal";

const DATA_GOV_SG_URL =
  "https://data.gov.sg/datasets?query=public+holidays&resultId=d_3751791452397f1b1c80c451447e40b7";

export default function HolidaysPage() {
  const h = useHolidays();

  return (
    <div>
      <PageHeader
        title="Holidays"
        subtitle={`${h.holidays.length} public holiday${
          h.holidays.length === 1 ? "" : "s"
        } — void a day's lessons to skip charges and extend packages`}
        action={
          <HolidaysActions
            fileInput={h.fileInput}
            busy={h.busy}
            onCsvChosen={h.onCsvChosen}
            onAdd={h.openAddModal}
          />
        }
      />

      <p className="mb-4 text-body text-ink-muted">
        Import Singapore&rsquo;s public holidays as a CSV from{" "}
        <a href={DATA_GOV_SG_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline">
          data.gov.sg
        </a>{" "}
        (columns <span className="font-mono text-label">date, day, holiday</span>),
        or add dates by hand — including your own closures.
      </p>

      <div className="mb-4 flex items-center gap-2 rounded-control bg-ground px-3 py-2 text-body text-ink-secondary">
        <label htmlFor="ext-days">A voided holiday extends each affected package by</label>
        <input
          id="ext-days"
          type="number"
          min={0}
          max={90}
          value={h.extDays}
          onChange={(e) => h.setExtDays(Number(e.target.value))}
          onBlur={(e) => h.saveExtDays(Number(e.target.value))}
          className="w-16 rounded-control border border-border-strong px-2 py-1 text-body"
        />
        <span>day{h.extDays === 1 ? "" : "s"}.</span>
      </div>

      {h.voidMsg && (
        <p className="mb-4 rounded-card bg-status-success-bg px-3 py-2 text-body text-status-success-text">{h.voidMsg}</p>
      )}

      {h.error && (
        <p className="mb-4 rounded-card bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">{h.error}</p>
      )}

      {h.importResult && (
        <div className="mb-4 rounded-control bg-ground px-3 py-2 text-body">
          <p className="font-medium text-ink">
            Imported {h.importResult.added} holiday{h.importResult.added === 1 ? "" : "s"}.
          </p>
          {h.importResult.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-status-warning-text">
              {h.importResult.errors.slice(0, 8).map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
              {h.importResult.errors.length > 8 && (
                <li>…and {h.importResult.errors.length - 8} more.</li>
              )}
            </ul>
          )}
        </div>
      )}

      <HolidaysTable
        holidays={h.holidays}
        voidCounts={h.voidCounts}
        loading={h.loading}
        busy={h.busy}
        onVoid={h.voidDay}
        onUnvoid={h.unvoidDay}
        onRemove={h.removeHoliday}
      />

      <AddHolidayModal
        open={h.addModal}
        newDate={h.newDate}
        newName={h.newName}
        formError={h.formError}
        busy={h.busy}
        onClose={() => h.setAddModal(false)}
        onDate={h.setNewDate}
        onName={h.setNewName}
        onAdd={h.addHoliday}
      />
    </div>
  );
}
