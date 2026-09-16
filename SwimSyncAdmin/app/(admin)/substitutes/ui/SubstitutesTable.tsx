import { Button } from "@/components/Button";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { formatSgDate } from "@/lib/lessonDates";
import type { LessonRoster } from "@/lib/sessionRoster";
import type { ClassRow, Coach } from "../domain/substituteRows";
import type { Picking } from "../domain/useSubstitutes";

type Props = {
  selected: ClassRow;
  coaches: Coach[];
  lessons: LessonRoster[];
  loading: boolean;
  loadError: string | null;
  busy: boolean;
  picking: Picking;
  pickedCoach: string;
  setPickedCoach: (id: string) => void;
  setPicking: (p: Picking) => void;
  openPicker: (date: string) => void;
  handleAssign: (date: string) => void;
  handleRemove: (rowId: string, what: string) => void;
};

export function SubstitutesTable({
  selected,
  coaches,
  lessons,
  loading,
  loadError,
  busy,
  picking,
  pickedCoach,
  setPickedCoach,
  setPicking,
  openPicker,
  handleAssign,
  handleRemove,
}: Props) {
  return (
    <Table>
      <Thead>
        <Th>Lesson</Th>
        <Th>Teaching</Th>
        <Th>Actions</Th>
      </Thead>
      <Tbody>
        {loading ? (
          <Tr>
            <Td className="py-8 text-center text-gray-400" colSpan={3}>
              Loading…
            </Td>
          </Tr>
        ) : lessons.length === 0 ? (
          <Tr>
            <Td className="py-8 text-center text-gray-400" colSpan={3}>
              {loadError
                ? "Could not load the lessons — see the error above."
                : "This class has no lessons in that month."}
            </Td>
          </Tr>
        ) : (
          lessons.map((lesson) => {
            const pickingHere = picking?.date === lesson.session_date;

            return (
              <Tr key={lesson.session_date}>
                <Td className="font-medium text-gray-900">
                  {formatSgDate(lesson.session_date)}
                  {lesson.off_pattern && (
                    <span className="ml-1.5 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                      Extra
                    </span>
                  )}
                </Td>

                <Td>
                  <span className="text-gray-900">{lesson.main.name}</span>
                  {lesson.main.is_cover ? (
                    <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Covering for {selected.coach_name}
                    </span>
                  ) : lesson.main.assigned ? (
                    <span className="ml-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      Assigned
                    </span>
                  ) : (
                    <span className="ml-1.5 text-xs text-gray-400">
                      class coach
                    </span>
                  )}
                </Td>

                <Td>
                  {pickingHere ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={pickedCoach}
                        onChange={(e) => setPickedCoach(e.target.value)}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                      >
                        <option value="">Who taught it?</option>
                        {/* Exclude the class's own coach: they teach it anyway,
                            so assigning them records no cover and the DB refuses
                            it (20260821000100). A substitute is a DIFFERENT coach. */}
                        {coaches
                          .filter((c) => c.id !== selected?.coach_id)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => handleAssign(lesson.session_date)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPicking(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openPicker(lesson.session_date)}
                        className="text-sm font-medium text-sky-600 underline"
                      >
                        {lesson.main.assigned ? "Change" : "Assign a substitute"}
                      </button>
                      {/* Only offered for an ASSIGNED main — there is
                          nothing to clear on a lesson whose teacher is the
                          class's coach by the absence rule. */}
                      {lesson.main.assigned && lesson.main.row_id && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleRemove(
                              lesson.main.row_id!,
                              `${formatSgDate(lesson.session_date)} is back with ${selected.coach_name}.`
                            )
                          }
                          className="text-sm font-medium text-gray-500 underline disabled:opacity-50"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </Td>
              </Tr>
            );
          })
        )}
      </Tbody>
    </Table>
  );
}
