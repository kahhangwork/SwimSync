// Set or clear a child's date of birth from the Students page (20261118000100). Modelled on useGender: the admin's
// only sanctioned path is set_student_date_of_birth(), never a raw `.update({ date_of_birth })`. The RPC derives the
// tenant from the row, refuses a future date, a (name, DOB) duplicate and a change under a pending claim, and the
// students audit trigger records the change.
//
// Until this existed a wrong DOB could not be fixed after the child was added — one reason an admin "had to delete
// the whole child record and recreate it" (user feedback, 2026-11-18).

import { useState } from "react";
import * as rpc from "../dao/students.rpc";
import type { StudentRow } from "../types";

export function useDob(reload: () => Promise<void>) {
  const [dobFor, setDobFor] = useState<StudentRow | null>(null);
  const [dob, setDob] = useState("");
  const [dobBusy, setDobBusy] = useState(false);
  const [dobError, setDobError] = useState<string | null>(null);

  function openDob(student: StudentRow) {
    setDobFor(student);
    setDob(student.date_of_birth ?? "");
    setDobError(null);
  }

  async function handleSaveDob() {
    if (!dobFor) return;
    setDobBusy(true);
    setDobError(null);
    // An emptied field CLEARS the DOB — it is optional when a child is added, so clearing is a real correction.
    const { error } = await rpc.setStudentDateOfBirth(dobFor.id, dob === "" ? null : dob);
    setDobBusy(false);
    if (error) {
      // The RPC's refusals are written for the admin — surfaced verbatim.
      setDobError(error.message);
      return;
    }
    setDobFor(null);
    await reload();
  }

  return {
    dobFor,
    dob,
    setDob,
    dobBusy,
    dobError,
    openDob,
    close: () => setDobFor(null),
    handleSaveDob,
  };
}

export type DobState = ReturnType<typeof useDob>;
