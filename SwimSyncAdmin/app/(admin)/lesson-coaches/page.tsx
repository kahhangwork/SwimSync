"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import {
  todayInSg,
  formatSgDate,
  monthBounds,
  type DayOfWeek,
} from "@/lib/lessonDates";
import {
  lessonDatesInMonth,
  buildLessonRosters,
  type LessonRoster,
  type SessionCoachRow,
  type LessonSessionRow,
} from "@/lib/sessionRoster";

/**
 * Lesson Coaches — who taught one lesson, when it was not the class's coach.
 *
 * A permanent handover already works: set_class_terms() moves classes.coach_id
 * and writes a class_rates row. What had no representation at all was the
 * ONE-OFF cover, and a business that cannot record one either pays the wrong
 * coach or keeps the truth in WhatsApp.
 *
 * THREE THINGS ON THIS SCREEN ARE LOAD-BEARING, and each of them is a rule from
 * the migration rather than a UI preference:
 *
 * 1. THE MAIN COACH IS ALWAYS WRITTEN THROUGH assign_session_coach(). Never an
 *    insert, never an upsert. one_main_coach_per_session is a PARTIAL unique
 *    index and PostgREST's .upsert() cannot target one, so "that cover was
 *    wrong, it was Coach C" would arrive as a plain INSERT and come back as a
 *    raw 23505 in the admin's face. The RPC deletes-then-inserts inside one
 *    function. (Plan RISK 10.)
 *
 * 2. THIS SCREEN NEVER HANDLES A lesson_session_id WHEN WRITING. lesson_sessions
 *    rows are created LAZILY by the coach at first attendance save (PRD §7.5),
 *    so a FUTURE lesson — the only kind anyone arranges cover for — has no id.
 *    assign_session_coach() takes (class, DATE, coach, role) and resolves-or-
 *    creates. Reading is a different matter: a roster row that already exists is
 *    deleted by its own id, which it necessarily has.
 *
 * 3. SHADOWS ARE NOT HERE ANY MORE. A shadow is a dated assignment to the whole
 *    CLASS (`class_shadow_coaches`, 20260812000200), managed on the Classes
 *    page. This screen is substitutes only, and `session_coaches` holds at most
 *    one row per lesson because of it. The contradictory state the old model
 *    allowed — the class's own coach holding a shadow row on a main-less lesson,
 *    unmarkable AND un-nagged — is now unbuildable rather than guarded.
 *
 * 4. ASSIGNING A COVER MOVES THE LESSON OFF THE CLASS COACH'S MARKING LIST.
 *    attendance_write narrows to the roster main, so the class's own coach loses
 *    write on that one lesson — intended, and the point of "pay follows whoever
 *    actually taught". It is stated on screen because unmarked attendance blocks
 *    the billing month with NO override (§8i), and an admin who does not know
 *    the lesson moved cannot tell anyone to go and mark it.
 */

type ClassRow = {
  id: string;
  title: string;
  day_of_week: DayOfWeek;
  coach_id: string;
  coach_name: string;
  is_active: boolean;
};

type Coach = { id: string; name: string };

/** Which row's picker is open. One at a time, like the rate editor. */
type Picking = { date: string } | null;

export default function LessonCoachesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [classId, setClassId] = useState("");
  // todayInSg(), never new Date().getMonth(). The device's zone is not the
  // business's, and on 1 August a UTC-derived answer is still July (§7.7).
  const [month, setMonth] = useState(() => todayInSg().slice(0, 7));

  const [lessons, setLessons] = useState<LessonRoster[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Kept SEPARATE from `loadError`, because the two have different lifetimes
   * and the lesson load clears its own. Folded together, a failed `coaches`
   * query set the banner, the lessons then loaded fine and cleared it, and the
   * page settled into: every assigned main rendering "Unknown coach", every
   * picker empty, and nothing on screen saying why.
   */
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [picking, setPicking] = useState<Picking>(null);
  const [pickedCoach, setPickedCoach] = useState("");

  const selected = classes.find((c) => c.id === classId) ?? null;

  // The pickers load once — neither changes with the class or the month.
  useEffect(() => {
    async function loadPickers() {
      const [{ data: classData, error: classErr }, { data: coachData, error: coachErr }] =
        await Promise.all([
          // Inactive classes included and labelled, for the same reason the
          // Attendance page includes them: a cover on a class that has since
          // been retired is still a fact about a month somebody has to pay.
          supabase
            .from("classes")
            .select("id, title, day_of_week, is_active, coach_id, coaches(id, profiles(full_name))")
            .order("title"),
          supabase.from("coaches").select("id, profiles(full_name)"),
        ]);

      // Surfaced, not swallowed: an empty class dropdown reads as "this business
      // has no classes", which is the most reassuring possible rendering of a
      // failed query.
      if (classErr || coachErr) setPickerError((classErr ?? coachErr)!.message);

      const mapped: ClassRow[] = (classData ?? []).map((c: any) => {
        const coach = Array.isArray(c.coaches) ? c.coaches[0] : c.coaches;
        const prof = Array.isArray(coach?.profiles) ? coach.profiles[0] : coach?.profiles;
        return {
          id: c.id,
          title: c.title,
          day_of_week: c.day_of_week,
          coach_id: c.coach_id,
          coach_name: prof?.full_name ?? "Unknown coach",
          is_active: c.is_active,
        };
      });
      setClasses(mapped);
      setClassId((prev) => prev || mapped.find((c) => c.is_active)?.id || "");

      setCoaches(
        (coachData ?? []).map((c: any) => {
          const prof = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
          return { id: c.id, name: prof?.full_name ?? "Unknown coach" };
        })
      );
    }

    loadPickers();
  }, []);

  /**
   * `isStale` is how a superseded load declines to publish its result. Changing
   * the class and then the month fires two loads, and without this the slower
   * can resolve last and win — leaving the table describing a month the controls
   * no longer show, and looking entirely settled while it does.
   */
  async function loadLessons(
    cls: ClassRow,
    forMonth: string,
    isStale: () => boolean = () => false
  ) {
    // monthBounds(), never `${forMonth}-31` — February has no 31st, and
    // Postgres rejects the literal outright rather than clamping it, so the
    // whole month's lessons vanish behind an error two months in twelve.
    const { start, end } = monthBounds(forMonth);
    if (!start || !end) {
      setLessons([]);
      return;
    }

    // The month's existing rows come first, because they are the only source of
    // an EXTRA or rescheduled lesson — one that is off-pattern by design and
    // that lessonDatesInMonth() cannot derive.
    const { data: sessionData, error: sessionErr } = await supabase
      .from("lesson_sessions")
      .select("id, session_date")
      .eq("class_id", cls.id)
      .gte("session_date", start)
      .lte("session_date", end);

    if (isStale()) return;

    if (sessionErr) {
      setLoadError(sessionErr.message);
      setLessons([]);
      return;
    }

    const sessions: LessonSessionRow[] = (sessionData ?? []).map((s: any) => ({
      id: s.id,
      session_date: s.session_date,
    }));

    let rosterRows: SessionCoachRow[] = [];
    if (sessions.length > 0) {
      const { data: rosterData, error: rosterErr } = await supabase
        .from("session_coaches")
        .select("id, lesson_session_id, coach_id")
        .in("lesson_session_id", sessions.map((s) => s.id));

      if (isStale()) return;

      if (rosterErr) {
        // A failed roster load must NOT fall through to the absence rule. That
        // would render every covered lesson as taught by the class's coach —
        // wrong, and indistinguishable from the truth.
        setLoadError(rosterErr.message);
        setLessons([]);
        return;
      }
      rosterRows = (rosterData ?? []) as SessionCoachRow[];
    }

    setLoadError(null);
    setLessons(
      buildLessonRosters({
        dates: lessonDatesInMonth(
          cls.day_of_week,
          forMonth,
          sessions.map((s) => s.session_date)
        ),
        dayOfWeek: cls.day_of_week,
        sessions,
        rosterRows,
        coachNames: new Map(coaches.map((c) => [c.id, c.name])),
        classCoachId: cls.coach_id,
        classCoachName: cls.coach_name,
      })
    );
  }

  /**
   * ⚠ ONE generation counter for EVERY load, the effect's and reload()'s alike.
   *
   * A per-effect `let cancelled` covers only the effect. `reload()` runs after
   * a write, outside any effect, and an unguarded one is worse than a stale
   * table: it repaints class X's dates while `selected` has moved on to class
   * Y, and the next assignment then calls
   * assign_session_coach(Y, <X's date>, …). Two classes on the same weekday —
   * one coach, one day, two times, the ordinary case — both pass
   * assert_class_runs_on, so the cover lands silently on the wrong class and
   * the wrong coach gets paid.
   */
  const loadGen = useRef(0);

  useEffect(() => {
    if (!selected || !month) {
      loadGen.current++; // supersede anything in flight
      setLessons([]);
      return;
    }

    const gen = ++loadGen.current;
    setLoading(true);
    loadLessons(selected, month, () => gen !== loadGen.current).finally(() => {
      if (gen === loadGen.current) setLoading(false);
    });

    return () => {
      loadGen.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, month, coaches.length]);

  async function reload() {
    if (!selected) return;
    const gen = ++loadGen.current;
    // Loading, not just stale-guarded: the rows stay clickable otherwise, and a
    // click on a row that is about to be replaced is the whole hazard above.
    setLoading(true);
    await loadLessons(selected, month, () => gen !== loadGen.current);
    if (gen === loadGen.current) setLoading(false);
  }

  async function handleAssign(date: string) {
    if (!selected || !pickedCoach) {
      setMessage("Choose a coach first.");
      return;
    }

    setBusy(true);
    setMessage(null);

    // Still through the RPC, and rule 2 above is why: a FUTURE lesson — the only
    // kind anyone arranges cover for — has no lesson_sessions row for a direct
    // insert to reference. assign_session_coach() resolves-or-creates.
    const { error } = await supabase.rpc("assign_session_coach", {
      p_class_id: selected.id,
      p_session_date: date,
      p_coach_id: pickedCoach,
    });

    if (error) {
      setBusy(false);
      setMessage(`Could not assign: ${error.message}`);
      return;
    }

    const who = coaches.find((c) => c.id === pickedCoach)?.name ?? "That coach";
    const isCover = pickedCoach !== selected.coach_id;
    setPicking(null);
    setPickedCoach("");
    // Reload before releasing the buttons: re-enabling them mid-refetch lets a
    // second assignment fire against rows that are about to be replaced.
    await reload();
    setBusy(false);
    setMessage(
      isCover
        ? `${who} is now teaching ${formatSgDate(date)}. This lesson has moved onto their marking list and off ${selected.coach_name}'s.`
        : // Pinning the class's own coach is not a cover, and saying it moved
          // "off Coach A's list" when A is the one assigned reads as a bug.
          `${who} is pinned to ${formatSgDate(date)} — they already teach this class, so nothing has moved.`
    );
  }

  async function handleRemove(rowId: string, what: string) {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.from("session_coaches").delete().eq("id", rowId);
    if (error) {
      setBusy(false);
      setMessage(`Could not remove: ${error.message}`);
      return;
    }
    await reload();
    setBusy(false);
    setMessage(what);
  }

  const inputClass =
    "rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400";

  function openPicker(date: string) {
    setPicking({ date });
    setPickedCoach("");
    setMessage(null);
  }

  return (
    <div>
      <PageHeader
        title="Lesson Coaches"
        subtitle="Who is teaching each lesson — assign a substitute when the class's coach is away"
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Class
          <select
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setPicking(null);
              setMessage(null);
            }}
            className={inputClass}
          >
            <option value="">Choose a class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.is_active ? c.title : `${c.title} (retired)`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setPicking(null);
              setMessage(null);
            }}
            className={inputClass}
          />
        </label>
      </div>

      <p className="mb-4 max-w-3xl text-xs text-gray-500">
        A lesson with no assignment is taught by the class&rsquo;s own coach —
        that is the normal state, and nothing needs recording for it. Assigning
        a substitute moves that <strong>one</strong> lesson onto their list: they
        mark the attendance and are paid their own rate, and the class&rsquo;s
        coach is paid nothing for it. A shadow sees the lesson and is paid their
        own rate as well, but never marks it.
      </p>

      {pickerError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the classes and coaches: {pickerError}. Names may show
          as &ldquo;Unknown coach&rdquo; and the pickers may be empty — reload
          before assigning anybody.
        </div>
      )}

      {loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the roster: {loadError}. The lessons below are
          incomplete — do not read an empty row as &ldquo;no substitute&rdquo;.
        </div>
      )}

      {message && (
        <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {message}
        </div>
      )}

      {!selected ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          Choose a class to see its lessons.
        </div>
      ) : (
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
                            {coaches.map((c) => (
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
      )}
    </div>
  );
}
