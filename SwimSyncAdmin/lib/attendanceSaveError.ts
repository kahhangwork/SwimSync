// Maps an attendance-upsert failure to the toast the coach should see.
//
// ⚠ CN001 (20260818000100): the credit-note trigger REFUSES to un-correct a
// lesson whose credit is already applied to an invoice. The save is ONE batch
// upsert of the whole roster, so that one refused row rolls back every change —
// the message must say so and name the recovery, not the generic retry-forever
// line that leaves the coach stuck.
export function attendanceSaveErrorMessage(code: string | undefined): string {
  if (code === "CN001") {
    return "This lesson's credit was already applied to an invoice, so re-marking it present was refused. None of your changes were saved — ask your admin to void this lesson's credit note on the Credit Notes page, then mark it again.";
  }
  return "Failed to save attendance. Please try again.";
}
