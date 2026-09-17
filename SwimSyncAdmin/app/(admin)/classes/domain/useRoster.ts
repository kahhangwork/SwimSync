import { useMemo, useState } from "react";
import { todayInSg } from "@/lib/lessonDates";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import {
  buildClassRoster,
  type RosterEnrolment,
  type RosterBooking,
} from "./classRoster";
import * as repo from "../dao/classes.repo";
import * as rpc from "../dao/classes.rpc";
import type { ClassRow } from "../types";

/**
 * Who is in each class — the drawer's contents, and the "+1" on the badge.
 *
 * ⚠ THE ROSTER IS FETCHED SEPARATELY FROM THE CLASS LIST (§7.52 / repo). An
 * error here leaves the table intact and shows an explicit message inside the
 * drawer: a roster we could not read must never be indistinguishable from a
 * class with nobody in it. `rosterByClass` is the ONE derivation the badge and
 * the drawer both read, so the "+N" and the names it promises can never
 * disagree. todayInSg() is read HERE, in the hook, and passed pure into
 * buildClassRoster (§7.7 / RISK 6 — classRoster.ts touches no clock).
 */
export function useRoster(classes: ClassRow[]) {
  const [enrolments, setEnrolments] = useState<RosterEnrolment[]>([]);
  const [bookings, setBookings] = useState<RosterBooking[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(new Map());

  async function loadRoster() {
    const today = todayInSg();
    // Payment-method chips for the drawer. Fire-and-forget: a failed RPC only
    // means no chips, never a roster error.
    rpc
      .studentPackageCoverage()
      .then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])));
    // Two reads, fetched SEPARATELY from the class list on purpose (§7.52 — see
    // dao). `today` is read here, in the hook's job, and passed down.
    const [{ data: enr, error: enrErr }, { data: bk, error: bkErr }] =
      await Promise.all([
        repo.loadEnrolments(),
        repo.loadUpcomingBookings(today),
      ]);

    if (enrErr || bkErr) {
      setRosterError((enrErr ?? bkErr)!.message);
      return;
    }
    setRosterError(null);

    setEnrolments(
      (enr ?? []).map((e: any) => ({
        class_id: e.class_id,
        is_active: e.is_active,
        enrolled_at: e.enrolled_at,
        student_id: e.student_id,
        full_name: e.students?.full_name ?? "—",
        // Read off the JOINED tenant_levels row, never off the student: the
        // student carries only the id, and a level's label is the business's
        // own vocabulary.
        level_label: e.students?.tenant_levels?.label ?? null,
      }))
    );
    setBookings(
      (bk ?? []).map((b: any) => ({
        class_id: b.class_id,
        session_date: b.session_date,
        student_id: b.student_id,
        cancelled_at: b.cancelled_at ?? null,
        full_name: b.students?.full_name ?? "—",
        level_label: b.students?.tenant_levels?.label ?? null,
      }))
    );
  }

  // One roster per class, derived once. The badge's "+N" and the drawer's list
  // read the SAME object. todayInSg() is read here — the caller's job — and
  // passed down; classRoster.ts itself touches no clock (§7.7).
  const rosterByClass = useMemo(() => {
    const today = todayInSg();
    const map = new Map<string, ReturnType<typeof buildClassRoster>>();
    for (const c of classes) {
      map.set(c.id, buildClassRoster(enrolments, bookings, c.id, today));
    }
    return map;
  }, [classes, enrolments, bookings]);

  return { enrolments, bookings, rosterError, covMap, rosterByClass, loadRoster };
}
