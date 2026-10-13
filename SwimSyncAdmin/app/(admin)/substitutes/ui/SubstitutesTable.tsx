import { Tag } from "@/components/ui/Tag";
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
            <Td className="py-8 text-center text-ink-muted" colSpan={3}>
              Loading…
            </Td>
          </Tr>
        ) : lessons.length === 0 ? (
          <Tr>
            <Td className="py-8 text-center text-ink-muted" colSpan={3}>
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
                <Td className="font-medium text-ink">
                  {formatSgDate(lesson.session_date)}
                  {lesson.off_pattern && (
                    <Tag tone="neutral" className="ml-1.5">
                      Extra
                    </Tag>
                  )}
                </Td>

                <Td>
                  <span className="text-ink">{lesson.main.name}</span>
                  {lesson.main.is_cover ? (
                    <Tag tone="info" className="ml-1.5">
                      Covering for {selected.coach_name}
                    </Tag>
                  ) : lesson.main.assigned ? (
                    <Tag tone="neutral" className="ml-1.5">
                      Assigned
                    </Tag>
                  ) : (
                    <span className="ml-1.5 text-label text-ink-muted">
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
                        className="rounded-control border border-border-strong px-2 py-1 text-body"
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
                        className="text-body font-medium text-primary underline"
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
                          className="text-body font-medium text-ink-muted underline disabled:opacity-50"
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
