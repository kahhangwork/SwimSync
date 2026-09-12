// The page title, the active/inactive count, and the Add-student button.
// Stage 11 of docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Verbatim from
// page.tsx.

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { formatActiveStudents } from "@/lib/studentCounts";
import type { StudentRow } from "../types";

export function StudentsHeader(p: { students: StudentRow[]; onAdd: () => void }) {
  // `load()` deliberately still fetches inactive children — the All tab lists
  // them. So the header describes a SUBSET of the rows on screen, and the
  // "· N inactive" suffix is what explains the difference.
  //
  // `students.is_active` only. NOT the family's `parent_tenants.is_active`: a
  // family can be inactive while still holding an active child, and §7.61 makes
  // that deliberately unreconciled — cascading family status into this count
  // would make a still-swimming child disappear from it.
  const activeStudentCount = p.students.filter((s) => s.is_active).length;
  const inactiveStudentCount = p.students.length - activeStudentCount;
  return (
    <PageHeader
      title="Students"
      subtitle={formatActiveStudents(activeStudentCount, inactiveStudentCount)}
      action={<Button onClick={p.onAdd}>Add student</Button>}
    />
  );
}
