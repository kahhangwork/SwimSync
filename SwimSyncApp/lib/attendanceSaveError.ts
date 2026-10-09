// Maps an attendance-upsert failure to the toast the coach should see.
//
// ⚠ CN001 (20260818000100): the credit-note trigger REFUSES to un-correct a
// lesson whose credit is already applied to an invoice. The save is ONE batch
// upsert of the whole roster, so that one refused row rolls back every change —
// the message must say so and name the recovery, not the generic retry-forever
// line that leaves the coach stuck.
//
// ⚠ PK001 (Wave 6 D6): the package out-of-order guard refuses a present mark
// that would leave an earlier unmarked lesson unfundable. The DB's message names
// the date, child and class ("Mark 3 Oct first — …") and is the coach's ONLY
// route forward — the batch rolled back and the screen won't save with a child
// unmarked. Return it verbatim. PROHIBITION: no retry, no force, no per-row split.
//
// ⚠ P0001 from the MARKING-WINDOW guard (guard_attendance_date →
// assert_markable_date): a lesson below the floor, in the future, or cancelled.
// Retrying cannot work and the DB's message names the date, so return it. P0001
// is the code of ANY plpgsql RAISE, so pass through only the guard's own shape —
// "That lesson (<date>) …" — never every P0001.
const WINDOW_GUARD_MESSAGE = /^That lesson \([^)]+\) /;

export function attendanceSaveErrorMessage(
  code: string | undefined,
  dbMessage?: string
): string {
  if (code === "CN001") {
    return "This lesson's credit was already applied to an invoice, so re-marking it present was refused. None of your changes were saved — ask your admin to void this lesson's credit note on the Credit Notes page, then mark it again.";
  }
  if (code === "PK001") {
    return (
      dbMessage ||
      "A family package can't cover an earlier unmarked lesson. None of your changes were saved — mark the earlier lesson first, then this one."
    );
  }
  if (code === "P0001" && dbMessage && WINDOW_GUARD_MESSAGE.test(dbMessage)) {
    return dbMessage;
  }
  return "Failed to save attendance. Please try again.";
}
