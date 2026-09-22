import { useRef, useState } from "react";
import {
  todayInSg,
  monthBounds,
  previousBillingMonth,
} from "@/lib/lessonDates";
import { computeClassCoverage, type ClassCoverage } from "@/lib/classCoverage";
import type { UnclaimedStudent } from "../types";
import * as repo from "../dao/invoices.repo";
import { generateInvoices } from "../dao/invoices.api";
import { formatBillingMonth } from "./invoiceRows";

type BlockedLesson = {
  class_id: string;
  class_title: string;
  session_date: string;
  unmarked_student_count: number;
};

/** Invoice generation: the month picker, the pre-flight coverage check, and the
 *  engine call with its full branch set. Cross-slice effects are injected:
 *  `setUnclaimed` fills the unclaimed modal, `afterGenerate` reloads the list +
 *  pending debits. Created AFTER useUnclaimed/useInvoiceList/usePendingDebits so
 *  those deps exist (see useUnclaimed for why the cycle is broken this way). */
export function useGenerate({
  tenantId,
  setUnclaimed,
  afterGenerate,
  afterAnyRun,
}: {
  tenantId: string | null;
  setUnclaimed: (rows: UnclaimedStudent[]) => void;
  afterGenerate: () => Promise<void>;
  /** Runs after EVERY attempt — refused, failed or timed out included. The
   *  Billing months card reloads here: a client-side timeout can hide a run
   *  the server completed, and the run log is where the truth is. */
  afterAnyRun?: () => void;
}) {
  // The latest month that can be billed is the one BEFORE today: invoices cover
  // a complete calendar month (PRD §5.5). This used to default to the CURRENT
  // month with no cap, so the obvious action on 19 July was to generate July —
  // which billed the lessons so far and SEALED the month, stranding the rest.
  // The engine now refuses that outright; this is the affordance that stops the
  // admin being offered it in the first place.
  const latestBillableMonth = previousBillingMonth();
  const [genMonth, setGenMonth] = useState(latestBillableMonth);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  // Lessons the server refused to generate around. Non-empty = blocked.
  const [blockedLessons, setBlockedLessons] = useState<BlockedLesson[]>([]);
  const [coverage, setCoverage] = useState<ClassCoverage[] | null>(null);
  const [checkingCoverage, setCheckingCoverage] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const coverageRequest = useRef(0);

  /**
   * Which lessons should have been marked for `genMonth`, and which weren't.
   *
   * Runs on the browser client under RLS, which already scopes a tenant_admin
   * to their own classes. The explicit tenant filter (in the dao) is for the
   * PLATFORM admin, whose RLS reach is every tenant — without it this dialog
   * would report another business's gaps and gate this button on their
   * attendance.
   *
   * Row ceiling: `max_rows = 1000` in supabase/config.toml. At ~4 classes ×
   * ~5 sessions × ~17 students this is a few hundred attendance rows; around
   * 20 classes it will need paginating or moving server-side.
   */
  async function loadCoverage(billingMonth: string) {
    if (!tenantId) return;
    // Guard against a slow earlier request landing after a newer one and
    // reporting the wrong month's gaps.
    const requestId = ++coverageRequest.current;
    const isStale = () => requestId !== coverageRequest.current;

    setCheckingCoverage(true);
    setCoverage(null);
    setCoverageError(null);

    try {
      const bounds = monthBounds(billingMonth);

      // Every query's error is checked: an unchecked failure would leave the
      // row set empty, which reads as "nothing missing" — the exact false
      // reassurance this dialog exists to prevent. (The deliberate NO-`is_active`
      // filter and why lives with the query, in dao/invoices.repo.ts §7.18.)
      const classesRes = await repo.fetchCoverageClasses(tenantId);
      if (classesRes.error) throw classesRes.error;

      const classIds = (classesRes.data ?? []).map((c) => c.id);
      if (classIds.length === 0) {
        if (!isStale()) {
          setCoverage([]);
          setCheckingCoverage(false);
        }
        return;
      }

      const [enrolmentsRes, sessionsRes, bookingsRes, makeupsRes] =
        await Promise.all([
          repo.fetchEnrolments(classIds),
          repo.fetchSessions(classIds, bounds.start, bounds.end),
          // Trial AND make-up bookings, merged below into one bookings list —
          // both satisfy the same "expected at one lesson" contract (§7.18).
          repo.fetchTrialBookings(classIds, bounds.start, bounds.end),
          repo.fetchMakeupBookings(classIds, bounds.start, bounds.end),
        ]);
      if (enrolmentsRes.error) throw enrolmentsRes.error;
      if (sessionsRes.error) throw sessionsRes.error;
      if (bookingsRes.error) throw bookingsRes.error;
      if (makeupsRes.error) throw makeupsRes.error;

      const sessionIds = (sessionsRes.data ?? []).map((s) => s.id);
      const attendanceRes = sessionIds.length
        ? await repo.fetchAttendance(sessionIds)
        : { data: [], error: null };
      if (attendanceRes.error) throw attendanceRes.error;

      if (isStale()) return;
      setCoverage(
        computeClassCoverage(
          classesRes.data ?? [],
          enrolmentsRes.data ?? [],
          sessionsRes.data ?? [],
          attendanceRes.data ?? [],
          billingMonth,
          todayInSg(),
          [...(bookingsRes.data ?? []), ...(makeupsRes.data ?? [])]
        )
      );
    } catch (e) {
      if (isStale()) return;
      setCoverageError(
        e instanceof Error ? e.message : "could not read attendance"
      );
    } finally {
      if (!isStale()) setCheckingCoverage(false);
    }
  }

  /** Open the confirm dialog and kick off the pre-flight coverage check. */
  function openConfirm() {
    setGenResult(null);
    setShowConfirm(true);
    loadCoverage(genMonth);
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenResult(null);
    const {
      data: { session },
    } = await repo.getSession();
    try {
      const res = await generateInvoices(session?.access_token ?? "", genMonth);
      const json = await res.json();
      if (!res.ok) {
        setGenResult(`Error: ${json.error ?? "generation failed"}`);
      } else if (json.status === "incomplete_attendance") {
        // The server refused: lessons are still unmarked. Authoritative — the
        // client-side coverage check runs its own copy of the rule, so if the
        // two ever disagree this is the one to believe.
        setBlockedLessons(json.blocking ?? []);
        // An admin fixing unmarked lessons should learn about unclaimed ones in
        // the same trip, not discover them on the next run.
        setUnclaimed(json.unclaimed_students ?? []);
        setGenResult(null);
      } else if (json.status === "nothing_to_bill") {
        // Distinct from a finished month: nothing was found to bill, so the
        // month stays OPEN. Saying so explicitly matters — the previous copy
        // ("Created 0 invoice(s) … now closed") read as a successful, final
        // run when in fact no attendance had been marked yet.
        setGenResult(
          `No lessons are recorded for ${formatBillingMonth(genMonth)}, so ` +
            `there is nothing to invoice. The month is still open — generate ` +
            `again once attendance has been marked.`
        );
      } else if (json.status === "already_complete") {
        setGenResult(
          `${formatBillingMonth(genMonth)} is already complete and closed — ` +
            `no invoices were generated. Nothing further is needed.`
        );
      } else if (json.status === "month_not_ended") {
        // The month has not finished, so it cannot be billed (PRD §5.5). The
        // picker is capped to prevent this, but the cap is an affordance and
        // the engine is the guard — so this branch must exist.
        setGenResult(`Error: ${json.message ?? "That month has not ended yet."}`);
      } else if (Number(json.unclaimed_billable ?? 0) > 0) {
        // ── Everything is marked; some of it just has nobody to bill ──────
        // MUST sit above the fail-safe. A run blocked only by unclaimed
        // attendance reports invoices_created: 0, sealed: false and
        // parents_deferred: 0 — which is precisely the fail-safe's signature,
        // so without this branch a correct, actionable refusal rendered as
        // "generation did not complete" and the modal naming the child never
        // opened. Caught by verify-trial-onboarding.mjs, not by any unit test:
        // the engine's response was right the whole time and only the wiring
        // was wrong.
        setUnclaimed(json.unclaimed_students ?? []);
        const n = Number(json.unclaimed_billable);
        setGenResult(
          `Created ${json.invoices_created ?? 0} invoice(s) for ${formatBillingMonth(
            genMonth
          )}. Month left open — ${n} billable lesson${
            n === 1 ? "" : "s"
          } have no parent account to bill.`
        );
        await afterGenerate();
      } else if (
        // ── FAIL SAFE ON ANYTHING UNRECOGNISED ────────────────────────────
        // Everything below assumes a successful run. Without this, a refusal
        // the engine grows LATER renders through the success path as a green
        // "Created 0 invoice(s) for July 2026" — so the admin concludes the
        // month is billed and never comes back. That is worse than the bug
        // this guard was added for: a correct refusal presented as a
        // completed billing. Any future status therefore fails safe by
        // default rather than needing to be remembered here.
        Number(json.invoices_created ?? 0) === 0 &&
        !json.sealed &&
        Number(json.parents_deferred ?? 0) === 0
      ) {
        setGenResult(
          `Error: generation did not complete (${json.status ?? "unknown status"}). ` +
            `${json.message ?? "No invoices were created."}`
        );
      } else {
        // A deferred parent is billed NOTHING this run (a child of theirs sits
        // in a class with unmarked attendance). Surfaced explicitly — silently
        // reporting "Created 0 invoice(s)" would read as "nothing to bill".
        const deferred = Number(json.parents_deferred ?? 0);
        const unclaimedCount = Number(json.unclaimed_billable ?? 0);
        setUnclaimed(json.unclaimed_students ?? []);
        setGenResult(
          `Created ${json.invoices_created ?? 0} invoice(s) for ${formatBillingMonth(
            genMonth
          )}.` +
            (deferred > 0
              ? ` ${deferred} parent(s) deferred — a class they're in still has unmarked attendance.`
              : "") +
            // Sealed means finished and closed: no scheduled run will touch
            // this month again, so say so rather than leaving the admin
            // wondering whether anything else is still coming.
            (json.sealed
              ? " This month is complete and now closed."
              : unclaimedCount > 0
              ? // Say WHICH kind of open. Reporting "attendance is still
                // unmarked" here would send the admin hunting for a missing
                // lesson that does not exist — everything IS marked; the
                // lessons simply have no parent account to bill.
                ` Month left open — ${unclaimedCount} billable lesson(s) have no parent account to bill.`
              : " Month left open — some attendance is still unmarked.")
        );
        await afterGenerate();
      }
    } catch (e) {
      setGenResult(`Error: ${String(e)}`);
    }
    afterAnyRun?.();
    setGenerating(false);
  }

  const hasGaps = (coverage ?? []).some((c) => c.missingDates.length > 0);

  return {
    genMonth,
    setGenMonth,
    latestBillableMonth,
    generating,
    genResult,
    setGenResult,
    showConfirm,
    setShowConfirm,
    blockedLessons,
    setBlockedLessons,
    coverage,
    checkingCoverage,
    coverageError,
    hasGaps,
    openConfirm,
    handleGenerate,
  };
}
