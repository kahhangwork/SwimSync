// Slice 1 — the table itself. Stage 11 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx;
// the sort moved with the header row it drives.

import { Tag } from "@/components/ui/Tag";
import { Button } from "@/components/Button";
import { formatSgStamp } from "@/lib/lessonDates";
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
  /** The selected pill — an empty list under anything but All says so. */
  statusFilter: string;
};

export function StudentTable(p: StudentTableProps) {
  const sort = useTableSort<StudentRow>({
    // Opens in class order — weekday, start time, name (`classSortKey`). Plain
    // state: every visit starts here again (user, 2026-10-16).
    key: "class_sort_key",
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
        <Th sort={sort} sortKey="class_sort_key">Class</Th>
        <Th sort={sort} sortKey="coach_name">Coach</Th>
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
              No students found.
              {/* The list opens on Active, so a missing child is usually an
                  inactive one — say which filter hid them. */}
              {p.statusFilter !== "All" && ` Showing ${p.statusFilter} only — try All.`}
            </Td>
          </Tr>
        ) : (
          visible.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium text-ink">{s.full_name}</Td>
              <Td>
                <LevelSelect
                  student={s}
                  levels={p.levels}
                  saving={p.savingLevelFor === s.id}
                  onChange={(levelId) => p.onSetLevel(s, levelId)}
                />
              </Td>
              <Td className="text-ink-muted">
                {isUnclaimed(s) ? (
                  <Tag
                    tone="warning"
                    title="Added by a coach before this family registered. Their billable lessons cannot be invoiced until the parent has an account."
                  >
                    No parent account
                  </Tag>
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
                const amber = cov?.low ? "text-status-warning-text font-medium" : "text-ink-secondary";
                return (
                  <>
                    <Td className={adHoc ? "text-ink-muted" : amber}>
                      {adHoc ? "Ad-hoc" : cov?.packageName ?? "Package"}
                    </Td>
                    <Td className={adHoc ? "text-ink-muted" : amber}>
                      {adHoc || cov?.lessonsRemaining == null
                        ? "—"
                        : `${cov.lessonsRemaining} left`}
                    </Td>
                    <Td className="text-ink-muted">
                      {adHoc || !cov?.expiresOn
                        ? "—"
                        : formatSgStamp(cov.expiresOn, { day: "numeric", month: "short", year: "numeric" })}
                    </Td>
                  </>
                );
              })()}
              <Td>
                {/* Tag only what is not routine (BACKLOG fold-in): an Assigned
                    child is the normal case — a plain word, not a green tag that
                    says nothing (and said "Assigned" on children with no class). */}
                {statusLabel(s) === "Assigned" ? (
                  <span className="text-ink-secondary">Assigned</span>
                ) : (
                  <StatusBadge status={statusLabel(s)} />
                )}
              </Td>
              {/* VIEW-ONLY chips — one per class, showing that a child is in
                  more than one class. Adding a class and ending one both live
                  in the Actions drawer now. */}
              <Td className="text-ink-muted">
                {s.classes.length === 0 ? (
                  "—"
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {s.classes.map((c) => (
                      <span
                        key={c.id}
                        title={`${c.title}${c.coach_name ? ` · ${c.coach_name}` : ""}`}
                        className="inline-flex items-center rounded-tag border border-border bg-ground px-1.5 py-0.5 text-label text-ink-secondary"
                      >
                        {c.day ? capitalizeDay(c.day) : c.title}
                        {c.start ? ` ${c.start}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </Td>
              <Td className="text-ink-muted">
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
                <Button size="sm" variant="outline" onClick={() => p.onActions(s)} disabled={p.busyId === s.id}>
                  Actions
                </Button>
              </Td>
            </Tr>
          ))
        )}
      </Tbody>
    </Table>
  );
}
