/**
 * The INSERT payload for a student_settlements row, shared by the unclaimed
 * modal and the orphan-lesson report so the two settle paths cannot drift.
 *
 * Mirrors the DB CHECK `settlement_amount_matches_kind` (20260725000100):
 * paid_outside MUST carry an amount, written_off MUST NOT. The kind decides —
 * a written_off row silently drops whatever amount the caller passed rather
 * than sending a payload the CHECK refuses with a constraint error the admin
 * cannot read.
 */
export function settlementPayload(args: {
  tenantId: string;
  studentId: string;
  /** Attendance ON OR BEFORE this date is settled — the line's LATEST lesson,
   *  never "today": the settlement covers exactly what was reported. */
  settledThrough: string;
  kind: "paid_outside" | "written_off";
  amount: number | null;
  recordedBy: string | undefined;
}) {
  const paid = args.kind === "paid_outside";
  return {
    tenant_id: args.tenantId,
    student_id: args.studentId,
    settled_through: args.settledThrough,
    kind: args.kind,
    amount: paid ? args.amount : null,
    method: paid ? "Outside SwimSync" : null,
    recorded_by: args.recordedBy,
  };
}
