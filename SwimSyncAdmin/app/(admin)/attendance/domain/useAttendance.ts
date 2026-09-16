import { useEffect, useState } from "react";
import { exportCsv, type CsvColumn } from "@/lib/csv";
import { todayInSg, expectedLessonDates } from "@/lib/lessonDates";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import { attributeLessons, type LessonAttribution } from "@/lib/lessonAttribution";
import { useTableSort } from "@/components/Table";
import { useDebouncedValue } from "@/components/useDebouncedValue";
import {
  bookMakeup,
  loadAttendanceRows,
  loadAttributionInputs,
  loadFilterOptions,
  loadMakeupData,
  loadPackageCoverage,
  loadShadowAbsences,
} from "../dao/attendance.repo";
import {
  applyAttribution,
  buildLessonRefs,
  filterRows,
  mapAttendanceRows,
  mapFilterClasses,
  mapFilterCoaches,
  mapMakeupData,
} from "./attendanceRows";
import { canBookMakeupFromRow, makeupHostChoices } from "./makeupFromAttendance";
import { STATUS_LABELS, ROW_LIMIT } from "../constants";
import type { AttendanceRow, MakeupClass } from "../types";

// All Attendance state, loads (range applied in the DB), money-axis attribution
// and the make-up entry point. The `cancelled` guard and the attribution cap
// checks are LOAD-BEARING — see the inline notes.
export function useAttendance() {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [coaches, setCoaches] = useState<{ id: string; full_name: string }[]>([]);
  const [classes, setClasses] = useState<{ id: string; label: string }[]>([]);
  const [makeupClasses, setMakeupClasses] = useState<MakeupClass[]>([]);
  const [enrolmentSet, setEnrolmentSet] = useState<Set<string>>(new Set());
  const [ownClassesByStudent, setOwnClassesByStudent] = useState<Map<string, Set<string>>>(new Map());
  const [makeupRow, setMakeupRow] = useState<AttendanceRow | null>(null);
  const [mkHost, setMkHost] = useState("");
  const [mkDate, setMkDate] = useState("");
  const [mkBusy, setMkBusy] = useState(false);
  const [mkError, setMkError] = useState<string | null>(null);
  const [mkSuccess, setMkSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [coachFilter, setCoachFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [classFilter, setClassFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  // Kept apart from loadError: an attribution failure leaves the trail COMPLETE
  // — only the Coach column is unavailable (RISK 7).
  const [attribError, setAttribError] = useState<string | null>(null);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(new Map());

  // Payment-method chips. A failed RPC means no chips, never an empty trail.
  useEffect(() => {
    loadPackageCoverage().then((cov) => setCovMap(coverageByStudent(cov)));
  }, []);

  // Names looked up at render from the coach list — the rows carry ids.
  const coachNameById = new Map(coaches.map((c) => [c.id, c.full_name]));

  const sort = useTableSort<AttendanceRow>({
    key: "session_date",
    dir: "desc",
    accessors: {
      status: (r) => STATUS_LABELS[r.status] ?? r.status,
      coach_name: (r) => (r.main_coach_id ? coachNameById.get(r.main_coach_id) ?? "" : ""),
    },
  });

  // The dropdown contents don't change with the date range, so they load once.
  useEffect(() => {
    async function loadFilters() {
      const { coachRows, classRows, error } = await loadFilterOptions();
      if (error) setLoadError(error);
      setCoaches(mapFilterCoaches(coachRows));
      setClasses(mapFilterClasses(classRows));
    }
    loadFilters();
    loadMakeupSeed();
  }, []);

  async function loadMakeupSeed() {
    const { classRows, enrolRows } = await loadMakeupData();
    const mapped = mapMakeupData(classRows, enrolRows);
    setMakeupClasses(mapped.makeupClasses);
    setEnrolmentSet(mapped.enrolmentSet);
    setOwnClassesByStudent(mapped.ownClassesByStudent);
  }

  // Re-queries when the range moves — the range is applied in the DATABASE.
  useEffect(() => {
    let cancelled = false;

    async function loadRows() {
      setLoading(true);

      const { data, error } = await loadAttendanceRows({ dateFrom, dateTo, term: search });
      if (cancelled) return;

      if (error) {
        setLoadError(error);
        setAttribError(null);
        setRows([]);
        setLoading(false);
        return;
      }
      setLoadError(null);

      const rawRows = mapAttendanceRows(data ?? []);
      const { lessons, classIds } = buildLessonRefs(rawRows);

      const { attribution, attributionError } = await loadAttribution(lessons, classIds);
      if (cancelled) return;

      setAttribError(attributionError);
      setRows(applyAttribution(rawRows, attribution));
      setLoading(false);
    }

    /**
     * Resolve who was PAID for each lesson. Each load is checked two ways: a
     * query error, and a result at the cap (max_rows = 1000, truncated SILENTLY
     * — RISK 6). Either returns a null attribution, so the Coach column degrades
     * to "—" rather than attributing from half the data.
     */
    async function loadAttribution(
      lessons: ReturnType<typeof buildLessonRefs>["lessons"],
      classIds: string[]
    ): Promise<{ attribution: Map<string, LessonAttribution> | null; attributionError: string | null }> {
      if (lessons.length === 0) {
        return { attribution: new Map(), attributionError: null };
      }

      const { subs, rates, shadows, error } = await loadAttributionInputs(classIds);
      if (error) {
        return { attribution: null, attributionError: `Could not resolve who taught each lesson: ${error}` };
      }

      if (subs.length >= ROW_LIMIT || rates.length >= ROW_LIMIT || shadows.length >= ROW_LIMIT) {
        return {
          attribution: null,
          attributionError: "Too many coaching records to resolve who taught each lesson reliably.",
        };
      }

      // Absences only matter for shadowing coaches, so key on that handful.
      const shadowCoachIds = [...new Set(shadows.map((s) => s.coach_id))];
      let absences: Awaited<ReturnType<typeof loadShadowAbsences>>["data"] = [];
      if (shadowCoachIds.length > 0) {
        const { data: absData, error: absErr } = await loadShadowAbsences(shadowCoachIds);
        if (absErr) {
          return { attribution: null, attributionError: `Could not resolve shadow attendance: ${absErr}` };
        }
        if ((absData ?? []).length >= ROW_LIMIT) {
          return { attribution: null, attributionError: "Too many shadow-absence records to resolve reliably." };
        }
        absences = absData ?? [];
      }

      return {
        attribution: attributeLessons({ lessons, substitutes: subs, classRates: rates, shadows, absences: absences ?? [] }),
        attributionError: null,
      };
    }

    loadRows();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, debouncedSearch]);

  const filtered = filterRows(rows, { coachFilter, statusFilter, classFilter });
  const visible = sort.apply(filtered);

  const anyFilter =
    search !== "" ||
    coachFilter !== "All" ||
    statusFilter !== "All" ||
    classFilter !== "All" ||
    dateFrom !== "" ||
    dateTo !== "";

  function clearFilters() {
    setSearch("");
    setCoachFilter("All");
    setStatusFilter("All");
    setClassFilter("All");
    setDateFrom("");
    setDateTo("");
  }

  function handleExportCsv() {
    // Coach text mirrors the on-screen cell.
    const coachText = (a: AttendanceRow): string => {
      if (!a.main_coach_id) return "";
      let s = coachNameById.get(a.main_coach_id) ?? "Unknown coach";
      if (a.is_cover) s += " (cover)";
      for (const id of a.shadow_coach_ids) s += `; +${coachNameById.get(id) ?? "Unknown coach"} (shadow)`;
      return s;
    };
    const columns: CsvColumn<AttendanceRow>[] = [
      { header: "Student", value: (a) => a.student_name },
      { header: "Class", value: (a) => a.class_title },
      { header: "Coach", value: coachText },
      { header: "Date", value: (a) => a.session_date },
      { header: "Status", value: (a) => STATUS_LABELS[a.status] ?? a.status },
    ];
    const res = exportCsv(`attendance-${todayInSg()}.csv`, visible, columns, { sourceCount: rows.length });
    setExportNotice(
      res.ok
        ? null
        : `Too many records to export at once (capped at ${res.cap} most recent). ` +
            `Narrow the date range or filters, then export again.`
    );
  }

  // ⚠ RISK 6 — only a row that is the child's OWN enrolled class can seed a
  // make-up. Gate the button here.
  function canBookMakeup(a: AttendanceRow): boolean {
    return canBookMakeupFromRow(a.status, enrolmentSet.has(`${a.student_id}:${a.class_id}`));
  }

  // Same-category classes minus EVERY class the child is in.
  const makeupHosts: MakeupClass[] = makeupRow
    ? makeupHostChoices(
        makeupClasses,
        makeupRow.class_id,
        ownClassesByStudent.get(makeupRow.student_id) ?? new Set<string>()
      )
    : [];

  /** Real lesson dates for the host class. An affordance — book_makeup() is the guard. */
  function makeupDatesFor(classId: string): string[] {
    const c = makeupClasses.find((x) => x.id === classId);
    if (!c) return [];
    const today = todayInSg();
    const shift = (days: number): string => {
      const [y, m, d] = today.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d + days));
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    };
    return expectedLessonDates(c.day_of_week, shift(-21), shift(70));
  }

  function openMakeup(a: AttendanceRow) {
    setMakeupRow(a);
    setMkHost("");
    setMkDate("");
    setMkError(null);
    setMkSuccess(null);
  }

  async function handleBookMakeup() {
    if (!makeupRow || !mkHost || !mkDate) return;
    setMkBusy(true);
    setMkError(null);
    // The missed lesson's class IS the home class this make-up replaces.
    const error = await bookMakeup({
      classId: mkHost,
      date: mkDate,
      studentId: makeupRow.student_id,
      homeClassId: makeupRow.class_id,
    });
    setMkBusy(false);
    if (error) {
      setMkError(error);
      return;
    }
    const name = makeupRow.student_name;
    setMakeupRow(null);
    setMkSuccess(
      `Make-up booked for ${name}. It now appears on the Makeups page, where it ` +
        `stays until the coach marks it.`
    );
  }

  return {
    rows,
    coaches,
    classes,
    covMap,
    coachNameById,
    sort,
    visible,
    loading,
    loadError,
    attribError,
    exportNotice,
    mkSuccess,
    anyFilter,
    search,
    coachFilter,
    statusFilter,
    classFilter,
    dateFrom,
    dateTo,
    setSearch,
    setCoachFilter,
    setStatusFilter,
    setClassFilter,
    setDateFrom,
    setDateTo,
    clearFilters,
    handleExportCsv,
    setExportNotice,
    setMkSuccess,
    // make-up modal
    makeupRow,
    makeupHosts,
    mkHost,
    mkDate,
    mkBusy,
    mkError,
    setMkHost,
    setMkDate,
    setMakeupRow,
    makeupDatesFor,
    openMakeup,
    handleBookMakeup,
    canBookMakeup,
  };
}

export type AttendanceState = ReturnType<typeof useAttendance>;
