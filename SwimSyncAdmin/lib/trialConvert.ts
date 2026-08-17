// Converting a trial to an enrolment — the decision logic, kept pure so it can
// be tested without a live database.
//
// ⚠ RISK 1 (WAVE_C_PLAN.md) — enrolling is FOREVER; a trial is one lesson. An
// active enrolment makes the child expected at EVERY lesson of the class, and an
// unmarked lesson blocks invoice generation outright with NO override. The past
// trial being converted is harmless on its own — it is in the past. The hazard is
// a SECOND, still-upcoming trial the family rebooked: enrolling then stacks an
// enrolment on top of a live unmarked booking, and the billing month silently
// stalls. So a future live trial forces a two-press confirmation.

export type ConvertGuardInput = {
  /** Does the child have an uncancelled trial booked for today or later? */
  hasFutureTrial: boolean;
  /** Has the admin already pressed once and seen the warning? */
  alreadyConfirmed: boolean;
};

/** True when the admin must confirm before the enrolment is written. Blocks only
 *  the first press when a future trial exists — the second press proceeds. */
export function needsConvertConfirmation({
  hasFutureTrial,
  alreadyConfirmed,
}: ConvertGuardInput): boolean {
  return hasFutureTrial && !alreadyConfirmed;
}
