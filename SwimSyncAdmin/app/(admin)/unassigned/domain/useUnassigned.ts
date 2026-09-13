// Unassigned page — all state and orchestration. The page composes this hook.

import { useEffect, useState } from "react";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import type { ClassOption, Coach, Student } from "../types";
import * as repo from "../dao/unassigned.repo";
import { loadCoverage } from "../dao/unassigned.rpc";
import {
  filterStudents,
  toClassOptions,
  toCoaches,
  toStudents,
} from "./unassignedRows";

export function useUnassigned() {
  const [students, setStudents] = useState<Student[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [assignModal, setAssignModal] = useState<Student | null>(null);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(new Map());
  const [selectedCoachId, setSelectedCoachId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  // Two-press confirm for the one case that can silently block a billing
  // month. Reset whenever the modal closes or a different child is chosen.
  const [confirmedTrialEnrol, setConfirmedTrialEnrol] = useState(false);

  useEffect(() => {
    loadStudents();
    loadCoaches();
  }, []);

  async function loadStudents() {
    setLoading(true);
    loadCoverage().then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])));
    const { data } = await repo.loadUnassignedStudents();

    const { data: upcoming } = await repo.loadUpcomingTrials();
    const awaitingTrial = new Set(
      (upcoming ?? []).map((b: any) => b.student_id as string)
    );

    setStudents(toStudents((data ?? []) as any[], awaitingTrial));
    setLoading(false);
  }

  async function loadCoaches() {
    const { data } = await repo.loadCoaches();
    setCoaches(toCoaches((data ?? []) as any[]));
  }

  async function loadClassesForCoach(coachId: string) {
    const { data } = await repo.loadClassesForCoach(coachId);
    setClassOptions(toClassOptions((data ?? []) as any[]));
  }

  async function handleAssign() {
    if (!assignModal || !selectedClassId) return;
    setAssigning(true);
    setAssignError(null);

    // ⚠ ENROLLING IS FOREVER; A TRIAL IS ONE LESSON. An active enrolment makes
    // this child expected at EVERY lesson of the class from now on, and
    // unmarked attendance blocks invoice generation outright with no override
    // — so enrolling a child who is only trying one lesson can silently stop
    // the business billing that class's month.
    //
    // The list above already excludes children with an upcoming trial, so this
    // should be unreachable from a fresh page. It is here because a page
    // loaded BEFORE the trial was booked still holds the old list, and the
    // cost of being wrong is a blocked billing month.
    const { data: liveTrial } = await repo.loadLiveTrial(assignModal.id);

    if ((liveTrial ?? []).length > 0 && !confirmedTrialEnrol) {
      setAssignError(
        `${assignModal.full_name} already has a trial booked for ${liveTrial![0].session_date}. ` +
          `They are expected at that lesson only — you do not need to assign them. ` +
          `Enrolling makes them expected EVERY week, and an unmarked lesson blocks invoicing. ` +
          `Press Assign again if you really mean to enrol them permanently.`
      );
      setConfirmedTrialEnrol(true);
      setAssigning(false);
      return;
    }

    const { error: enrolError } = await repo.insertEnrolment(
      assignModal.id,
      selectedClassId
    );

    if (enrolError) {
      setAssignError(enrolError.message);
      setAssigning(false);
      return;
    }

    await repo.markAssigned(assignModal.id);

    setAssignModal(null);
    setSelectedCoachId("");
    setSelectedClassId("");
    setConfirmedTrialEnrol(false);
    setAssigning(false);
    loadStudents();
  }

  function openAssign(student: Student) {
    setAssignModal(student);
    setSelectedCoachId("");
    setSelectedClassId("");
    setAssignError(null);
  }

  function closeAssign() {
    setAssignModal(null);
    setConfirmedTrialEnrol(false);
    setAssignError(null);
  }

  function selectCoach(coachId: string) {
    setSelectedCoachId(coachId);
    setSelectedClassId("");
    if (coachId) loadClassesForCoach(coachId);
  }

  const filtered = filterStudents(students, search);

  return {
    students,
    coaches,
    classOptions,
    loading,
    search,
    setSearch,
    assignModal,
    covMap,
    selectedCoachId,
    selectedClassId,
    setSelectedClassId,
    assigning,
    assignError,
    handleAssign,
    openAssign,
    closeAssign,
    selectCoach,
    filtered,
  };
}
