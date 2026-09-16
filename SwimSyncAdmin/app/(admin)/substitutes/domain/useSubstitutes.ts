import { useEffect, useRef, useState } from "react";
import { todayInSg, formatSgDate, monthBounds } from "@/lib/lessonDates";
import {
  lessonDatesInMonth,
  buildLessonRosters,
  type LessonRoster,
  type LessonSessionRow,
  type SessionCoachRow,
} from "@/lib/sessionRoster";
import {
  assignSessionCoach,
  loadMonthSessions,
  loadPickerData,
  loadSessionCoaches,
  removeSessionCoach,
} from "../dao/substitutes.repo";
import { mapClasses, mapCoaches, type ClassRow, type Coach } from "./substituteRows";

/** Which row's picker is open. One at a time, like the rate editor. */
export type Picking = { date: string } | null;

// All Substitutes state, loads and writes. The generation counter (loadGen) and
// the loading gate are LOAD-BEARING — see the inline notes and the page header.
export function useSubstitutes() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [classId, setClassId] = useState("");
  // todayInSg(), never new Date().getMonth() (§7.7).
  const [month, setMonth] = useState(() => todayInSg().slice(0, 7));

  const [lessons, setLessons] = useState<LessonRoster[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Kept SEPARATE from loadError: the two have different lifetimes, and the
  // lesson load clears its own.
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [picking, setPicking] = useState<Picking>(null);
  const [pickedCoach, setPickedCoach] = useState("");

  const selected = classes.find((c) => c.id === classId) ?? null;

  // The pickers load once — neither changes with the class or the month.
  useEffect(() => {
    async function loadPickers() {
      const { classRows, coachRows, error } = await loadPickerData();
      if (error) setPickerError(error);

      const mapped = mapClasses(classRows);
      setClasses(mapped);
      setClassId((prev) => prev || mapped.find((c) => c.is_active)?.id || "");
      setCoaches(mapCoaches(coachRows));
    }
    loadPickers();
  }, []);

  async function loadLessons(
    cls: ClassRow,
    forMonth: string,
    isStale: () => boolean = () => false
  ) {
    // monthBounds(), never `${forMonth}-31`.
    const { start, end } = monthBounds(forMonth);
    if (!start || !end) {
      setLessons([]);
      return;
    }

    const { data: sessionData, error: sessionErr } = await loadMonthSessions(cls.id, start, end);
    if (isStale()) return;
    if (sessionErr) {
      setLoadError(sessionErr);
      setLessons([]);
      return;
    }

    const sessions: LessonSessionRow[] = (sessionData ?? []).map((s) => ({
      id: s.id,
      session_date: s.session_date,
    }));

    let rosterRows: SessionCoachRow[] = [];
    if (sessions.length > 0) {
      const { data: rosterData, error: rosterErr } = await loadSessionCoaches(
        sessions.map((s) => s.id)
      );
      if (isStale()) return;
      if (rosterErr) {
        // A failed roster load must NOT fall through to the absence rule.
        setLoadError(rosterErr);
        setLessons([]);
        return;
      }
      rosterRows = rosterData ?? [];
    }

    setLoadError(null);
    setLessons(
      buildLessonRosters({
        dates: lessonDatesInMonth(cls.day_of_week, forMonth, sessions.map((s) => s.session_date)),
        dayOfWeek: cls.day_of_week,
        sessions,
        rosterRows,
        coachNames: new Map(coaches.map((c) => [c.id, c.name])),
        classCoachId: cls.coach_id,
        classCoachName: cls.coach_name,
      })
    );
  }

  // ⚠ ONE generation counter for EVERY load, the effect's and reload()'s alike.
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

    const error = await assignSessionCoach(selected.id, date, pickedCoach);
    if (error) {
      setBusy(false);
      setMessage(`Could not assign: ${error}`);
      return;
    }

    const who = coaches.find((c) => c.id === pickedCoach)?.name ?? "That coach";
    setPicking(null);
    setPickedCoach("");
    // Reload before releasing the buttons.
    await reload();
    setBusy(false);
    setMessage(
      `${who} is now teaching ${formatSgDate(date)}. This lesson has moved onto their marking list and off ${selected.coach_name}'s.`
    );
  }

  async function handleRemove(rowId: string, what: string) {
    setBusy(true);
    setMessage(null);
    const error = await removeSessionCoach(rowId);
    if (error) {
      setBusy(false);
      setMessage(`Could not remove: ${error}`);
      return;
    }
    await reload();
    setBusy(false);
    setMessage(what);
  }

  function openPicker(date: string) {
    setPicking({ date });
    setPickedCoach("");
    setMessage(null);
  }

  function selectClass(id: string) {
    setClassId(id);
    setPicking(null);
    setMessage(null);
  }

  function selectMonth(m: string) {
    setMonth(m);
    setPicking(null);
    setMessage(null);
  }

  return {
    classes,
    coaches,
    classId,
    month,
    lessons,
    loading,
    loadError,
    pickerError,
    message,
    busy,
    picking,
    pickedCoach,
    selected,
    setPickedCoach,
    setPicking,
    selectClass,
    selectMonth,
    openPicker,
    handleAssign,
    handleRemove,
  };
}

export type SubstitutesState = ReturnType<typeof useSubstitutes>;
