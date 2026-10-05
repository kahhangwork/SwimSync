import { useState } from "react";
import { useStartsOn } from "@/components/StartsOnField";
import { droppedDates } from "@/lib/enrolmentStart";
import { setEnrolmentStart } from "@/lib/enrolmentStart.rpc";
import { toSgDate } from "@/lib/lessonDates";

export interface ChangeStartTarget {
  studentId: string;
  fullName: string;
  classId: string;
  classTitle: string;
  /** The enrolment's current enrolled_at (timestamptz). */
  enrolledAt: string;
}

/**
 * "Change start date" on the class roster (Wave 4, D2/D9). The 04 Oct 2026 case
 * was found AFTER the child was added; until this, the only fix was SQL on
 * production (DEPLOYMENT #62). set_enrolment_start(mode 'change') owns every
 * rule — a later start past a marked lesson is refused there, verbatim here.
 *
 * ⚠ RISK 6: a LATER start makes lessons stop being expected. `dropped` lists
 * them so the dialog says so — it is not a way to clear unmarked lessons.
 */
export function useChangeStart(onDone: () => Promise<void> | void) {
  const [target, setTarget] = useState<ChangeStartTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useStartsOn(target?.classId ?? null);
  const current = target ? toSgDate(target.enrolledAt) : "";

  function open(t: ChangeStartTarget) {
    setTarget(t);
    setError(null);
    start.reset(toSgDate(t.enrolledAt));
  }

  function close() {
    setTarget(null);
    setError(null);
  }

  async function save() {
    if (!target || start.value === current) return;
    // RISK 1's second press is for a start that ADDS expected lessons in an
    // unbilled month. A later start only removes them (listed in `dropped`).
    if (start.value < current && start.holdForConfirmation()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await setEnrolmentStart(
      target.studentId,
      target.classId,
      start.startsOnParam(),
      "change"
    );
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setTarget(null);
    await onDone();
  }

  return {
    target,
    current,
    start,
    dropped: droppedDates(start.bounds.dayOfWeek, current, start.value),
    busy,
    error,
    open,
    close,
    save,
  };
}

export type ChangeStartState = ReturnType<typeof useChangeStart>;
