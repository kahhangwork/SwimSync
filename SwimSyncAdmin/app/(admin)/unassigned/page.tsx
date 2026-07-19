"use client";

import { useEffect, useState } from "react";
import { UserCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

type Student = {
  id: string;
  full_name: string;
  swimming_ability: string | null;
  parent_name: string;
};

type Coach = {
  id: string;
  full_name: string;
};

type ClassOption = {
  id: string;
  title: string;
  day_of_week: string;
  start_time: string;
  student_count: number;
};

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function UnassignedPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [assignModal, setAssignModal] = useState<Student | null>(null);
  const [selectedCoachId, setSelectedCoachId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  useEffect(() => {
    loadStudents();
    loadCoaches();
  }, []);

  async function loadStudents() {
    setLoading(true);
    const { data } = await supabase
      .from("students")
      .select(
        "id, full_name, swimming_ability, parent_students(parents(profiles(full_name)))"
      )
      .eq("assignment_status", "unassigned")
        .eq("is_active", true)
      .order("full_name");

    setStudents(
      (data ?? []).map((s: any) => ({
        id: s.id,
        full_name: s.full_name,
        swimming_ability: s.swimming_ability,
        parent_name:
          s.parent_students?.[0]?.parents?.profiles?.full_name ?? "—",
      }))
    );
    setLoading(false);
  }

  async function loadCoaches() {
    const { data } = await supabase
      .from("coaches")
      .select("id, profiles(full_name)")
      .order("id");
    setCoaches(
      (data ?? []).map((c: any) => ({
        id: c.id,
        full_name: c.profiles?.full_name ?? "Unknown",
      }))
    );
  }

  async function loadClassesForCoach(coachId: string) {
    const { data } = await supabase
      .from("classes")
      .select(
        "id, title, day_of_week, start_time, student_class_enrolments(id, is_active)"
      )
      .eq("coach_id", coachId)
      .eq("is_active", true)
      .order("day_of_week")
      .order("start_time");

    setClassOptions(
      (data ?? []).map((c: any) => ({
        id: c.id,
        title: c.title,
        day_of_week: c.day_of_week,
        start_time: c.start_time,
        student_count: (c.student_class_enrolments ?? []).filter(
          (e: any) => e.is_active
        ).length,
      }))
    );
  }

  async function handleAssign() {
    if (!assignModal || !selectedClassId) return;
    setAssigning(true);
    setAssignError(null);

    const { error: enrolError } = await supabase
      .from("student_class_enrolments")
      .insert({
        student_id: assignModal.id,
        class_id: selectedClassId,
        is_active: true,
      });

    if (enrolError) {
      setAssignError(enrolError.message);
      setAssigning(false);
      return;
    }

    await supabase
      .from("students")
      .update({ assignment_status: "assigned" })
      .eq("id", assignModal.id);

    setAssignModal(null);
    setSelectedCoachId("");
    setSelectedClassId("");
    setAssigning(false);
    loadStudents();
  }

  const filtered = students.filter(
    (s) =>
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      s.parent_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title="Unassigned Children"
        subtitle={`${students.length} children awaiting class assignment`}
      />

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by student or parent name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />
      </div>

      <Table>
        <Thead>
          <tr>
            <Th>Student</Th>
            <Th>Parent</Th>
            <Th>Action</Th>
          </tr>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={3}>
                Loading…
              </Td>
            </Tr>
          ) : filtered.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={3}>
                No unassigned children found.
              </Td>
            </Tr>
          ) : (
            filtered.map((student) => (
              <Tr key={student.id}>
                <Td className="font-medium text-gray-900">{student.full_name}</Td>
                <Td className="text-gray-500">{student.parent_name}</Td>
                <Td>
                  <Button
                    size="sm"
                    onClick={() => {
                      setAssignModal(student);
                      setSelectedCoachId("");
                      setSelectedClassId("");
                      setAssignError(null);
                    }}
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    Assign
                  </Button>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      {/* Assign Modal */}
      <Modal
        title={`Assign ${assignModal?.full_name ?? ""} to a Class`}
        open={!!assignModal}
        onClose={() => setAssignModal(null)}
      >
        <div className="space-y-4">
          {assignModal && (
            <div className="rounded-xl bg-gray-50 p-3 text-sm">
              <p className="font-medium text-gray-900">{assignModal.full_name}</p>
              <p className="text-gray-500">Parent: {assignModal.parent_name}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Select Coach
            </label>
            <select
              value={selectedCoachId}
              onChange={(e) => {
                setSelectedCoachId(e.target.value);
                setSelectedClassId("");
                if (e.target.value) loadClassesForCoach(e.target.value);
              }}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <option value="">— Choose a coach —</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Select Class
            </label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              disabled={!selectedCoachId}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-50"
            >
              <option value="">— Choose a class —</option>
              {classOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {capitalize(c.day_of_week)}{" "}
                  {formatTime(c.start_time)} · {c.student_count} students
                </option>
              ))}
            </select>
          </div>

          {assignError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {assignError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setAssignModal(null)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!selectedCoachId || !selectedClassId || assigning}
              onClick={handleAssign}
            >
              {assigning ? "Assigning…" : "Confirm Assignment"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
