// Billing months — which months are closed, which are open and WHY, and which
// have not been billed yet. Pure: no React, no client, no clock (the caller
// passes today's SGT date). Shared by the Invoices page's Billing months card
// and the Dashboard's one-line alert, so both say the same thing.
//
// Plan: docs/plans/BILLING_MONTHS_PLAN.md §3 is the whole display rule. The
// reason a month is open is a SNAPSHOT of its latest billing_runs row (D3) —
// this file never re-derives billing rules; the engine is the only copy.
//
// Dates: months are compared as "YYYY-MM" strings (lexical order = time order)
// and today arrives as todayInSg()'s "YYYY-MM-DD". No Date arithmetic on the
// logic path (§7.7); display labels are built in UTC from the string itself.

export type BillingPeriod = {
  billing_month: string;
  completed_at: string;
  invoices_issued: number;
};

/** Mirrors the engine's BlockingLesson, as stored in billing_runs.blocking. */
export type RunBlockingLesson = {
  class_id: string;
  class_title: string;
  session_date: string;
  unmarked_student_count: number;
};

/** Mirrors the engine's UnclaimedStudent, as stored in
 *  billing_runs.unclaimed_students — the same shape the Unclaimed modal takes. */
export type RunUnclaimedStudent = {
  student_id: string;
  student_name: string | null;
  lessons: number;
  earliest_session_date: string;
  latest_session_date: string;
};

export type BillingRun = {
  id: string;
  billing_month: string;
  ran_at: string;
  /** Display name of whoever pressed Generate; null = cron or a deleted admin. */
  ran_by_name: string | null;
  mode: string | null;
  status: string;
  sealed: boolean;
  invoices_created: number;
  unclaimed_billable: number | null;
  earlier_unbilled_month: string | null;
  blocking: RunBlockingLesson[] | null;
  unclaimed_students: RunUnclaimedStudent[] | null;
  error: string | null;
};

export type MonthState = "closed" | "open" | "not_billed" | "not_run";

export type BillingMonthRow = {
  month: string;
  state: MonthState;
  /** Red/amber on the card and counted by the Dashboard alert. */
  needsAttention: boolean;
  /** Why it is open / not billed. null for closed and not-run-yet months. */
  reason: string | null;
  /** The seal, when closed. */
  period: BillingPeriod | null;
  /** Newest first, at most RECENT_RUNS (D7). */
  recentRuns: BillingRun[];
};

/** D2: closed months shown before "Show all". */
export const CLOSED_CAP = 3;
/** D7: runs listed when a month is expanded. */
export const RECENT_RUNS = 5;

/** Engine statuses the reason rule names explicitly. Anything else falls
 *  through to the raw status (the fail-safe — never a green tick). */
const INCOMPLETE = "incomplete_attendance";
const EARLIER = "earlier_month_unbilled";
const NOTHING = "nothing_to_bill";
const ERROR = "error";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08" → "Aug 2026". Built from the string, so no timezone can move it. */
export function monthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? `${MONTHS[i]} ${m[1]}` : ym;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The reason a month is still open, from its latest run (plan §3, first match
 * wins). A run can be blocked AND have unclaimed lessons; unmarked attendance is
 * named first because nothing bills until it is fixed.
 */
export function reasonFor(run: BillingRun): string {
  // ⚠ RISK 8: a month sealed by this run whose seal has since been deleted by
  // hand (INVOICE_RUNBOOK's unseal). The raw status would read "complete —
  // billing month sealed" on a row marked Open.
  if (run.sealed) return "Reopened after sealing — generate again";
  if (run.status === ERROR) {
    return `Last run failed: ${run.error ?? "unknown error"}`;
  }
  if (run.status === INCOMPLETE) {
    const n = run.blocking?.length ?? 0;
    return `${n} ${plural(n, "lesson has", "lessons have")} unmarked attendance`;
  }
  if ((run.unclaimed_billable ?? 0) > 0) {
    const n = run.unclaimed_billable!;
    return `${n} ${plural(n, "lesson has", "lessons have")} no parent to bill`;
  }
  if (run.status === EARLIER && run.earlier_unbilled_month) {
    return `Bill ${monthLabel(run.earlier_unbilled_month)} first`;
  }
  if (run.status === NOTHING) return "No lessons recorded for this month yet";
  // FAIL SAFE: an unrecognised or partial status is shown as-is, amber.
  return run.status;
}

const PRE_FEATURE_REASON =
  "Reason not recorded (last run was before 22 Sep 2026) — generate again to see why";

export type DeriveInput = {
  periods: BillingPeriod[];
  /** Any order; this sorts. */
  runs: BillingRun[];
  /** Months that have at least one invoice. */
  invoiceMonths: string[];
  /** The previous month in SGT — the newest month that can be billed. */
  latestBillableMonth: string;
  /** todayInSg(), "YYYY-MM-DD". */
  todaySg: string;
  /** The tenant's invoice_run_day (1–28). */
  runDay: number;
};

/** Every month worth a row, newest first (plan §3). */
export function deriveBillingMonths(input: DeriveInput): BillingMonthRow[] {
  const { periods, invoiceMonths, latestBillableMonth, todaySg, runDay } = input;
  // Nothing after the latest billable month can be billed (the completed-month
  // guard), so nothing after it is shown.
  const billable = (m: string) => m <= latestBillableMonth;

  const periodBy = new Map(periods.map((p) => [p.billing_month, p]));
  const runsBy = new Map<string, BillingRun[]>();
  for (const r of [...input.runs].sort((a, b) => b.ran_at.localeCompare(a.ran_at))) {
    const list = runsBy.get(r.billing_month) ?? [];
    list.push(r);
    runsBy.set(r.billing_month, list);
  }
  const invoiced = new Set(invoiceMonths);

  // ⚠ RISK 7: a month an OPEN month's latest run says must be billed first. It
  // may have no run and no invoice — without promoting it, the admin is told to
  // bill a month the card does not show.
  const blockers = new Map<string, string>(); // earlier month → month it blocks
  for (const [month, list] of runsBy) {
    const latest = list[0];
    if (periodBy.has(month)) continue;
    if (latest.status === EARLIER && latest.earlier_unbilled_month) {
      blockers.set(latest.earlier_unbilled_month, month);
    }
  }

  const months = new Set<string>([
    ...periodBy.keys(),
    ...runsBy.keys(),
    ...invoiced,
    ...blockers.keys(),
    latestBillableMonth,
  ]);

  const day = Number(todaySg.slice(8, 10));
  const pastRunDay = Number.isFinite(day) && day >= runDay;

  return [...months]
    .filter((m) => /^\d{4}-\d{2}$/.test(m) && billable(m))
    .sort((a, b) => b.localeCompare(a))
    .flatMap((month): BillingMonthRow[] => {
      const period = periodBy.get(month) ?? null;
      const runs = runsBy.get(month) ?? [];
      const recentRuns = runs.slice(0, RECENT_RUNS);
      const base = { month, period, recentRuns };

      if (period) {
        return [{ ...base, state: "closed", needsAttention: false, reason: null }];
      }
      if (runs.length) {
        return [{ ...base, state: "open", needsAttention: true, reason: reasonFor(runs[0]) }];
      }
      if (invoiced.has(month)) {
        return [{ ...base, state: "open", needsAttention: true, reason: PRE_FEATURE_REASON }];
      }
      const blocked = blockers.get(month);
      if (blocked) {
        return [{
          ...base, state: "not_billed", needsAttention: true,
          reason: `Not billed yet — ${monthLabel(blocked)} cannot be billed until it is`,
        }];
      }
      if (month === latestBillableMonth) {
        // D6: neutral until the run day, then amber.
        return pastRunDay
          ? [{ ...base, state: "not_billed", needsAttention: true, reason: null }]
          : [{ ...base, state: "not_run", needsAttention: false, reason: null }];
      }
      // A month with no run, no seal and no invoice: an ordinary gap.
      return [];
    });
}

/**
 * D2: every month that is not closed, plus the newest CLOSED_CAP closed months.
 * An open month is NEVER capped — hiding one is the failure this card exists to
 * fix.
 */
export function visibleMonths(
  rows: BillingMonthRow[],
  showAll = false
): { visible: BillingMonthRow[]; hiddenCount: number } {
  if (showAll) return { visible: rows, hiddenCount: 0 };
  let closedShown = 0;
  const visible = rows.filter((r) => {
    if (r.state !== "closed") return true;
    closedShown += 1;
    return closedShown <= CLOSED_CAP;
  });
  return { visible, hiddenCount: rows.length - visible.length };
}

/**
 * ⚠ RISK 6: a stored run's unclaimed students, minus any resolved since the
 * run — the snapshot (D3) does not change when the admin acts, so without this
 * the card would keep offering a child who is already dealt with:
 *   • CLAIMED (a parent registered): a paid-outside settlement for a child who
 *     will now ALSO be invoiced double-counts the money;
 *   • SETTLED through their latest listed lesson (a live settlement — reversed
 *     ones are excluded by the caller's read): a second settlement records the
 *     same money twice.
 * `settledThrough` maps student_id → their latest live settled_through date.
 */
export function stillUnclaimed(
  students: RunUnclaimedStudent[] | null,
  claimedIds: ReadonlySet<string>,
  settledThrough: ReadonlyMap<string, string> = new Map()
): RunUnclaimedStudent[] {
  return (students ?? []).filter((s) => {
    if (claimedIds.has(s.student_id)) return false;
    const through = settledThrough.get(s.student_id);
    // "YYYY-MM-DD" strings compare lexically.
    return !(through && through >= s.latest_session_date);
  });
}

// ── Shared by both pages' loaders ───────────────────────────────────────────

/** "YYYY-MM" minus n months, by string arithmetic (no Date on the logic path). */
export function monthsBefore(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) - n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function runDayOf(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(28, n) : 7;
}

/** How far back the invoice-month read looks (⚠ RISK 10 — bounded read). */
export const INVOICE_MONTH_WINDOW = 24;

/** Map one raw billing_runs row (with its `profiles` embed) to a BillingRun. */
export function mapBillingRun(r: any): BillingRun {
  return {
    id: r.id,
    billing_month: r.billing_month,
    ran_at: r.ran_at,
    ran_by_name: r.profiles?.full_name ?? null,
    mode: r.mode ?? null,
    status: r.status,
    sealed: r.sealed === true,
    invoices_created: r.invoices_created ?? 0,
    unclaimed_billable: r.unclaimed_billable ?? null,
    earlier_unbilled_month: r.earlier_unbilled_month ?? null,
    blocking: r.blocking ?? null,
    unclaimed_students: r.unclaimed_students ?? null,
    error: r.error ?? null,
  };
}

/** The Dashboard's one line, or null when nothing needs attention. */
export function attentionSummary(rows: BillingMonthRow[]): string | null {
  const due = rows.filter((r) => r.needsAttention);
  if (!due.length) return null;
  // Oldest first: that is the one blocking the rest, and the one whose
  // marking window closes soonest.
  const first = due[due.length - 1];
  const head =
    first.state === "open"
      ? `${monthLabel(first.month)} is still open — ${first.reason}`
      : `${monthLabel(first.month)} has not been billed yet`;
  return due.length > 1 ? `${head} (+${due.length - 1} more)` : head;
}

/** DISPLAY ONLY: a run's timestamptz as "14 Sep, 09:49" in Singapore time,
 *  whatever the viewer's zone (§7.229's rule — display pins the zone). Degrades
 *  to the raw string rather than throwing. */
export function formatRunStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
