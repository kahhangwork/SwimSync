// Slice 7 — add a student whose parent has not registered, with the advisory
// duplicate check. Stage 7 of docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md.
// Lifted from page.tsx intact.
//
// The other half of PRD §7.17: the coach's walk-in form handles a TRIAL (one
// lesson, marked on the spot), and this handles the ONGOING case — a child
// who is already attending weekly while their parent takes their time
// signing up. Both go through add_unclaimed_student(); only the enrolment
// lifecycle differs.

import { useEffect, useState } from "react";
import { useStartsOn } from "@/components/StartsOnField";
import * as rpc from "../dao/students.rpc";
import type { RosterCandidate } from "./rosterDuplicates";

// Wave 4 (20261005000100): add_unclaimed_student takes an optional p_starts_on
// — a child who already swam before the admin added them.
export function useAddStudent(tenantId: string | null, reload: () => Promise<void>) {
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addDob, setAddDob] = useState("");
  const [addClassId, setAddClassId] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // The Add-student duplicate warning (ADD_STUDENT_DUP_WARNING_PLAN.md).
  // `addDupCandidates` are possible duplicates find_roster_duplicates() returned;
  // `addConfirmed` arms the second, "Add anyway" click once they have been shown.
  const [addDupCandidates, setAddDupCandidates] = useState<RosterCandidate[]>([]);
  const [addConfirmed, setAddConfirmed] = useState(false);
  const start = useStartsOn(addClassId || null);

  // ⚠ RISK 6: any edit to the identifying fields re-arms the check — a warning
  // the admin saw for "Anya / 9111 2222" must not carry over to a different
  // child. Structural reset, not a reminder: the confirm token and the shown
  // candidates both clear whenever name / phone / DOB change.
  useEffect(() => {
    setAddConfirmed(false);
    setAddDupCandidates([]);
  }, [addName, addPhone, addDob]);

  // Blank the whole Add form, including the duplicate-warning state. Called on
  // open, on close, and after a successful add, so a stale warning + pre-armed
  // "Add anyway" button can never carry from one child to the next.
  function resetAddForm() {
    setAddName("");
    setAddDob("");
    setAddClassId("");
    setAddPhone("");
    setAddEmail("");
    setAddDupCandidates([]);
    setAddConfirmed(false);
    setAddError(null);
    start.reset();
  }

  function open() {
    resetAddForm();
    setAddOpen(true);
  }

  function close() {
    setAddOpen(false);
    resetAddForm();
  }

  async function handleAddStudent() {
    const name = addName.trim();
    // Phone is required (the button enforces it too) — it is the strongest
    // duplicate signal, so never add without it.
    if (!name || !addClassId || !addPhone.trim()) return;
    // RISK 1: a start in an earlier, unbilled month needs a second press.
    if (start.holdForConfirmation()) return;
    setAddBusy(true);
    setAddError(null);

    // ⚠ RISK 1/3/4: the duplicate WARNING. Advisory, and it FAILS OPEN — an
    // error or a refusal from find_roster_duplicates() must never block the add
    // (students_identity_uniq is the real floor). On the FIRST click, if it
    // finds candidates, show them and stop; `addConfirmed` then lets the second
    // "Add anyway" click through. A phone match never hard-blocks — siblings
    // share a parent phone, which is why this is a prompt, not a refusal.
    if (!addConfirmed) {
      try {
        const { data, error } = await rpc.findRosterDuplicates({
          p_tenant_id: tenantId,
          p_full_name: name,
          p_phone: addPhone.trim() || null,
          p_dob: addDob || null,
        });
        if (!error && Array.isArray(data) && data.length > 0) {
          setAddDupCandidates(data as RosterCandidate[]);
          setAddConfirmed(true);
          setAddBusy(false);
          return;
        }
      } catch {
        // Fail open: fall through to the insert. The warning is a courtesy.
      }
    }

    // p_kind: 'ongoing' — an OPEN enrolment, because this child attends every
    // week. That means they also join the completeness gate, which is correct:
    // from now on the coach must mark them, and a forgotten lesson blocks
    // billing rather than vanishing.
    //
    // No session date and no attendance status: those belong to the trial
    // path. The enrolment starts TODAY unless the admin chose an earlier
    // "Starts on" (a child who already swam) — then lessons from that date are
    // expected, and must be marked before their month can bill.
    const { error } = await rpc.addUnclaimedStudent({
      p_class_id: addClassId,
      p_full_name: name,
      p_kind: "ongoing",
      p_date_of_birth: addDob || null,
      p_contact_phone: addPhone.trim() || null,
      p_contact_email: addEmail.trim() || null,
      p_starts_on: start.startsOnParam(),
    });

    setAddBusy(false);
    if (error) {
      // The RPC returns a plain sentence for a duplicate name+DOB rather than
      // a raw constraint error (PRD §5.1) — show it as-is.
      setAddError(error.message);
      return;
    }

    setAddOpen(false);
    resetAddForm();
    await reload();
  }

  return {
    addOpen,
    addName,
    setAddName,
    addDob,
    setAddDob,
    addClassId,
    setAddClassId,
    addPhone,
    setAddPhone,
    addEmail,
    setAddEmail,
    addBusy,
    addError,
    addDupCandidates,
    addConfirmed,
    start,
    open,
    close,
    handleAddStudent,
  };
}

export type AddStudentState = ReturnType<typeof useAddStudent>;
