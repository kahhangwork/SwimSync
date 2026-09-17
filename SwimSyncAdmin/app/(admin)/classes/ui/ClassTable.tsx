import { Pencil, CalendarPlus, CalendarX, Users, Archive, RotateCcw } from "lucide-react";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { toSgDate, formatSgDate } from "@/lib/lessonDates";
import { formatTime } from "@/lib/utils";
import { formatStudentCount, describeStudentCount, type buildClassRoster } from "@/lib/classRoster";
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
    key: "title",
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
        <Th sort={sort} sortKey="price_per_lesson" firstDir="desc">Rate</Th>
        <Th sort={sort} sortKey="student_count" firstDir="desc">Students</Th>
        <Th>Actions</Th>
      </Thead>
      <Tbody>
        {loading ? (
          <Tr>
            <Td className="text-center text-gray-400 py-8" colSpan={8}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="text-center text-gray-400 py-8" colSpan={8}>
              No classes found.
            </Td>
          </Tr>
        ) : (
          visible.map((cls) => (
            <Tr key={cls.id}>
              <Td className="font-medium text-gray-900">
                <span
                  aria-hidden
                  className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${colourFor(cls.colour).dot}`}
                  title={colourFor(cls.colour).label}
                />
                {cls.title}
                {!cls.is_active && (
                  <span
                    className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 align-middle"
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
                  </span>
                )}
              </Td>
              <Td className="text-gray-600">{cls.coach_name}</Td>
              <Td>{capitalize(cls.day_of_week)}</Td>
              <Td className="text-gray-500">
                {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
              </Td>
              <Td className="text-gray-500">{cls.location_name}</Td>
              <Td className="font-medium">
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
                  className="inline-flex items-center justify-center rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
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
                    className="ml-1 text-xs text-gray-500"
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSeeStudents(cls)}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    See students
                  </button>
                  <button
                    onClick={() => onEdit(cls)}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  {/* NOT offered on a retired class. schedule_extra_lesson()
                      has no is_active guard of its own, so this would write a
                      lesson_sessions row on a class the coach's class list and
                      Schedule tab both filter out: a lesson that exists, can
                      never be marked, and can never bill. It would not even
                      block the month — the engine bails on an empty billable
                      set — so it fails silently in both directions. Hiding the
                      button is the UI half; §7.32 says a limit only the admin
                      screen applies is not a limit, and the server-side half
                      is filed rather than fixed here. Restore first. */}
                  {cls.is_active && (
                    <button
                      onClick={() => onExtra(cls)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      title="Schedule a lesson on a day this class does not normally run"
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                      Extra lesson
                    </button>
                  )}
                  {cls.is_active && (
                    <button
                      onClick={() => onCancel(cls)}
                      data-testid="cancel-lesson-entry"
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      title="Call off one upcoming lesson of this class — parents see it struck out"
                    >
                      <CalendarX className="h-3.5 w-3.5 shrink-0" />
                      Cancel a lesson
                    </button>
                  )}
                  {cls.is_active ? (
                    <button
                      onClick={() => onRetire(cls)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      title="Stop scheduling this class. Lessons it already taught still bill."
                    >
                      <Archive className="h-3.5 w-3.5 shrink-0" />
                      Retire
                    </button>
                  ) : (
                    // No confirm on the way back. This is the exit from a
                    // class that can block a billing month while being
                    // invisible to every other screen.
                    <button
                      onClick={() => onRestore(cls)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
                      title="Put this class back on the schedule"
                    >
                      <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                      {restoringId === cls.id ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </div>
              </Td>
            </Tr>
          ))
        )}
      </Tbody>
    </Table>
  );
}
