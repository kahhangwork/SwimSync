"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";

type AttendanceRow = {
  id: string;
  student_name: string;
  class_id: string;
  class_title: string;
  coach_name: string;
  session_date: string;
  status: string;
};

const STATUS_FILTERS = [
  "All","present","absent","cancelled_rain","cancelled_coach","trial_paid","trial_free",
];

const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  cancelled_rain: "Cancelled (Rain)",
  cancelled_coach: "Cancelled (Coach)",
  trial_paid: "Trial (Paid)",
  trial_free: "Trial (Free)",
};

/**
 * The date range is what keeps this page bounded, so the cap is only a backstop
 * — but it is a visible one: when a load comes back full we say so, rather than
 * showing a truncated audit trail that looks complete.
 */
const ROW_LIMIT = 1000;

export default function AttendancePage() {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [coaches, setCoaches] = useState<{ id: string; full_name: string }[]>([]);
  const [classes, setClasses] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [coachFilter, setCoachFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [classFilter, setClassFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const sort = useTableSort<AttendanceRow>({
    key: "session_date",
    dir: "desc",
    accessors: {
      // Sort the label, not the enum. `cancelled_rain` and "Cancelled (Rain)"
      // order differently, and A→Z has to mean the A→Z that is on screen.
      status: (r) => STATUS_LABELS[r.status] ?? r.status,
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
  }, []);

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

      let query = supabase
        .from("attendance")
        .select(
          "id, status, students!inner(full_name), lesson_sessions!inner(session_date, classes!inner(id, title, coaches(id, profiles(full_name))))"
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

      const { data, error } = await query;
      if (cancelled) return;

      // Surfaced, never swallowed. An unchecked failure here empties the table,
      // which on an audit trail reads as "nothing was recorded" — the most
      // reassuring possible rendering of a broken query. This page also has a
      // new way to fail: the ordering and the range filter are both expressed
      // against an EMBEDDED column, which PostgREST can reject outright.
      setLoadError(error ? error.message : null);

      setRows(
        (data ?? []).map((a: any) => ({
          id: a.id,
          student_name: a.students?.full_name ?? "—",
          class_id: a.lesson_sessions?.classes?.id ?? "",
          class_title: a.lesson_sessions?.classes?.title ?? "—",
          coach_name:
            a.lesson_sessions?.classes?.coaches?.profiles?.full_name ?? "—",
          session_date: a.lesson_sessions?.session_date ?? "—",
          status: a.status,
        }))
      );

      setLoading(false);
    }

    loadRows();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  const filtered = rows.filter((a) => {
    const matchSearch = a.student_name
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchCoach = coachFilter === "All" || a.coach_name === coachFilter;
    const matchStatus = statusFilter === "All" || a.status === statusFilter;
    // By id, not by title: two classes can share a name, and the whole reason
    // to filter by class is to be sure you are looking at exactly one of them.
    const matchClass = classFilter === "All" || a.class_id === classFilter;
    return matchSearch && matchCoach && matchStatus && matchClass;
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
            <option key={c.id} value={c.full_name}>
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
      </div>

      {loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the attendance records: {loadError}. The table below is
          incomplete — do not read it as the full trail.
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
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={5}>
                Loading…
              </Td>
            </Tr>
          ) : visible.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={5}>
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
                <Td className="font-medium text-gray-900">{a.student_name}</Td>
                <Td className="text-gray-600">{a.class_title}</Td>
                <Td className="text-gray-500">{a.coach_name}</Td>
                <Td className="text-gray-500">{a.session_date}</Td>
                <Td>
                  <StatusBadge status={STATUS_LABELS[a.status] ?? a.status} />
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
