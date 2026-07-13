"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";

type StudentRow = {
  id: string;
  full_name: string;
  swimming_ability: string | null;
  assignment_status: string;
  parent_name: string;
  class_title: string | null;
  coach_name: string | null;
};

const STATUS_FILTERS = ["All", "Assigned", "Unassigned", "Inactive"];

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("students")
        .select(`
          id, full_name, swimming_ability, assignment_status, is_active,
          parent_students(parents(profiles(full_name))),
          student_class_enrolments(
            is_active,
            classes(title, coaches(profiles(full_name)))
          )
        `)
        .order("full_name");

      setStudents(
        (data ?? []).map((s: any) => {
          const activeEnrolment = (s.student_class_enrolments ?? []).find(
            (e: any) => e.is_active
          );
          return {
            id: s.id,
            full_name: s.full_name,
            swimming_ability: s.swimming_ability,
            assignment_status: s.is_active ? s.assignment_status : "inactive",
            parent_name:
              s.parent_students?.[0]?.parents?.profiles?.full_name ?? "—",
            class_title: activeEnrolment?.classes?.title ?? null,
            coach_name:
              activeEnrolment?.classes?.coaches?.profiles?.full_name ?? null,
          };
        })
      );
      setLoading(false);
    }

    load();
  }, []);

  const statusLabel = (s: StudentRow) => {
    if (s.assignment_status === "inactive") return "Inactive";
    if (s.assignment_status === "assigned") return "Assigned";
    return "Unassigned";
  };

  const filtered = students.filter((s) => {
    const matchSearch =
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      s.parent_name.toLowerCase().includes(search.toLowerCase());
    const label = statusLabel(s);
    const matchStatus = statusFilter === "All" || label === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle={`${students.length} students total`}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by student or parent..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 w-64"
        />
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                statusFilter === f
                  ? "bg-sky-500 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <Table>
        <Thead>
          <tr>
            <Th>Student</Th>
            <Th>Parent</Th>
            <Th>Status</Th>
            <Th>Class</Th>
            <Th>Coach</Th>
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
                No students found.
              </Td>
            </Tr>
          ) : (
            filtered.map((s) => (
              <Tr key={s.id}>
                <Td className="font-medium text-gray-900">{s.full_name}</Td>
                <Td className="text-gray-500">{s.parent_name}</Td>
                <Td>
                  <StatusBadge status={statusLabel(s)} />
                </Td>
                <Td className="text-gray-500">{s.class_title ?? "—"}</Td>
                <Td className="text-gray-500">{s.coach_name ?? "—"}</Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
