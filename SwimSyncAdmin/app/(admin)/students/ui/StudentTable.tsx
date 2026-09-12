// Slice 1 — the table itself. Stage 11 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx;
// the sort moved with the header row it drives.

import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { StatusBadge } from "@/components/StatusBadge";
import type { StudentCoverage } from "@/lib/packageCoverage";
import { isUnclaimed, statusLabel } from "../domain/studentRows";
import type { StudentRow } from "../types";
import { LevelSelect } from "./LevelSelect";
import { capitalizeDay } from "./dayLabel";

export type StudentTableProps = {
  /** Already filtered; sorted here. */
  students: StudentRow[];
  loading: boolean;
  levels: { id: string; label: string }[];
  savingLevelFor: string | null;
  onSetLevel: (s: StudentRow, levelId: string | null) => void;
  covMap: Map<string, StudentCoverage>;
  busyId: string | null;
  onActions: (s: StudentRow) => void;
};

export function StudentTable(p: StudentTableProps) {
  const sort = useTableSort<StudentRow>({
    key: "full_name",
    accessors: {
      // The badge, not the enum: what the Status column shows is
      // Assigned/Unassigned/Inactive, so that is what A→Z has to order.
      status: (s) => statusLabel(s),
      // An unclaimed child's cell reads "No parent account" rather than a name.
      // Sorting the literal text keeps those rows together — they are the ones
      // holding a billing month open, so grouping them is the useful behaviour.
      parent_name: (s) => (isUnclaimed(s) ? "No parent account" : s.parent_name),
    },
  });
  const visible = sort.apply(p.students);

  return (
    <Table>
      <Thead>
        <Th sort={sort} sortKey="full_name">Student</Th>
        <Th sort={sort} sortKey="level_label">Level</Th>
        <Th sort={sort} sortKey="parent_name">Parent</Th>
        <Th>Package</Th>
        <Th>Left</Th>
        <Th>Expires</Th>
        <Th sort={sort} sortKey="status">Status</Th>
        <Th sort={sort} sortKey="class_title">Class</Th>
        <Th sort={sort} sortKey="coach_name">Coach</Th>
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
              No students found.
            </Td>
          </Tr>
        ) : (
          visible.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium text-gray-900">{s.full_name}</Td>
              <Td>
                <LevelSelect
                  student={s}
                  levels={p.levels}
                  saving={p.savingLevelFor === s.id}
                  onChange={(levelId) => p.onSetLevel(s, levelId)}
                />
              </Td>
              <Td className="text-gray-500">
                {isUnclaimed(s) ? (
                  <span
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"
                    title="Added by a coach before this family registered. Their billable lessons cannot be invoiced until the parent has an account."
                  >
                    No parent account
                  </span>
                ) : (
                  s.parent_name
                )}
              </Td>
              {/* Package / Left / Expires — the coverage columns replace the
                  old Parent-cell chip (one truth per row). Amber when the
                  family is running low (SQL `low`); blank/"Ad-hoc" when the
                  child's class is not package-covered. */}
              {(() => {
                const cov = p.covMap.get(s.id);
                const adHoc = !cov || cov.coverage === "ad_hoc";
                const amber = cov?.low ? "text-amber-700 font-medium" : "text-gray-600";
                return (
                  <>
                    <Td className={adHoc ? "text-gray-400" : amber}>
                      {adHoc ? "Ad-hoc" : cov?.packageName ?? "Package"}
                    </Td>
                    <Td className={adHoc ? "text-gray-400" : amber}>
                      {adHoc || cov?.lessonsRemaining == null
                        ? "—"
                        : `${cov.lessonsRemaining} left`}
                    </Td>
                    <Td className="text-gray-500">
                      {adHoc || !cov?.expiresOn ? "—" : cov.expiresOn}
                    </Td>
                  </>
                );
              })()}
              <Td>
                <StatusBadge status={statusLabel(s)} />
              </Td>
              {/* VIEW-ONLY chips — one per class, showing that a child is in
                  more than one class. Adding a class and ending one both live
                  in the Actions drawer now. */}
              <Td className="text-gray-500">
                {s.classes.length === 0 ? (
                  "—"
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {s.classes.map((c) => (
                      <span
                        key={c.id}
                        title={`${c.title}${c.coach_name ? ` · ${c.coach_name}` : ""}`}
                        className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                      >
                        {c.day ? capitalizeDay(c.day) : c.title}
                        {c.start ? ` ${c.start}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </Td>
              <Td className="text-gray-500">
                {/* DISTINCT coaches. Two classes with the same coach must not
                    print the name twice. */}
                {[...new Set(s.classes.map((c) => c.coach_name).filter(Boolean))].join(
                  ", "
                ) || "—"}
              </Td>
              {/* One Actions button opens the right-hand Drawer. The
                  glance-and-set controls (Level dropdown, class chips + Add
                  class) stay inline in their own columns — Decision 10. */}
              <Td>
                <button
                  onClick={() => p.onActions(s)}
                  disabled={p.busyId === s.id}
                  className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Actions
                </button>
              </Td>
            </Tr>
          ))
        )}
      </Tbody>
    </Table>
  );
}
