import { Tag } from "@/components/ui/Tag";
import { Button } from "@/components/Button";
import { formatSgDate } from "@/lib/lessonDates";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, type useTableSort } from "@/components/Table";
import { PackageChip } from "@/components/PackageChip";
import type { StudentCoverage } from "@/lib/packageCoverage";
import { STATUS_LABELS } from "../constants";
import type { AttendanceRow } from "../types";

type Props = {
  loading: boolean;
  visible: AttendanceRow[];
  loadError: string | null;
  anyFilter: boolean;
  covMap: Map<string, StudentCoverage>;
  coachNameById: Map<string, string>;
  sort: ReturnType<typeof useTableSort<AttendanceRow>>;
  canBookMakeup: (a: AttendanceRow) => boolean;
  openMakeup: (a: AttendanceRow) => void;
};

export function AttendanceTable({
  loading,
  visible,
  loadError,
  anyFilter,
  covMap,
  coachNameById,
  sort,
  canBookMakeup,
  openMakeup,
}: Props) {
  return (
    <Table>
      <Thead>
        <Th sort={sort} sortKey="student_name">Student</Th>
        <Th sort={sort} sortKey="class_title">Class</Th>
        <Th sort={sort} sortKey="coach_name">Coach</Th>
        <Th sort={sort} sortKey="session_date" firstDir="desc">Date</Th>
        <Th sort={sort} sortKey="status">Status</Th>
        <Th>Actions</Th>
      </Thead>
      <Tbody>
        {loading ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={6}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={6}>
              {loadError
                ? "Could not load the records — see the error above."
                : anyFilter
                ? "No records match these filters."
                : "No records found."}
            </Td>
          </Tr>
        ) : (
          visible.map((a) => (
            <Tr key={a.id}>
              <Td className="font-medium text-ink">
                {a.student_name}
                <span className="ml-1.5">
                  <PackageChip coverage={covMap.get(a.student_id)} />
                </span>
              </Td>
              <Td className="text-ink-secondary">{a.class_title}</Td>
              <Td className="text-ink-muted">
                {a.main_coach_id ? (
                  <>
                    {coachNameById.get(a.main_coach_id) ?? "Unknown coach"}
                    {a.is_cover && (
                      <Tag tone="info" className="ml-1.5">
                        Cover
                      </Tag>
                    )}
                    {a.shadow_coach_ids.length > 0 && (
                      <div className="mt-0.5 text-label text-ink-muted">
                        {a.shadow_coach_ids
                          .map((id) => `+ ${coachNameById.get(id) ?? "Unknown coach"} (shadow)`)
                          .join(", ")}
                      </div>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </Td>
              {/* DISPLAY only (S9): session_date stays the YYYY-MM-DD the sort reads. */}
              <Td className="text-ink-muted">
                {formatSgDate(a.session_date, { day: "numeric", month: "short", year: "numeric" })}
              </Td>
              <Td>
                <StatusBadge status={STATUS_LABELS[a.status] ?? a.status} />
              </Td>
              <Td>
                {canBookMakeup(a) && (
                  <Button size="sm" variant="outline" onClick={() => openMakeup(a)}>
                    Book make-up
                  </Button>
                )}
              </Td>
            </Tr>
          ))
        )}
      </Tbody>
    </Table>
  );
}
