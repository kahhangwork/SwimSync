"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { exportCsv, type CsvColumn } from "@/lib/csv";
import {
  canBookMakeupFromRow,
  makeupHostChoices,
} from "@/lib/makeupFromAttendance";
import {
  todayInSg,
  formatSgDate,
  expectedLessonDates,
  type DayOfWeek,
} from "@/lib/lessonDates";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import { PackageChip } from "@/components/PackageChip";
import {
  attributeLessons,
  type LessonRef,
  type LessonAttribution,
  type ClassRateRow,
  type SubstituteRow,
  type ClassShadowRow,
  type AbsenceRow,
} from "@/lib/lessonAttribution";
import { ilikeContains } from "@/lib/tableSearch";
import { useDebouncedValue } from "@/components/useDebouncedValue";

type AttendanceRow = {
  id: string;
  student_id: string;
  student_name: string;
  class_id: string;
  class_title: string;
  session_date: string;
  status: string;
  // The MONEY axis (§7.152): who was PAID for this lesson, never
  // classes.coach_id. Ids, not names — the filter and sort key on these so two
  // coaches sharing a name cannot collapse (RISK 9). Null main = the cell shows
  // "—", either because no rate resolved or because an attribution load failed
  // (RISK 6/7 — never a name we could not stand behind).
  main_coach_id: string | null;
  is_cover: boolean;
  shadow_coach_ids: string[];
};

const STATUS_FILTERS = [
  "All","present","absent","cancelled_rain","cancelled_coach","trial_paid","trial_free","holiday",
];

const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  cancelled_rain: "Cancelled (Rain)",
  cancelled_coach: "Cancelled (Coach)",
  trial_paid: "Trial (Paid)",
  trial_free: "Trial (Free)",
  holiday: "Public Holiday",
};

/**
 * The date range is what keeps this page bounded, so the cap is only a backstop
 * — but it is a visible one: when a load comes back full we say so, rather than
 * showing a truncated audit trail that looks complete.
 */
const ROW_LIMIT = 1000;

// Make-up booking, from an absent/cancelled row. The missed lesson's class is
// the HOME class; the admin picks a same-category HOST class + date to guest into.
type MakeupClass = {
  id: string;
  title: string;
  day_of_week: DayOfWeek;
  category_id: string;
  is_active: boolean;
};

export default function AttendancePage() {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [coaches, setCoaches] = useState<{ id: string; full_name: string }[]>([]);
  const [classes, setClasses] = useState<{ id: string; label: string }[]>([]);
  // For booking a make-up: the full class list (incl. inactive, so a retired
  // home class still resolves its category) and every active enrolment as a
  // "student:class" set.
  const [makeupClasses, setMakeupClasses] = useState<MakeupClass[]>([]);
  const [enrolmentSet, setEnrolmentSet] = useState<Set<string>>(new Set());
  const [ownClassesByStudent, setOwnClassesByStudent] = useState<
    Map<string, Set<string>>
  >(new Map());
  // The row a make-up is being booked from, plus the host class/date chosen.
  const [makeupRow, setMakeupRow] = useState<AttendanceRow | null>(null);
  const [mkHost, setMkHost] = useState("");
  const [mkDate, setMkDate] = useState("");
  const [mkBusy, setMkBusy] = useState(false);
  const [mkError, setMkError] = useState<string | null>(null);
  const [mkSuccess, setMkSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // The student search now runs in the DB (against the already-!inner students
  // embed), so it reaches every row in the date range, not the first 1000.
  // Debounced, because each change is a round trip that also re-attributes.
  const debouncedSearch = useDebouncedValue(search);
  const [coachFilter, setCoachFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [classFilter, setClassFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  // Kept apart from loadError on purpose: an attribution failure leaves the
  // audit trail COMPLETE — only the Coach column is unavailable — so it must not
  // borrow the "records incomplete, do not trust this" framing (RISK 7).
  const [attribError, setAttribError] = useState<string | null>(null);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );

  // Payment-method chips. Separate from the row loads: a failed RPC means no
  // chips, never an empty audit trail.
  useEffect(() => {
    supabase
      .rpc("student_package_coverage")
      .then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])));
  }, []);

  // Names are looked up at render from the coach list — the rows carry ids. A
  // coach in the tenant is always in this list (the dropdown loads all of them),
  // so a miss means a genuinely unknown id, not an unloaded name.
  const coachNameById = new Map(coaches.map((c) => [c.id, c.full_name]));

  const sort = useTableSort<AttendanceRow>({
    key: "session_date",
    dir: "desc",
    accessors: {
      // Sort the label, not the enum. `cancelled_rain` and "Cancelled (Rain)"
      // order differently, and A→Z has to mean the A→Z that is on screen.
      status: (r) => STATUS_LABELS[r.status] ?? r.status,
      // Sort by the MAIN coach's name only — the same rule `status` states:
      // A→Z must mean the A→Z that is on screen, and the shadow line is not it.
      coach_name: (r) =>
        r.main_coach_id ? coachNameById.get(r.main_coach_id) ?? "" : "",
    },
  });

  // The dropdown contents don't change with the date range, so they load once.
  useEffect(() => {
    async function loadFilters() {
      const [{ data: coachData, error: coachErr }, { data: classData, error: classErr }] =
        await Promise.all([
          supabase.from("coaches").select("id, profiles(full_name)"),
          // No is_active filter: attendance outlives the class it was recorded
          // against, and a month cannot be audited if the class it happened in
          // has since been retired out of the picker. Inactive ones are labelled.
          supabase.from("classes").select("id, title, is_active").order("title"),
        ]);

      // A failed load would otherwise be an empty dropdown, which reads as "this
      // business has no classes" — and a filter you cannot see is a filter you
      // conclude does not apply.
      if (coachErr || classErr) {
        setLoadError((coachErr ?? classErr)!.message);
      }

      setCoaches(
        (coachData ?? []).map((c: any) => ({
          id: c.id,
          full_name: c.profiles?.full_name ?? "Unknown",
        }))
      );

      setClasses(
        (classData ?? []).map((c: any) => ({
          id: c.id,
          label: c.is_active ? c.title : `${c.title} (inactive)`,
        }))
      );
    }

    loadFilters();
    loadMakeupData();
  }, []);

  // Data the make-up entry point needs: every class (incl. inactive, so a
  // retired home class still resolves a category) and every active enrolment.
  async function loadMakeupData() {
    const [{ data: cls }, { data: enrol }] = await Promise.all([
      supabase
        .from("classes")
        .select("id, title, day_of_week, category_id, is_active")
        .order("title"),
      supabase
        .from("student_class_enrolments")
        .select("student_id, class_id")
        .eq("is_active", true),
    ]);
    setMakeupClasses((cls ?? []) as MakeupClass[]);
    const set = new Set<string>();
    const byStudent = new Map<string, Set<string>>();
    for (const e of enrol ?? []) {
      const sid = e.student_id as string;
      const cid = e.class_id as string;
      set.add(`${sid}:${cid}`);
      const own = byStudent.get(sid) ?? new Set<string>();
      own.add(cid);
      byStudent.set(sid, own);
    }
    setEnrolmentSet(set);
    setOwnClassesByStudent(byStudent);
  }

  // Re-queries when the range moves, because the range is applied in the
  // DATABASE. Filtering client-side would only narrow whatever arbitrary slice
  // the limit had already handed us.
  useEffect(() => {
    // Setting From and then To fires two loads. Without this flag the slower of
    // the two can resolve last and win, leaving the table showing a range the
    // inputs no longer describe — and looking entirely settled while it does.
    let cancelled = false;

    async function loadRows() {
      setLoading(true);

      // No `coaches` embed any more: that is `classes.coach_id`, the ACCESS
      // axis, and naming it beside a lesson mis-attributes money the moment a
      // class changes hands (§7.152). `lesson_sessions.id` is added because the
      // money-axis resolution is keyed by the lesson, not the class.
      let query = supabase
        .from("attendance")
        .select(
          "id, status, students!inner(id, full_name), lesson_sessions!inner(id, session_date, classes!inner(id, title))"
        )
        // Ordering by the EMBEDDED date, not by `id`.
        //
        // This used to be `.order("id", { ascending: false }).limit(500)`, and
        // `attendance.id` is a UUID — random. So the limit took an arbitrary 500
        // rows and the page then sorted *those* by date, presenting them as the
        // most recent records. With 20 rows in the table every row is included
        // and it looks right; the bug only appears once there is real data,
        // which is exactly when an audit trail starts to matter.
        .order("lesson_sessions(session_date)", { ascending: false })
        .order("students(full_name)")
        .limit(ROW_LIMIT);

      if (dateFrom) query = query.gte("lesson_sessions.session_date", dateFrom);
      if (dateTo) query = query.lte("lesson_sessions.session_date", dateTo);
      // Scoped student search, pushed into the DB via the !inner students embed
      // — a bound `.ilike`, so a `, ( )` in a name is literal (lib/tableSearch).
      const term = search.trim();
      if (term) query = query.ilike("students.full_name", ilikeContains(term));

      const { data, error } = await query;
      if (cancelled) return;

      // Surfaced, never swallowed. An unchecked failure here empties the table,
      // which on an audit trail reads as "nothing was recorded" — the most
      // reassuring possible rendering of a broken query. This page also has a
      // new way to fail: the ordering and the range filter are both expressed
      // against an EMBEDDED column, which PostgREST can reject outright.
      if (error) {
        setLoadError(error.message);
        setAttribError(null);
        setRows([]);
        setLoading(false);
        return;
      }
      setLoadError(null);

      const rawRows = (data ?? []).map((a: any) => ({
        id: a.id,
        student_id: a.students?.id ?? "",
        student_name: a.students?.full_name ?? "—",
        class_id: a.lesson_sessions?.classes?.id ?? "",
        class_title: a.lesson_sessions?.classes?.title ?? "—",
        session_date: a.lesson_sessions?.session_date ?? "—",
        status: a.status,
        lesson_session_id: a.lesson_sessions?.id ?? "",
      }));

      // The distinct lessons behind these rows — one attribution per lesson,
      // reused across every per-student row of it.
      const lessonById = new Map<string, LessonRef>();
      for (const r of rawRows) {
        if (r.lesson_session_id && r.class_id && !lessonById.has(r.lesson_session_id)) {
          lessonById.set(r.lesson_session_id, {
            lesson_session_id: r.lesson_session_id,
            class_id: r.class_id,
            session_date: r.session_date,
          });
        }
      }
      const lessons = [...lessonById.values()];
      const classIds = [...new Set(lessons.map((l) => l.class_id))];

      const { attribution, attributionError } = await loadAttribution(
        lessons,
        classIds
      );
      if (cancelled) return;

      setAttribError(attributionError);

      setRows(
        rawRows.map((r) => {
          // A null attribution (load failed) means EVERY row shows "—" in the
          // Coach cell, never a name we could not stand behind (RISK 7).
          const at = attribution?.get(r.lesson_session_id);
          return {
            id: r.id,
            student_id: r.student_id,
            student_name: r.student_name,
            class_id: r.class_id,
            class_title: r.class_title,
            session_date: r.session_date,
            status: r.status,
            main_coach_id: at?.main_coach_id ?? null,
            is_cover: at?.is_cover ?? false,
            shadow_coach_ids: at?.shadow_coach_ids ?? [],
          };
        })
      );

      setLoading(false);
    }

    /**
     * Resolve who was PAID for each lesson — substitute, else the class's terms
     * coach on the date, plus any shadows. All loads are RLS-scoped to the
     * admin's tenant, and each is checked two ways: a query error, and a result
     * at the cap (`max_rows = 1000`, which PostgREST truncates SILENTLY —
     * RISK 6). Either returns a null attribution, so the Coach column degrades
     * to "—" rather than attributing from half the data.
     */
    async function loadAttribution(
      lessons: LessonRef[],
      classIds: string[]
    ): Promise<{
      attribution: Map<string, LessonAttribution> | null;
      attributionError: string | null;
    }> {
      if (lessons.length === 0) {
        return { attribution: new Map(), attributionError: null };
      }

      const [subsRes, ratesRes, shadowsRes] = await Promise.all([
        // Substitutes are tenant-wide and near-empty by the absence rule; the
        // whole set is a smaller, header-safe request than `.in(sessionIds)`.
        supabase.from("session_coaches").select("lesson_session_id, coach_id"),
        // The MONEY axis. Bounded to the visible classes — a handful of ids.
        supabase
          .from("class_rates")
          .select("class_id, effective_from, paid_coach_id")
          .in("class_id", classIds),
        supabase
          .from("class_shadow_coaches")
          .select("class_id, coach_id, effective_from, effective_to"),
      ]);

      const firstErr = subsRes.error ?? ratesRes.error ?? shadowsRes.error;
      if (firstErr) {
        return {
          attribution: null,
          attributionError: `Could not resolve who taught each lesson: ${firstErr.message}`,
        };
      }

      const subs = (subsRes.data ?? []) as SubstituteRow[];
      const rates = (ratesRes.data ?? []) as ClassRateRow[];
      const shadows = (shadowsRes.data ?? []) as ClassShadowRow[];

      if (
        subs.length >= ROW_LIMIT ||
        rates.length >= ROW_LIMIT ||
        shadows.length >= ROW_LIMIT
      ) {
        return {
          attribution: null,
          attributionError:
            "Too many coaching records to resolve who taught each lesson reliably.",
        };
      }

      // Absences only matter for coaches who actually shadow a class, so the
      // query is keyed on that handful — never the lesson ids, which would put
      // hundreds of them in the URL and 414 (RISK 6).
      const shadowCoachIds = [...new Set(shadows.map((s) => s.coach_id))];
      let absences: AbsenceRow[] = [];
      if (shadowCoachIds.length > 0) {
        const { data: absData, error: absErr } = await supabase
          .from("session_coach_absences")
          .select("lesson_session_id, coach_id")
          .in("coach_id", shadowCoachIds);
        if (absErr) {
          return {
            attribution: null,
            attributionError: `Could not resolve shadow attendance: ${absErr.message}`,
          };
        }
        if ((absData ?? []).length >= ROW_LIMIT) {
          return {
            attribution: null,
            attributionError:
              "Too many shadow-absence records to resolve reliably.",
          };
        }
        absences = (absData ?? []) as AbsenceRow[];
      }

      return {
        attribution: attributeLessons({
          lessons,
          substitutes: subs,
          classRates: rates,
          shadows,
          absences,
        }),
        attributionError: null,
      };
    }

    loadRows();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, debouncedSearch]);

  // Student search moved into the DB (above); these are the client refinements
  // over whatever the fetch returned.
  const filtered = rows.filter((a) => {
    // Keyed by id, main OR shadow — the option values are ids now, so two
    // coaches sharing a name no longer collapse into one filter (RISK 9).
    const matchCoach =
      coachFilter === "All" ||
      a.main_coach_id === coachFilter ||
      a.shadow_coach_ids.includes(coachFilter);
    const matchStatus = statusFilter === "All" || a.status === statusFilter;
    // By id, not by title: two classes can share a name, and the whole reason
    // to filter by class is to be sure you are looking at exactly one of them.
    const matchClass = classFilter === "All" || a.class_id === classFilter;
    return matchCoach && matchStatus && matchClass;
  });

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

  const inputClass =
    "rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400";

  function handleExportCsv() {
    // Coach text mirrors the on-screen cell: main coach, "(cover)" when a
    // substitute stood in, and each shadow appended. Blank when no coach
    // resolved (the same "—" the cell shows — empty is cleaner in a spreadsheet).
    const coachText = (a: AttendanceRow): string => {
      if (!a.main_coach_id) return "";
      let s = coachNameById.get(a.main_coach_id) ?? "Unknown coach";
      if (a.is_cover) s += " (cover)";
      for (const id of a.shadow_coach_ids) {
        s += `; +${coachNameById.get(id) ?? "Unknown coach"} (shadow)`;
      }
      return s;
    };
    const columns: CsvColumn<AttendanceRow>[] = [
      { header: "Student", value: (a) => a.student_name },
      { header: "Class", value: (a) => a.class_title },
      { header: "Coach", value: coachText },
      { header: "Date", value: (a) => a.session_date },
      { header: "Status", value: (a) => STATUS_LABELS[a.status] ?? a.status },
    ];
    const res = exportCsv(`attendance-${todayInSg()}.csv`, visible, columns, {
      sourceCount: rows.length,
    });
    setExportNotice(
      res.ok
        ? null
        : `Too many records to export at once (capped at ${res.cap} most recent). ` +
            `Narrow the date range or filters, then export again.`,
    );
  }

  // ── Book a make-up from a missed lesson ──────────────────────────────────────
  // ⚠ RISK 6 — only a row that is the child's OWN enrolled class can seed a
  // make-up: its class becomes p_home_class_id. A guest row (a trial, or another
  // child's make-up) has class_id = the HOST class, which is not an enrolment, so
  // book_makeup() would refuse it with a baffling message. Gate the button here.
  function canBookMakeup(a: AttendanceRow): boolean {
    return canBookMakeupFromRow(
      a.status,
      enrolmentSet.has(`${a.student_id}:${a.class_id}`),
    );
  }

  // Same-category classes minus EVERY class the child is in (see the helper — the
  // "all their classes" exclusion is load-bearing).
  const makeupHosts: MakeupClass[] = makeupRow
    ? makeupHostChoices(
        makeupClasses,
        makeupRow.class_id,
        ownClassesByStudent.get(makeupRow.student_id) ?? new Set<string>(),
      )
    : [];

  /** Real lesson dates for the host class: its weekday pattern, a short look back
   *  and a couple of months ahead. An affordance — book_makeup() is the guard. */
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
    // book_makeup() holds every refusal — wrong category, own class, wrong
    // weekday, an already-billed month — in plain sentences. Show them as-is.
    // The missed lesson's class IS the home class this make-up replaces.
    const { error } = await supabase.rpc("book_makeup", {
      p_class_id: mkHost,
      p_session_date: mkDate,
      p_student_id: makeupRow.student_id,
      p_home_class_id: makeupRow.class_id,
    });
    setMkBusy(false);
    if (error) {
      setMkError(error.message);
      return;
    }
    const name = makeupRow.student_name;
    setMakeupRow(null);
    setMkSuccess(
      `Make-up booked for ${name}. It now appears on the Makeups page, where it ` +
        `stays until the coach marks it.`,
    );
  }

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Read-only audit trail of all lesson records"
      />

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by student..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} w-52 placeholder-gray-400 px-4`}
        />
        <select
          value={coachFilter}
          onChange={(e) => setCoachFilter(e.target.value)}
          className={inputClass}
        >
          <option value="All">All Coaches</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className={inputClass}
        >
          <option value="All">All Classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={inputClass}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "All" ? "All Statuses" : STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          From
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          To
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className={inputClass}
          />
        </label>

        {anyFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="px-3 py-2.5 text-sm font-medium text-sky-600 hover:text-sky-700 hover:underline"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto">
          <Button
            variant="outline"
            disabled={visible.length === 0}
            onClick={handleExportCsv}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {exportNotice && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {exportNotice}
        </div>
      )}

      {mkSuccess && (
        <div className="mb-3 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <span className="flex-1">{mkSuccess}</span>
          <button
            onClick={() => setMkSuccess(null)}
            className="font-semibold text-green-700 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the attendance records: {loadError}. The table below is
          incomplete — do not read it as the full trail.
        </div>
      )}

      {attribError && !loadError && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {attribError} The records below are complete, but the Coach column is
          shown as &ldquo;—&rdquo; rather than risk naming the wrong coach.
        </div>
      )}

      {!loading && !loadError && rows.length === ROW_LIMIT && (
        <p className="mb-3 text-sm text-amber-700">
          Showing the {ROW_LIMIT} most recent records. Narrow the date range to
          see earlier ones.
        </p>
      )}

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
              <Td className="text-center text-gray-400 py-8" colSpan={6}>
                Loading…
              </Td>
            </Tr>
          ) : visible.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={6}>
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
                <Td className="font-medium text-gray-900">
                  {a.student_name}
                  <span className="ml-1.5">
                    <PackageChip coverage={covMap.get(a.student_id)} />
                  </span>
                </Td>
                <Td className="text-gray-600">{a.class_title}</Td>
                <Td className="text-gray-500">
                  {a.main_coach_id ? (
                    <>
                      {coachNameById.get(a.main_coach_id) ?? "Unknown coach"}
                      {a.is_cover && (
                        <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Cover
                        </span>
                      )}
                      {a.shadow_coach_ids.length > 0 && (
                        <div className="mt-0.5 text-xs text-gray-400">
                          {a.shadow_coach_ids
                            .map(
                              (id) =>
                                `+ ${coachNameById.get(id) ?? "Unknown coach"} (shadow)`
                            )
                            .join(", ")}
                        </div>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td className="text-gray-500">{a.session_date}</Td>
                <Td>
                  <StatusBadge status={STATUS_LABELS[a.status] ?? a.status} />
                </Td>
                <Td>
                  {canBookMakeup(a) && (
                    <button
                      onClick={() => openMakeup(a)}
                      className="rounded-lg border border-sky-300 bg-white px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                    >
                      Book make-up
                    </button>
                  )}
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      {/* ── Book a make-up ──────────────────────────────────────────────────── */}
      <Modal
        title="Book a make-up"
        open={makeupRow !== null}
        onClose={() => setMakeupRow(null)}
      >
        {makeupRow && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Make up <strong>{makeupRow.student_name}</strong>&apos;s missed{" "}
              <strong>{makeupRow.class_title}</strong> lesson on{" "}
              {formatSgDate(makeupRow.session_date)} by guesting them into another
              class of the same kind.
            </p>

            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Host class</span>
              <select
                value={mkHost}
                onChange={(e) => {
                  setMkHost(e.target.value);
                  setMkDate("");
                }}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Choose a class…</option>
                {makeupHosts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              {makeupHosts.length === 0 && (
                <span className="mt-1 block text-[11px] text-amber-600">
                  No other class of this kind to host the make-up. Create one, or
                  book it from the Makeups page.
                </span>
              )}
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Lesson</span>
              <select
                value={mkDate}
                onChange={(e) => setMkDate(e.target.value)}
                disabled={!mkHost}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
              >
                <option value="">
                  {mkHost ? "Choose a date…" : "Choose a class first"}
                </option>
                {makeupDatesFor(mkHost).map((d) => (
                  <option key={d} value={d}>
                    {formatSgDate(d)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-gray-400">
                Only the days the host class actually runs.
              </span>
            </label>

            {mkError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {mkError}
              </p>
            )}

            <Button
              className="w-full"
              disabled={mkBusy || !mkHost || !mkDate}
              onClick={handleBookMakeup}
            >
              {mkBusy ? "Booking…" : "Book the make-up"}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
