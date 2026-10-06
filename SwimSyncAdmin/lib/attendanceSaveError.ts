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
  return "Failed to save attendance. Please try again.";
}
