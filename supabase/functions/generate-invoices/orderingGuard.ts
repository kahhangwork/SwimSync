// ── The engine ordering-guard: never seal a LATER month over an earlier one ──
//
// THE BUG THIS CLOSES (BACKLOG "Sealing a LATER month strands an earlier unsealed
// one"). markable_floor() anchors on the LATEST sealed month, and the engine
// seals any completed month in any order. Bill September while August is still
// unbilled and the floor jumps past August: its unmarked lessons become
// unmarkable, the completeness gate names a lesson nobody can record, and the
// month can never bill — a permanent, override-less underbill (PRD §7.7).
//
// THE FIX. Prevent it at the source: refuse to bill month M for a tenant while
// an EARLIER unsealed month still has UNBILLED LESSONS, naming the earliest such
// month. The floor formula is untouched, so the coach's window is unchanged and
// sealed months are never re-exposed (that was why the "lower the floor"
// alternative was rejected — see docs/plans/CREDIT_NOTE_AND_MARKABLE_FLOOR_PLAN.md
// Item 1). In-order billing has NO earlier unsealed month, so this guard does
// nothing on the only path production has ever used.
//
// ⚠ FAIL SKIPPABLE, NEVER BLOCKING (RISK 1). A WRONGFUL block halts a real
// business's billing with no override — unrecoverable. A MISSED block is a
// late-marked lesson the §8.48 orphan report catches — recoverable. So every
// uncertainty here resolves to "does not block": a thrown query, an
// unclassifiable month, an unmarked lesson already below the floor. The polarity
// is the whole safety argument; do not invert it to "block on doubt".
//
// ⚠ THE PREDICATE MIRRORS core.ts's PER-CLASS COMPLETENESS BLOCK, byte-for-byte
// in its window derivation and its use of expectedStudentsOn() (§7.18 — "would
// this month bill?" and "does this month block?" must be one definition). The
// mirror is pinned by orderingGuard.test.ts's cross-check against the real engine
// verdict. If you change the window clamps in core.ts, change them here too.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  APP_TIMEZONE,
  dateInTimeZone,
  expectedLessonDates,
  previousBillingMonth,
} from "./dates.ts";
import {
  type EnrolmentSpan,
  expectedStudentsOn,
} from "./attendanceCompleteness.ts";
import { BILLABLE } from "./core.ts";

/** "YYYY-MM" → "YYYY-MM-01". */
function firstOfMonth(month: string): string {
  return `${month}-01`;
}

/** "YYYY-MM" → the last calendar day, "YYYY-MM-DD". */
function lastOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const day = new Date(y, m, 0).getDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** "YYYY-MM" one month later, year rollover safe. */
function addMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Ascending list of "YYYY-MM" from `from` to `to` inclusive ([] if from > to). */
function monthsInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  // Both are zero-padded "YYYY-MM", so lexical <= is chronological.
  while (cur <= to) {
    out.push(cur);
    cur = addMonth(cur);
    if (out.length > 600) break; // 50-year backstop; a runaway lower bound
  }
  return out;
}

/**
 * markable_floor() replicated in the engine (service_role cannot EXECUTE the SQL
 * function — 20260806000200 revokes it). Mirrors the SQL exactly:
 *   LEAST(1st of last month, COALESCE(month after latest sealed month, created_at))
 * so a date `>= floor` here is a date the coach can still mark there. Getting
 * this EARLIER than the true floor would risk blocking on an unmarkable lesson
 * (the unrecoverable direction), so it is pinned against the DB in the tests.
 */
export function computeMarkableFloor(
  now: Date,
  sealedMonths: readonly string[],
  createdAtSg: string
): string {
  const calendarFloor = firstOfMonth(previousBillingMonth(now));
  let second: string;
  if (sealedMonths.length > 0) {
    const maxSeal = [...sealedMonths].sort().at(-1) as string;
    second = firstOfMonth(addMonth(maxSeal));
  } else {
    second = createdAtSg;
  }
  return calendarFloor < second ? calendarFloor : second;
}

/**
 * Does month `E` have at least one lesson the engine would still bill? Read-only.
 *
 * Two arms, exactly the plan's predicate:
 *   arm 1 — a recorded present/trial_paid attendance (billable revenue). For an
 *           UNSEALED month nothing is invoiced yet, so any such row is unbilled.
 *   arm 2 — an unmarked expected/booked lesson whose date is still `>= floor`,
 *           i.e. a coach can still mark it. Below the floor it is already
 *           stranded (legacy, pre-guard) and must NOT block — that is a separate
 *           one-time remediation, not something this guard can cure.
 *
 * Empty / all-absent / holiday-marked-cancelled months hit neither arm and are
 * skippable. Any thrown query bubbles to the caller, which fails skippable.
 */
async function monthHasUnbilledLessons(
  supabase: SupabaseClient,
  classes: ReadonlyArray<{
    id: string;
    day_of_week: string;
    is_active: boolean;
    deactivated_at: string | null;
  }>,
  enrolmentsByClass: ReadonlyMap<string, EnrolmentSpan[]>,
  activeByClass: ReadonlyMap<string, Set<string>>,
  earliestEnrolmentByClass: ReadonlyMap<string, string | undefined>,
  month: string,
  todayDate: string,
  floor: string
): Promise<boolean> {
  const monthStart = firstOfMonth(month);
  const monthEnd = lastOfMonth(month);

  for (const cls of classes) {
    // ── Sessions for this class in the month ────────────────────────────────
    const { data: sessions, error: sErr } = await supabase
      .from("lesson_sessions")
      .select("id, session_date")
      .eq("class_id", cls.id)
      .gte("session_date", monthStart)
      .lte("session_date", monthEnd)
      .order("session_date");
    if (sErr) throw new Error(sErr.message);

    const sessionIds = (sessions ?? []).map((s) => s.id as string);
    const sessionByDate = new Map<string, string>(
      (sessions ?? []).map((s) => [s.session_date as string, s.id as string])
    );

    // ── Bookings (trial + make-up) for this class, merged like the engine ────
    const { data: trialRows, error: tErr } = await supabase
      .from("trial_bookings")
      .select("student_id, session_date")
      .eq("class_id", cls.id)
      .is("cancelled_at", null)
      .gte("session_date", monthStart)
      .lte("session_date", monthEnd);
    if (tErr) throw new Error(tErr.message);

    const { data: makeupRows, error: mErr } = await supabase
      .from("makeup_bookings")
      .select("student_id, session_date")
      .eq("class_id", cls.id)
      .is("cancelled_at", null)
      .gte("session_date", monthStart)
      .lte("session_date", monthEnd);
    if (mErr) throw new Error(mErr.message);

    const bookingsByDate = new Map<string, string[]>();
    for (const b of [...(trialRows ?? []), ...(makeupRows ?? [])]) {
      const d = b.session_date as string;
      const list = bookingsByDate.get(d) ?? [];
      list.push(b.student_id as string);
      bookingsByDate.set(d, list);
    }

    const enrolmentSpans = enrolmentsByClass.get(cls.id) ?? [];
    const activeStudentIds = activeByClass.get(cls.id) ?? new Set<string>();
    const earliestEnrolment = earliestEnrolmentByClass.get(cls.id);

    // ── Expected dates — window derivation MIRRORS core.ts:616-673 ───────────
    const windowFrom =
      earliestEnrolment && earliestEnrolment > monthStart
        ? earliestEnrolment
        : monthStart;
    const windowTo = todayDate < monthEnd ? todayDate : monthEnd;
    const lastScheduledDate: string | null = cls.is_active
      ? windowTo
      : cls.deactivated_at
      ? dateInTimeZone(new Date(String(cls.deactivated_at)), APP_TIMEZONE)
      : null;
    const expectedTo =
      lastScheduledDate === null || lastScheduledDate < windowFrom
        ? null
        : lastScheduledDate < windowTo
        ? lastScheduledDate
        : windowTo;
    const expectedDates =
      activeStudentIds.size && expectedTo !== null
        ? expectedLessonDates(String(cls.day_of_week), windowFrom, expectedTo)
        : [];

    // Skip guard 1 (core.ts:715) — this class has no bearing on the month.
    if (!sessionIds.length && !expectedDates.length && !bookingsByDate.size) {
      continue;
    }

    // ── Attendance rows for these sessions ──────────────────────────────────
    const { data: attRows, error: aErr } = sessionIds.length
      ? await supabase
          .from("attendance")
          .select("lesson_session_id, student_id, status")
          .in("lesson_session_id", sessionIds)
      : {
          data: [] as {
            lesson_session_id: string;
            student_id: string;
            status: string;
          }[],
          error: null,
        };
    if (aErr) throw new Error(aErr.message);

    const attendedStudentIds = (attRows ?? []).map((a) => a.student_id as string);
    const billableStudentIds = [
      ...new Set([...activeStudentIds, ...attendedStudentIds]),
    ];

    // Skip guard 2 (core.ts:758).
    if (!billableStudentIds.length && !bookingsByDate.size) continue;

    // ── ARM 1: any billable (present/trial_paid) row → unbilled revenue ──────
    if ((attRows ?? []).some((a) => BILLABLE.has(a.status as string))) {
      return true;
    }

    // ── ARM 2: an unmarked expected/booked lesson still >= floor ─────────────
    const attSet = new Set(
      (attRows ?? []).map((a) => `${a.lesson_session_id}:${a.student_id}`)
    );
    const datesToCheck = [
      ...new Set<string>([
        ...expectedDates,
        ...sessionByDate.keys(),
        ...bookingsByDate.keys(),
      ]),
    ];
    // Mirrors core.ts's unmarkedOn(): expectedStudentsOn() is the shared
    // definition of "who was expected" — do not inline the union (§7.18).
    for (const date of datesToCheck) {
      if (date < floor) continue; // below the floor: already stranded, not ours
      const expected = expectedStudentsOn(date, enrolmentSpans, bookingsByDate);
      if (!expected.length) continue;
      const sessId = sessionByDate.get(date);
      const unmarked = sessId
        ? expected.filter((s) => !attSet.has(`${sessId}:${s}`))
        : expected;
      if (unmarked.length) return true;
    }
  }

  return false;
}

/**
 * The earliest unsealed month before `billingMonth` that still has unbilled
 * lessons, or null if none blocks. Read-only. NEVER throws — any error is logged
 * and resolves to null (fail skippable, RISK 1).
 *
 * `force` deliberately does NOT bypass this: an override could only ever seal a
 * later month over an earlier billable one, the exact permanent underbill this
 * guard exists to prevent. The escape hatch is billing the earlier month, not
 * skipping the check.
 */
export async function earliestBlockingEarlierMonth(
  supabase: SupabaseClient,
  tenantId: string,
  billingMonth: string,
  now: Date
): Promise<string | null> {
  try {
    const todayDate = dateInTimeZone(now, APP_TIMEZONE);

    // Sealed months for this tenant (all of them — the floor needs the max).
    const { data: sealedRows, error: bpErr } = await supabase
      .from("billing_periods")
      .select("billing_month")
      .eq("tenant_id", tenantId);
    if (bpErr) throw new Error(bpErr.message);
    const sealed = new Set((sealedRows ?? []).map((r) => r.billing_month as string));

    // Tenant creation, Singapore-local — the lower bound on months that can hold
    // any lesson, and the floor's fallback when nothing is sealed.
    const { data: tenantRow, error: tErr } = await supabase
      .from("tenants")
      .select("created_at")
      .eq("id", tenantId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!tenantRow?.created_at) return null; // unknown tenant → cannot block
    const createdAtSg = dateInTimeZone(
      new Date(String(tenantRow.created_at)),
      APP_TIMEZONE
    );

    const floor = computeMarkableFloor(now, [...sealed], createdAtSg);

    // Class ids first — every scan below is scoped through them.
    const { data: classes, error: cErr } = await supabase
      .from("classes")
      .select("id, day_of_week, is_active, deactivated_at")
      .eq("tenant_id", tenantId)
      .order("id");
    if (cErr) throw new Error(cErr.message);
    if (!classes || !classes.length) return null;
    const classIds = classes.map((c) => c.id as string);

    // The earliest month that can hold a lesson: production BACKDATES enrolments
    // (HANDOVER — July's enrolments were set to 2026-07-08), so a session can
    // predate the tenant's created_at. The lower bound is therefore the earlier
    // of the floor's month (below which arm 2 cannot fire) and the earliest
    // recorded session's month (below which arm 1 has nothing).
    const { data: firstSession, error: fsErr } = await supabase
      .from("lesson_sessions")
      .select("session_date")
      .in("class_id", classIds)
      .order("session_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (fsErr) throw new Error(fsErr.message);
    const floorMonth = floor.slice(0, 7);
    const earliestSessionMonth = firstSession?.session_date
      ? String(firstSession.session_date).slice(0, 7)
      : null;
    const lowerMonth =
      earliestSessionMonth && earliestSessionMonth < floorMonth
        ? earliestSessionMonth
        : floorMonth;
    const upperMonth = previousBillingMonthOf(billingMonth);
    const candidates = monthsInclusive(lowerMonth, upperMonth).filter(
      (m) => !sealed.has(m)
    );
    // In-order billing → every earlier month is sealed → candidates is empty →
    // the guard is a no-op and billing proceeds exactly as before (RISK 3).
    if (!candidates.length) return null;

    // ── Hoisted, month-independent data: enrolment spans per class ───────────
    const { data: enrolments, error: eErr } = await supabase
      .from("student_class_enrolments")
      .select("student_id, class_id, enrolled_at, unenrolled_at, is_active")
      .in("class_id", classIds);
    if (eErr) throw new Error(eErr.message);

    const enrolmentsByClass = new Map<string, EnrolmentSpan[]>();
    const activeByClass = new Map<string, Set<string>>();
    const earliestEnrolmentByClass = new Map<string, string | undefined>();
    for (const e of enrolments ?? []) {
      const cid = e.class_id as string;
      const from = dateInTimeZone(new Date(String(e.enrolled_at)), APP_TIMEZONE);
      const span: EnrolmentSpan = {
        studentId: e.student_id as string,
        from,
        until: e.unenrolled_at
          ? dateInTimeZone(new Date(String(e.unenrolled_at)), APP_TIMEZONE)
          : null,
      };
      const list = enrolmentsByClass.get(cid) ?? [];
      list.push(span);
      enrolmentsByClass.set(cid, list);
      if (e.is_active) {
        const set = activeByClass.get(cid) ?? new Set<string>();
        set.add(e.student_id as string);
        activeByClass.set(cid, set);
      }
      // earliestEnrolment mirrors core.ts:627 — raw enrolled_at date slice, over
      // ALL enrolments (active or not), earliest wins.
      const rawFrom = String(e.enrolled_at).slice(0, 10);
      const prev = earliestEnrolmentByClass.get(cid);
      if (prev === undefined || rawFrom < prev) {
        earliestEnrolmentByClass.set(cid, rawFrom);
      }
    }

    const typedClasses = classes.map((c) => ({
      id: c.id as string,
      day_of_week: c.day_of_week as string,
      is_active: c.is_active as boolean,
      deactivated_at: (c.deactivated_at as string | null) ?? null,
    }));

    // Ascending, so the FIRST blocker found is the earliest — name that one.
    for (const month of candidates) {
      const blocks = await monthHasUnbilledLessons(
        supabase,
        typedClasses,
        enrolmentsByClass,
        activeByClass,
        earliestEnrolmentByClass,
        month,
        todayDate,
        floor
      );
      if (blocks) return month;
    }
    return null;
  } catch (err) {
    // Fail SKIPPABLE — a guard that cannot decide must not halt billing.
    console.error(
      `[ordering-guard] tenant ${tenantId} billing ${billingMonth}: ` +
        `predicate error, failing skippable — ${String(err)}`
    );
    return null;
  }
}

/** "YYYY-MM" one month earlier, year rollover safe. Local to keep dates.ts's
 *  previousBillingMonth (which takes a Date) untouched. */
function previousBillingMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}
