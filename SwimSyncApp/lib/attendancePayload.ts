// The rows the Mark Attendance screen sends in ONE upsert.
//
// ── EVERY ROW MUST CARRY EXACTLY THE SAME KEYS ──────────────────────────────
// This is the whole reason this file exists, and it is a PostgREST/supabase-js
// contract rather than anything about swimming.
//
// `.upsert(rows)` derives the `columns=` query parameter from the UNION of the
// keys across every row. PostgREST then feeds the body through
// `json_populate_recordset` against that column list — so a row that OMITS a
// key does not fall back to the column DEFAULT, it gets **NULL**.
//
// The screen used to add `id` only for students who already had an attendance
// row:
//
//     ...(state.existingId ? { id: state.existingId } : {}),
//
// On a lesson where SOME students were marked and others were not, that made
// the key sets differ, `id` entered the column list, and the unmarked students
// were inserted with `id = NULL` — against `attendance.id uuid NOT NULL
// DEFAULT gen_random_uuid()`. Postgres refused the whole statement:
//
//     23502  null value in column "id" of relation "attendance"
//            violates not-null constraint
//
// One partially-marked lesson therefore became permanently unmarkable, and the
// coach saw only "Failed to save attendance. Please try again." A fully
// unmarked lesson saved fine (no row had `id`), and so did a fully marked one
// (every row did) — which is why this looked like "only 19 July is broken".
//
// ── AND `id` WAS NEVER NEEDED ───────────────────────────────────────────────
// `onConflict: "lesson_session_id,student_id"` is what identifies an existing
// row; that pair is a UNIQUE constraint. Sending the primary key as well told
// PostgREST nothing it did not already know. Verified against local PostgREST:
// omitting `id` returns 201, the existing row KEEPS its id (it is not in the
// payload, so it is not in the DO UPDATE SET), and a genuinely new row gets one
// from the column default.
//
// So the rule is simply: build every row from one object literal with no
// conditional keys. If a future column is genuinely per-student-optional, send
// it explicitly as `null` for the others rather than omitting it. See §7.67.

/** A status already resolved to its database value. */
export type AttendanceRowInput = {
  studentId: string;
  /** e.g. "present" | "absent" | "cancelled_rain" — validated by the caller. */
  status: string;
};

export type AttendanceRow = {
  lesson_session_id: string;
  student_id: string;
  status: string;
  marked_by: string;
  last_edited_by: string;
};

/**
 * Build the upsert body for a whole class in one statement.
 *
 * Deliberately returns a fixed-shape object per row — no spreads, no
 * conditional keys — so the key sets cannot drift apart.
 */
export function buildAttendanceRows(
  sessionId: string,
  actorProfileId: string,
  entries: readonly AttendanceRowInput[]
): AttendanceRow[] {
  return entries.map((e) => ({
    lesson_session_id: sessionId,
    student_id: e.studentId,
    status: e.status,
    marked_by: actorProfileId,
    last_edited_by: actorProfileId,
  }));
}

/**
 * Do all rows share one key set? True for an empty list.
 *
 * Exposed so the invariant can be asserted directly in a test rather than
 * inferred from the shape of the builder — the failure it guards against is
 * invisible in the client and only appears as a Postgres NOT NULL violation.
 */
export function hasUniformKeys(rows: readonly object[]): boolean {
  if (rows.length === 0) return true;
  const expected = Object.keys(rows[0]).sort().join(",");
  return rows.every((r) => Object.keys(r).sort().join(",") === expected);
}
