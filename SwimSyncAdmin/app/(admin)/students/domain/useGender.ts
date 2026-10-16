// Set a child's gender from the Students page (20261016000100). Modelled on useRename: the admin's only
// sanctioned path is set_student_gender(), never a raw `.update({ gender })`. The RPC derives the tenant from the
// row, refuses a view-only role, and the students audit trigger records the change.
//
// Opens with the child's RECORDED gender selected, or NOTHING when none is recorded — never a default
// (user, 2026-10-16: gender is required, never pre-selected). Save stays disabled until one is chosen.

import { useState } from "react";
import * as rpc from "../dao/students.rpc";
import type { Gender } from "@/lib/gender";
import type { StudentRow } from "../types";

/** A stored gender the picker can show, or "" — "other" (never offered) shows no segment and keeps its value. */
export function pickerValue(stored: string | null): Gender | "" {
  return stored === "male" || stored === "female" ? stored : "";
}

export function useGender(reload: () => Promise<void>) {
  const [genderFor, setGenderFor] = useState<StudentRow | null>(null);
  const [gender, setGender] = useState<Gender | "">("");
  const [genderBusy, setGenderBusy] = useState(false);
  const [genderError, setGenderError] = useState<string | null>(null);

  function openGender(student: StudentRow) {
    setGenderFor(student);
    setGender(pickerValue(student.gender));
    setGenderError(null);
  }

  async function handleSaveGender() {
    if (!genderFor || !gender) return;
    setGenderBusy(true);
    setGenderError(null);
    const { error } = await rpc.setStudentGender(genderFor.id, gender);
    setGenderBusy(false);
    if (error) {
      // The RPC's refusals are written for the admin — surfaced verbatim.
      setGenderError(error.message);
      return;
    }
    setGenderFor(null);
    await reload();
  }

  return {
    genderFor,
    gender,
    setGender,
    genderBusy,
    genderError,
    openGender,
    close: () => setGenderFor(null),
    handleSaveGender,
  };
}

export type GenderState = ReturnType<typeof useGender>;
