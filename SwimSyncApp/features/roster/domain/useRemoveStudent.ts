// Removing a child from THIS class, from the coach's roster
// (COACH_ROSTER_REFACTOR_PLAN.md, Stage 4) — moved verbatim from
// app/(coach)/classes/[id]/roster.tsx. `showToast` is read from the store HERE,
// never on the route: the store is a domain/ import only (fence check 4).
//
// ⚠ NO DRIVER PRESSES REMOVE. It was hand-checked against the database at
// Stage 4 (plan §11a); BACKLOG carries the missing verify-coach-remove-student.
import { useState } from "react";
import { confirmAction } from "@/lib/confirm";
import { useAppStore } from "@/store/useAppStore";
import type { Student } from "@/features/roster/types";
import { removeStudentFromClass } from "@/features/roster/dao/roster.rpc";

export function useRemoveStudent(id: string, loadData: () => Promise<void>) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const showToast = useAppStore((s) => s.showToast);

  // Removing a student closes their enrolment; it never deletes anything.
  // Their past attendance still bills (the invoice engine reads attendance
  // rows, not current enrolment), and they drop out of the completeness check
  // so a child who has stopped coming can no longer block invoicing.
  // confirmAction, not Alert.alert — Alert is a no-op on the web build.
  const handleRemove = (student: Student) => {
    confirmAction(
      "Remove from class?",
      `${student.full_name} will be removed from THIS class. Any other class they attend is untouched, and they return to the admin's unassigned list only if this was their last one. Lessons they have already attended are still billed, and their history is kept.`,
      async () => {
        setRemovingId(student.id);
        // `id` — this screen's own class, never the child's "the" class. Since
        // Wave 2 a child may be in several, and the roster a coach is looking at
        // is the only one they have any business closing.
        const { error } = await removeStudentFromClass(student.id, id);
        setRemovingId(null);
        if (error) {
          showToast(`Could not remove ${student.full_name}.`, "error");
          return;
        }
        showToast(`${student.full_name} removed from this class.`, "success");
        loadData();
      },
      "Remove"
    );
  };

  return { removingId, handleRemove };
}
