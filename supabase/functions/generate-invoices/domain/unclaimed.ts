// Unclaimed attendance, reduced against settlements — moved verbatim out of
// generateForTenant (EDGE_FUNCTIONS_REFACTOR_PLAN.md B7). A REPORT only: it never
// touches the tally or any invoice arithmetic (the TRIPWIRE test in
// unclaimed.test.ts pins that).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import * as repo from "../dao/billing.repo.ts";
import type { UnclaimedStudent } from "../types.ts";

export async function reduceUnclaimed(
  supabase: SupabaseClient<Database>,
  unclaimedAttendance: readonly { student_id: string; session_date: string }[]
): Promise<{ unclaimedStudents: UnclaimedStudent[]; unclaimedBillable: number }> {
  // ── Reduce unclaimed attendance against settlements ───────────────────────
  // A settlement says money for this student was received outside SwimSync, or
  // written off. It is EFFECTIVE-DATED: it covers attendance on or before
  // settled_through and nothing after, so settling once cannot blanket-
  // authorise every future lesson. A reversed settlement covers nothing —
  // reversal exists because a parent who turns up two months after a write-off
  // must be recoverable.
  const unclaimedStudentIds = [
    ...new Set(unclaimedAttendance.map((u) => u.student_id)),
  ];

  let unclaimedStudents: UnclaimedStudent[] = [];
  if (unclaimedStudentIds.length) {
    const { data: settlements } = await repo.readSettlements(supabase, unclaimedStudentIds);

    // Latest live settlement per student — the furthest date any of them covers.
    const coveredThrough = new Map<string, string>();
    for (const st of settlements ?? []) {
      const prev = coveredThrough.get(st.student_id as string);
      const through = st.settled_through as string;
      if (!prev || through > prev) {
        coveredThrough.set(st.student_id as string, through);
      }
    }

    // String comparison is correct and deliberate: both sides are YYYY-MM-DD,
    // which sorts lexicographically. No Date object is constructed, so there is
    // no timezone to get wrong (§7.7).
    const unsettled = unclaimedAttendance.filter((u) => {
      const through = coveredThrough.get(u.student_id);
      return !through || u.session_date > through;
    });

    if (unsettled.length) {
      const { data: names } = await repo.readUnsettledNames(supabase, unsettled);
      const nameById = new Map(
        (names ?? []).map((n) => [n.id as string, n.full_name as string])
      );

      const byStudent = new Map<string, string[]>();
      for (const u of unsettled) {
        const dates = byStudent.get(u.student_id) ?? [];
        dates.push(u.session_date);
        byStudent.set(u.student_id, dates);
      }

      unclaimedStudents = [...byStudent.entries()]
        .map(([student_id, dates]) => {
          const sorted = [...dates].sort();
          return {
            student_id,
            student_name: nameById.get(student_id) ?? null,
            lessons: sorted.length,
            earliest_session_date: sorted[0],
            latest_session_date: sorted[sorted.length - 1],
          };
        })
        .sort((a, b) =>
          a.earliest_session_date.localeCompare(b.earliest_session_date)
        );
    }
  }

  const unclaimedBillable = unclaimedStudents.reduce(
    (sum, u) => sum + u.lessons,
    0
  );

  return { unclaimedStudents, unclaimedBillable };
}
