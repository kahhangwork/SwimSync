"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import {
  removeFromClass,
  setStudentsActive,
  familyActiveChildren,
  type FamilyChild,
} from "@/lib/studentStatus";

type StudentRow = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  level_id: string | null;
  level_label: string | null;
  assignment_status: string;
  is_active: boolean;
  inactivated_at: string | null;
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
  const [pending, setPending] = useState<{
    student: StudentRow;
    mode: "remove" | "inactive";
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Siblings are READ before anything is written, so the admin confirms a named
  // set rather than a count that could change underneath them — and the set
  // they confirm is exactly what gets written.
  const [family, setFamily] = useState<FamilyChild[]>([]);
  const [takeSiblings, setTakeSiblings] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function openInactive(student: StudentRow) {
    setTakeSiblings(false);
    setFamily([]);
    setPending({ student, mode: "inactive" });
    const { children } = await familyActiveChildren(supabase, student.id);
    setFamily(children);
  }

  const siblings = family.filter((c) => !c.is_self);
  // True when this action leaves the family with no active children here — the
  // point at which the family itself becomes inactive. Not a second question:
  // it is a consequence, so the modal states it rather than asking.
  const lastActive =
    family.length > 0 && (siblings.length === 0 || takeSiblings);

  async function handleStatusChange(
    student: StudentRow,
    mode: "remove" | "inactive"
  ) {
    setBusyId(student.id);
    setActionError(null);
    const ids =
      mode === "inactive" && takeSiblings
        ? family.map((c) => c.student_id)
        : [student.id];
    const { error } =
      mode === "inactive"
        ? await setStudentsActive(supabase, ids, false)
        : await removeFromClass(supabase, student.id);
    setBusyId(null);
    setPending(null);
    if (error) {
      setActionError(`Could not update ${student.full_name}: ${error}`);
      return;
    }
    await load();
  }

  const [levels, setLevels] = useState<{ id: string; label: string }[]>([]);
  const [savingLevelFor, setSavingLevelFor] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);

  useEffect(() => {
    load();
    loadLevels();
  }, []);

  async function loadLevels() {
    // RLS scopes this to the caller's own business. Ordered by sort_order, not
    // by label — a ladder sorted alphabetically puts "Advanced" above
    // "Beginner", which is why sort_order exists at all.
    const { data } = await supabase
      .from("tenant_levels")
      .select("id, label")
      .order("sort_order")
      .order("label");
    setLevels(data ?? []);
  }

  async function setLevel(student: StudentRow, levelId: string | null) {
    setSavingLevelFor(student.id);
    setLevelError(null);
    const { error } = await supabase
      .from("students")
      .update({ level_id: levelId })
      .eq("id", student.id);
    setSavingLevelFor(null);

    if (error) {
      // 23514 is the database refusing a level from another business. Not
      // reachable from this picker, which only lists our own — but if it ever
      // fires, saying "try again" would invite a retry that cannot succeed.
      setLevelError(
        error.code === "23514"
          ? "That level belongs to a different business."
          : `Could not update ${student.full_name}'s level.`
      );
      return;
    }
    load();
  }

  async function load() {
    const { data } = await supabase
      .from("students")
      .select(`
        id, full_name, date_of_birth, level_id, assignment_status, is_active, inactivated_at,
        tenant_levels(id, label),
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
          date_of_birth: s.date_of_birth,
          level_id: s.level_id,
          // Read off the JOINED tenant_levels row, not off the student — the
          // select is `any`, so the wrong nesting level typechecks and renders
          // every student unlevelled (§7.28).
          level_label: s.tenant_levels?.label ?? null,
          // Two INDEPENDENT axes now. This used to collapse them —
          // `s.is_active ? s.assignment_status : "inactive"` — which is exactly
          // the ambiguity the active/inactive work removed: a child can be
          // active but unassigned (a new signup awaiting a class).
          assignment_status: s.assignment_status,
          is_active: s.is_active,
          inactivated_at: s.inactivated_at,
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

  // Activity is the outer question ("still a customer?"), assignment the inner
  // one ("in a class?"). An inactive child's assignment is not interesting.
  const statusLabel = (s: StudentRow) => {
    if (!s.is_active) return "Inactive";
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
      {levelError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {levelError}
        </div>
      )}
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
            <Th>Level</Th>
            <Th>Parent</Th>
            <Th>Status</Th>
            <Th>Class</Th>
            <Th>Coach</Th>
            <Th>Actions</Th>
          </tr>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={7}>
                Loading…
              </Td>
            </Tr>
          ) : filtered.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={7}>
                No students found.
              </Td>
            </Tr>
          ) : (
            filtered.map((s) => (
              <Tr key={s.id}>
                <Td className="font-medium text-gray-900">{s.full_name}</Td>
                <Td>
                  {/* Inline rather than behind a modal: placing a child on the
                      ladder is a glance-and-set action, and an admin doing it
                      for a new intake would otherwise open a dialog per child. */}
                  <select
                    value={s.level_id ?? ""}
                    onChange={(e) => setLevel(s, e.target.value || null)}
                    disabled={levels.length === 0 || savingLevelFor === s.id}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:opacity-50"
                  >
                    <option value="">
                      {levels.length === 0 ? "No levels defined" : "—"}
                    </option>
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </Td>
                <Td className="text-gray-500">{s.parent_name}</Td>
                <Td>
                  <StatusBadge status={statusLabel(s)} />
                </Td>
                <Td className="text-gray-500">{s.class_title ?? "—"}</Td>
                <Td className="text-gray-500">{s.coach_name ?? "—"}</Td>
                <Td>
                  <div className="flex gap-2">
                    {s.is_active && s.class_title && (
                      <button
                        onClick={() => setPending({ student: s, mode: "remove" })}
                        disabled={busyId === s.id}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Remove from class
                      </button>
                    )}
                    {s.is_active && (
                      <button
                        onClick={() => openInactive(s)}
                        disabled={busyId === s.id}
                        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Set inactive
                      </button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      <Modal
        title={
          pending?.mode === "inactive"
            ? `Set ${pending.student.full_name} inactive?`
            : `Remove ${pending?.student.full_name} from their class?`
        }
        open={pending !== null}
        onClose={() => setPending(null)}
      >
        {pending && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {pending.mode === "inactive"
                ? "They stop appearing on rosters and stop counting toward attendance. Any active class enrolment is closed at the same time."
                : "They return to Unassigned for you to place in another class. Their enrolment is closed, not deleted."}
            </p>
            {/* Siblings are a CHOICE — the admin may be removing one child
                while the others keep attending. Only shown when there are any. */}
            {pending.mode === "inactive" && siblings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                <p className="text-sm font-medium text-amber-900">
                  {siblings.length === 1
                    ? `${siblings[0].full_name} is also in this family.`
                    : `${siblings.map((c) => c.full_name).join(", ")} are also in this family.`}
                </p>
                <label className="flex items-start gap-2 text-sm text-amber-900">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={!takeSiblings}
                    onChange={() => setTakeSiblings(false)}
                  />
                  <span>
                    Just {pending.student.full_name}
                    {siblings.length === 1
                      ? ` — ${siblings[0].full_name} keeps attending`
                      : " — the others keep attending"}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-amber-900">
                  <input
                    type="radio"
                    className="mt-1"
                    checked={takeSiblings}
                    onChange={() => setTakeSiblings(true)}
                  />
                  <span>All {family.length} children in this family</span>
                </label>
              </div>
            )}

            {/* The family outcome is a CONSEQUENCE, not a question — a family
                with no active children here is no longer a customer here. So it
                is stated, not asked. */}
            {pending.mode === "inactive" && lastActive && (
              <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                That leaves no active children, so{" "}
                <strong>{pending.student.parent_name}</strong> will be marked
                inactive at this business too. They can rejoin any time with your
                join code.
              </p>
            )}

            <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Attendance and billing history are kept, and lessons they have
              already attended this month will still be invoiced. Any credit
              balance is untouched.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={busyId !== null}
                onClick={() => handleStatusChange(pending.student, pending.mode)}
              >
                {pending.mode === "inactive" ? "Set inactive" : "Remove"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {actionError && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </p>
      )}
    </div>
  );
}
