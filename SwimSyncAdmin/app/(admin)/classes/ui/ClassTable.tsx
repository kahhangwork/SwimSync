import { Button } from "@/components/Button";
import { Tag } from "@/components/ui/Tag";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { Users, RotateCcw } from "lucide-react";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { toSgDate, formatSgDate } from "@/lib/lessonDates";
import { formatTime } from "@/lib/utils";
import { formatStudentCount, describeStudentCount, type buildClassRoster } from "../domain/classRoster";
import { colourFor } from "@/lib/classColours";
import { capitalize, classSortAccessors } from "../domain/classRows";
import type { ClassRow } from "../types";

type RosterByClass = Map<string, ReturnType<typeof buildClassRoster>>;

export function ClassTable({
  filtered,
  loading,
  rosterByClass,
  restoringId,
  onSeeStudents,
  onEdit,
  onExtra,
  onCancel,
  onRetire,
  onRestore,
}: {
  filtered: ClassRow[];
  loading: boolean;
  rosterByClass: RosterByClass;
  restoringId: string | null;
  onSeeStudents: (cls: ClassRow) => void;
  onEdit: (cls: ClassRow) => void;
  onExtra: (cls: ClassRow) => void;
  onCancel: (cls: ClassRow) => void;
  onRetire: (cls: ClassRow) => void;
  onRestore: (cls: ClassRow) => void;
}) {
  const sort = useTableSort<ClassRow>({
    // Time of day first; the sort is stable, so classes at the same time keep
    // the repo's day_of_week order (Sun→Sat).
    key: "start_time",
    accessors: classSortAccessors,
  });
  const visible = sort.apply(filtered);

  return (
    <Table>
      <Thead>
        <Th sort={sort} sortKey="title">Class Name</Th>
        <Th sort={sort} sortKey="coach_name">Coach</Th>
        <Th sort={sort} sortKey="day_of_week">Day</Th>
        <Th sort={sort} sortKey="start_time">Time</Th>
        <Th sort={sort} sortKey="location_name">Location</Th>
        <Th sort={sort} sortKey="price_per_lesson" firstDir="desc" className="text-right">Rate</Th>
        <Th sort={sort} sortKey="student_count" firstDir="desc">Students</Th>
        <Th>Actions</Th>
      </Thead>
      <Tbody>
        {loading ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={8}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={8}>
              No classes found.
            </Td>
          </Tr>
        ) : (
          visible.map((cls) => (
            <Tr key={cls.id}>
              <Td className="font-medium text-ink">
                <span
                  aria-hidden
                  className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${colourFor(cls.colour).dot}`}
                  title={colourFor(cls.colour).label}
                />
                {cls.title}
                {!cls.is_active && (
                  <Tag
                    tone="neutral"
                    className="ml-2 align-middle"
                    title={
                      cls.deactivated_at
                        // toSgDate takes the ISO string and converts in SGT.
                        // new Date(...).toISOString().split("T")[0] here would
                        // be the UTC date — a day early before 08:00 (§7.7).
                        ? `Retired on ${formatSgDate(toSgDate(cls.deactivated_at), {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}`
                        : "Retired before SwimSync recorded retirement dates"
                    }
                  >
                    Retired
                  </Tag>
                )}
              </Td>
              <Td className="text-ink-secondary">{cls.coach_name}</Td>
              <Td>{capitalize(cls.day_of_week)}</Td>
              <Td className="text-ink-muted">
                {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
              </Td>
              <Td className="text-ink-muted">{cls.location_name}</Td>
              <Td className="text-right font-medium tabular-nums text-ink">
                S${cls.price_per_lesson.toFixed(2)}
              </Td>
              <Td>
                {/* "2+1", never "3". The enrolled half comes from the class
                    query's own embed, so this number survives even if the
                    roster query failed; the "+1" is trials, and it is a
                    separate number because a guest at one lesson is not a
                    weekly student (PRD §7.17). */}
                <button
                  onClick={() => onSeeStudents(cls)}
                  title={describeStudentCount(
                    cls.student_count,
                    rosterByClass.get(cls.id)?.trials.length ?? 0
                  )}
                  className="inline-flex items-center justify-center rounded-tag px-1.5 py-0.5 text-body font-semibold tabular-nums text-primary underline-offset-2 hover:underline"
                >
                  {formatStudentCount(
                    cls.student_count,
                    rosterByClass.get(cls.id)?.trials.length ?? 0
                  )}
                </button>
                {/* "/ 6" = the class's own capacity, else its category's
                    default; nothing when both are unlimited. */}
                {(cls.capacity ?? cls.category_default_capacity) != null && (
                  <span
                    className="ml-1 text-label text-ink-muted"
                    title={
                      cls.capacity != null
                        ? "Maximum students for this class"
                        : "Maximum students (category default)"
                    }
                  >
                    / {cls.capacity ?? cls.category_default_capacity}
                  </span>
                )}
              </Td>
              <Td>
                {/* One inline action per row (DESIGN.md → Tables; UI restyle
                    5.10): See students — or Restore on a retired class, the
                    row's state action. Everything else is in the "…" menu. */}
                <div className="flex items-center gap-1.5">
                  {cls.is_active ? (
                    <Button size="sm" variant="outline" onClick={() => onSeeStudents(cls)} className="whitespace-nowrap">
                      <Users className="h-3.5 w-3.5 shrink-0" />
                      See students
                    </Button>
                  ) : (
                    // No confirm on the way back. This is the exit from a
                    // class that can block a billing month while being
                    // invisible to every other screen.
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRestore(cls)}
                      className="whitespace-nowrap"
                      title="Put this class back on the schedule"
                    >
                      <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                      {restoringId === cls.id ? "Restoring…" : "Restore"}
                    </Button>
                  )}
                  <RowMenu>
                    {!cls.is_active && (
                      <RowMenuItem onClick={() => onSeeStudents(cls)}>See students</RowMenuItem>
                    )}
                    <RowMenuItem onClick={() => onEdit(cls)}>Edit</RowMenuItem>
                    {/* NOT offered on a retired class. schedule_extra_lesson()
                        has no is_active guard of its own, so this would write a
                        lesson_sessions row on a class the coach's class list and
                        Schedule tab both filter out: a lesson that exists, can
                        never be marked, and can never bill. It would not even
                        block the month — the engine bails on an empty billable
                        set — so it fails silently in both directions. Hiding the
                        entry is the UI half; §7.32 says a limit only the admin
                        screen applies is not a limit, and the server-side half
                        is filed rather than fixed here. Restore first. */}
                    {cls.is_active && (
                      <RowMenuItem
                        onClick={() => onExtra(cls)}
                        title="Schedule a lesson on a day this class does not normally run"
                      >
                        Extra lesson
                      </RowMenuItem>
                    )}
                    {cls.is_active && (
                      <RowMenuItem
                        onClick={() => onCancel(cls)}
                        data-testid="cancel-lesson-entry"
                        title="Call off one upcoming lesson of this class — parents see it struck out"
                      >
                        Cancel a lesson
                      </RowMenuItem>
                    )}
                    {cls.is_active && (
                      <RowMenuItem
                        destructive
                        onClick={() => onRetire(cls)}
                        title="Stop scheduling this class. Lessons it already taught still bill."
                      >
                        Retire
                      </RowMenuItem>
                    )}
                  </RowMenu>
                </div>
              </Td>
            </Tr>
          ))
        )}
      </Tbody>
    </Table>
  );
}
