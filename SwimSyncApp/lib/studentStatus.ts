// Removing a child from a class, and marking children / families inactive.
//
// Everything here goes through SECURITY DEFINER functions rather than table
// writes, because each operation spans several tables and must be callable by a
// COACH as well as the business's admin — coaches have no UPDATE on students,
// and granting it would let them edit names and DOBs too (RLS is row-level, not
// column-level). `parent_tenants` has no UPDATE policy at all, so the RPC is
// the only path that exists.
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
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type FamilyChild = {
  student_id: string;
  full_name: string;
  is_self: boolean;
};

/**
 * Remove a child from their class. They return to the Unassigned pool for the
 * admin to reassign; the enrolment is CLOSED, never deleted, so attendance and
 * billing history survive (PRD 11.5) and any credit is untouched (PRD 11.8).
 * Lessons they already attended still bill — the invoice engine reads
 * attendance rows, not current enrolment.
 *
 * This does NOT change whether they are an active customer. A child can be
 * active but unassigned — a new signup waiting for a class is exactly that.
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
 * Who else is in this family AT THIS BUSINESS, and still active?
 *
 * Read BEFORE anything is written, so the admin confirms a NAMED set of
 * children rather than a count that could change underneath them — and so the
 * set they confirmed is exactly the set passed to setStudentsActive().
 *
 * A sibling at a different business never appears: that family's relationship
 * with another coach is not this admin's to end.
 */
export async function familyActiveChildren(
  db: RpcClient,
  studentId: string
): Promise<{ children: FamilyChild[]; error?: string }> {
  const { data, error } = await db.rpc("family_active_children", {
    p_student_id: studentId,
  });
  if (error) return { children: [], error: error.message };
  return { children: (data as FamilyChild[]) ?? [] };
}

/**
 * Mark children inactive (or active again) — the SOLE writer of that fact.
 *
 * Deactivating also closes each child's enrolment, which is what unblocks
 * invoicing: an open enrolment for a child who no longer attends keeps their
 * class permanently incomplete and stops the whole business billing.
 *
 * The FAMILY follows as a consequence, not as a second decision: once no active
 * children remain at that business the family goes inactive there too, and
 * reactivating any child brings the family back. Deliberately one-way and
 * event-shaped — see migration 20260719001200 for why this must not become a
 * trigger (it would undo join-code reactivation).
 *
 * Reactivating restores status ONLY. Children are not re-enrolled; the admin
 * places them deliberately, because guessing the class is how you get a wrong
 * roster.
 */
export async function setStudentsActive(
  db: RpcClient,
  studentIds: string[],
  active: boolean
): Promise<{ error?: string }> {
  const { error } = await db.rpc("set_students_active", {
    p_student_ids: studentIds,
    p_active: active,
  });
  return error ? { error: error.message } : {};
}

/** Single-child convenience over setStudentsActive. */
export async function setStudentInactive(
  db: RpcClient,
  studentId: string
): Promise<{ error?: string }> {
  return await setStudentsActive(db, [studentId], false);
}

/**
 * Mark a whole family active/inactive at one business, from the Parents page.
 * `studentIds` is passed explicitly for the same reason as above — the admin
 * confirmed a named list and that list is what gets written.
 */
export async function setFamilyActive(
  db: RpcClient,
  parentId: string,
  tenantId: string,
  active: boolean,
  studentIds: string[]
): Promise<{ error?: string }> {
  const { error } = await db.rpc("set_parent_tenant_active", {
    p_parent_id: parentId,
    p_tenant_id: tenantId,
    p_active: active,
    p_student_ids: studentIds,
  });
  return error ? { error: error.message } : {};
}
