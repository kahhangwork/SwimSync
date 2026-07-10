"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";

type AttendanceRow = {
  id: string;
  student_name: string;
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

export default function AttendancePage() {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [coaches, setCoaches] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [coachFilter, setCoachFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    async function load() {
      const [{ data: attData }, { data: coachData }] = await Promise.all([
        supabase
          .from("attendance")
          .select(
            "id, status, students(full_name), lesson_sessions(session_date, classes(title, coaches(id, profiles(full_name))))"
          )
          .order("id", { ascending: false })
          .limit(500),
        supabase
          .from("coaches")
          .select("id, profiles(full_name)"),
      ]);

      setRows(
        (attData ?? []).map((a: any) => ({
          id: a.id,
          student_name: a.students?.full_name ?? "—",
          class_title: a.lesson_sessions?.classes?.title ?? "—",
          coach_name:
            a.lesson_sessions?.classes?.coaches?.profiles?.full_name ?? "—",
          session_date: a.lesson_sessions?.session_date ?? "—",
          status: a.status,
        }))
      );

      setCoaches(
        (coachData ?? []).map((c: any) => ({
          id: c.id,
          full_name: c.profiles?.full_name ?? "Unknown",
        }))
      );

      setLoading(false);
    }

    load();
  }, []);

  // Sort by session date desc client-side
  const sorted = [...rows].sort((a, b) =>
    b.session_date.localeCompare(a.session_date)
  );

  const filtered = sorted.filter((a) => {
    const matchSearch = a.student_name
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchCoach =
      coachFilter === "All" || a.coach_name === coachFilter;
    const matchStatus =
      statusFilter === "All" || a.status === statusFilter;
    return matchSearch && matchCoach && matchStatus;
  });

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Read-only audit trail of all lesson records"
      />

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by student..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 w-52"
        />
        <select
          value={coachFilter}
          onChange={(e) => setCoachFilter(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          <option value="All">All Coaches</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.full_name}>
              {c.full_name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "All" ? "All Statuses" : STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      <Table>
        <Thead>
          <tr>
            <Th>Student</Th>
            <Th>Class</Th>
            <Th>Coach</Th>
            <Th>Date</Th>
            <Th>Status</Th>
          </tr>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={5}>
                Loading…
              </Td>
            </Tr>
          ) : filtered.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={5}>
                No records found.
              </Td>
            </Tr>
          ) : (
            filtered.map((a) => (
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
