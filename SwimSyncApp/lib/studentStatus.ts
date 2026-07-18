// Removing a child from a class, and marking a child inactive.
//
// Both go through the close_student_enrolment() SECURITY DEFINER function
// (migration 20260718000200) rather than table writes, because the operation
// spans student_class_enrolments + students + audit_log and needs to be
// callable by a COACH as well as the superadmin — coaches have no UPDATE on
// students, and granting it would let them edit names and DOBs too.
//
// DUPLICATED byte-for-byte in SwimSyncApp/lib/studentStatus.ts, deliberately:
// there is no shared package (separate npm projects, different bundlers) — the
// same rationale as lib/lessonDates.ts. It has no imports, so drift is cheap
// to spot with `diff`. EDIT BOTH.

/** Minimal shape of a supabase-js client — avoids importing either app's.
 *  `rpc()` returns a thenable query builder rather than a bare Promise, so the
 *  result is typed as awaitable rather than as Promise. */
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ error: { message: string } | null }>;
};

/**
 * Remove a child from their class. They return to the Unassigned pool for the
 * admin to reassign; the enrolment is CLOSED, never deleted, so attendance and
 * billing history survive (PRD 11.5) and any credit is untouched (PRD 11.8).
 * Lessons they already attended still bill — the invoice engine reads
 * attendance rows, not current enrolment.
 */
export async function removeFromClass(
  db: RpcClient,
  studentId: string
): Promise<{ error?: string }> {
  const { error } = await db.rpc("close_student_enrolment", {
    p_student_id: studentId,
    p_set_inactive: false,
  });
  return error ? { error: error.message } : {};
}

/**
 * Mark a child inactive — they have left. Closes any active enrolment as part
 * of the same call, which is also what unblocks invoicing: an open enrolment
 * for a child who no longer attends keeps their class permanently incomplete.
 */
export async function setStudentInactive(
  db: RpcClient,
  studentId: string
): Promise<{ error?: string }> {
  const { error } = await db.rpc("close_student_enrolment", {
    p_student_id: studentId,
    p_set_inactive: true,
  });
  return error ? { error: error.message } : {};
}
