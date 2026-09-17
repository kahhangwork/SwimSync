import { useEffect, useState } from "react";
import { resolveShadows } from "@/lib/lessonAttribution";
import { useTableSort } from "@/components/Table";
import * as repo from "../dao/wages.repo";
import * as rpc from "../dao/wages.rpc";
import type { CoachRow, PayoutRow } from "../types";
import {
  buildLessonLines,
  summarisePayout,
  grossMatchesItems,
  type PayoutItem,
  type SessionRosterRow,
} from "./payoutItems";
import { currentMonth, toPayoutItems } from "./wageRows";

// The payroll run: the month, its payouts (with per-lesson breakdown and cover
// labels), Calculate payroll, Mark paid. Takes the spine's tenantId + coaches
// (for names) and the shared busy/message setters.
export function usePayroll(
  tenantId: string | null,
  coaches: CoachRow[],
  setBusy: (b: boolean) => void,
  setMessage: (m: string | null) => void
) {
  const [period, setPeriod] = useState(currentMonth());
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingPayouts, setLoadingPayouts] = useState(false);
  /** Which payout's per-lesson breakdown is open. One at a time. */
  const [expanded, setExpanded] = useState<string | null>(null);

  /**
   * `isStale` is how a superseded load declines to publish. This is now a
   * TWO-ROUND-TRIP load (payouts + items, then the roster), so the window in
   * which the period can change under it is twice what it was — and the row it
   * would repaint carries a "Mark paid" button. `mark_payout_paid` freezes a
   * month deliberately and irreversibly, so a stale row here is not a cosmetic
   * problem: it is the wrong month frozen with one click.
   */
  async function loadPayouts(isStale: () => boolean = () => false) {
    if (!tenantId) return;

    // The ITEMS, not a count of them. A lesson's amount for a coach is the sum
    // of a set now, and the count of items is not the count of lessons.
    const { data, error } = await repo.loadPayouts(tenantId, period);

    if (isStale()) return;

    // Surfaced rather than swallowed. An unchecked failure here empties the
    // table, and an empty payroll table reads as "payroll has not been run
    // this month" — which invites running it, not investigating it.
    if (error) {
      setLoadError(error.message);
      setPayouts([]);
      return;
    }

    const itemsByPayout = new Map<string, PayoutItem[]>(
      (data ?? []).map((p: any) => [p.id, toPayoutItems(p)])
    );

    // One roster query for the whole month. This is what makes a cover legible:
    // without it a reassignment is just a number that changed.
    //
    // ⚠ FETCHED BY TENANT AND FILTERED HERE, NOT `.in(sessionIds)`. That list
    // is every distinct lesson across every coach's payout for the month, and
    // PostgREST sends it in the URL — a few hundred lessons is ~12 KB of query
    // string, past the usual 8 KB header buffer, and the 414 would surface as
    // "could not label covers" on the page whose entire job is labelling
    // covers. `session_coaches` is near-empty by the absence rule, so the whole
    // tenant's roster is the smaller and unbounded-safe request.
    const sessionIds = new Set(
      [...itemsByPayout.values()].flat().map((i) => i.lesson_session_id)
    );

    let rosterRows: SessionRosterRow[] = [];
    let rosterError: string | null = null;
    if (sessionIds.size > 0) {
      const { data: roster, error: rosterErr } = await repo.loadSessionCoaches(tenantId);

      if (isStale()) return;

      // A failed roster load must NOT fall through to "no covers". Every line
      // would render as an ordinary lesson, which is exactly the silence this
      // page exists to break — so the amounts are still shown and the missing
      // labels are declared.
      if (rosterErr) rosterError = `Could not label covers: ${rosterErr.message}`;
      else
        rosterRows = ((roster ?? []) as SessionRosterRow[]).filter((r) =>
          sessionIds.has(r.lesson_session_id)
        );
    }

    // ── Which lessons was each coach an assigned CLASS SHADOW on? ───────────
    // A shadow holds no per-lesson row, so this cannot be read off the roster.
    // The dated, absence-aware resolution — coach_attribution_kind()'s shadow
    // arm (20260812000200 §7) — is NOT rebuilt here: it lives once in
    // `lib/lessonAttribution.ts` (`resolveShadows`), which the Attendance page
    // shares. That the SUBSTITUTE wins is applied downstream by
    // buildLessonLines(), so resolveShadows deliberately does not filter it.
    let shadowedByCoach = new Map<string, Set<string>>();
    if (sessionIds.size > 0) {
      const [
        { data: assigns, error: assignErr },
        { data: absences, error: absErr },
      ] = await Promise.all([
        repo.loadClassShadowCoaches(tenantId),
        repo.loadSessionCoachAbsences(tenantId),
      ]);

      if (isStale()) return;

      // ⚠ SCOPED TO THE SHADOWED CLASSES, NOT `.in(sessionIds)`. The rule is
      // stated 40 lines above for this same set and this code broke it: that
      // list is every distinct lesson across every coach's payout for the
      // month, PostgREST puts it in the URL, and a few hundred lessons is past
      // the header buffer — a 414 on the query whose whole job is labelling.
      // The shadowed classes are a far smaller and unbounded-safe key, and they
      // are the only classes whose lessons can possibly matter here.
      const shadowClassIds = [
        ...new Set((assigns ?? []).map((a: any) => a.class_id as string)),
      ];
      const { data: lessonRows, error: lessonErr } =
        shadowClassIds.length > 0
          ? await repo.loadLessonSessionsForClasses(shadowClassIds)
          : { data: [] as any[], error: null };

      if (isStale()) return;

      // ⚠ DECLARED, NOT SWALLOWED — the same reason the roster load above says
      // so. A failed load here leaves shadowedByCoach empty, and every shadow's
      // line then falls through lineKind() to "ordinary", or to "reassigned"
      // when the lesson also has a substitute: a CLAWBACK label on a positive
      // payment.
      const shadowErr = assignErr ?? absErr ?? lessonErr;
      if (shadowErr) {
        rosterError = [rosterError, `Could not label shadow lessons: ${shadowErr.message}`]
          .filter(Boolean)
          .join(" · ");
      }

      shadowedByCoach = resolveShadows({
        lessons: (lessonRows ?? []).map((ls: any) => ({
          lesson_session_id: ls.id,
          class_id: ls.class_id,
          session_date: ls.session_date,
        })),
        shadows: (assigns ?? []) as any[],
        absences: (absences ?? []) as any[],
      }).shadowedByCoach;
    }

    setLoadError(rosterError);

    setPayouts(
      (data ?? []).map((p: any) => {
        const lines = buildLessonLines(
          itemsByPayout.get(p.id) ?? [],
          rosterRows,
          p.coach_id,
          shadowedByCoach.get(p.coach_id) ?? new Set<string>()
        );
        const summary = summarisePayout(lines);
        const gross_amount = Number(p.gross_amount);
        return {
          id: p.id,
          coach_id: p.coach_id,
          coach_name: coaches.find((c) => c.id === p.coach_id)?.name ?? "—",
          gross_amount,
          status: p.status,
          lines,
          summary,
          grossOk: grossMatchesItems(gross_amount, summary),
        };
      })
    );
  }

  useEffect(() => {
    if (!tenantId || !coaches.length) return;
    let cancelled = false;
    // Collapse any open breakdown: it is keyed by payout id, and the payouts
    // are about to be replaced by another month's.
    setExpanded(null);
    setLoadingPayouts(true);
    loadPayouts(() => cancelled).finally(() => {
      if (!cancelled) setLoadingPayouts(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, period, coaches.length]);

  async function handleRun() {
    if (!tenantId) return;
    setBusy(true);
    setMessage(null);
    const { error } = await rpc.generateCoachPayouts({
      p_tenant_id: tenantId,
      p_period_month: period,
    });
    if (error) {
      setBusy(false);
      setMessage(`Could not run payroll: ${error.message}`);
      return;
    }
    // Reload BEFORE releasing the buttons — re-enabling them for the duration
    // of the refetch invites a second run against rows about to be replaced.
    await loadPayouts();
    setBusy(false);
    setMessage("Payroll calculated. Draft payouts recalculate every run.");
  }

  async function handleMarkPaid(id: string) {
    setBusy(true);
    const { error } = await rpc.markPayoutPaid({ p_payout_id: id });
    if (error) {
      setBusy(false);
      setMessage(`Could not mark paid: ${error.message}`);
      return;
    }
    await loadPayouts();
    setBusy(false);
    setMessage(
      "Marked paid and frozen. A later correction to this month becomes an adjustment on the next one."
    );
  }

  const payoutSort = useTableSort<PayoutRow>({
    key: "coach_name",
    accessors: {
      status: (p) => (p.status === "paid" ? "Paid" : "Draft"),
      // DISTINCT lessons. Sorting by a raw item count would order a coach with
      // one corrected lesson above a coach with two real ones.
      lessons: (p) => p.summary.lessons,
    },
  });
  const visiblePayouts = payoutSort.apply(payouts);

  return {
    period, setPeriod,
    payouts,
    loadError,
    loadingPayouts,
    expanded, setExpanded,
    handleRun,
    handleMarkPaid,
    payoutSort, visiblePayouts,
  };
}
