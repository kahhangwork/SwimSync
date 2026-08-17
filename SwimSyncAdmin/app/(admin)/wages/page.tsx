"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { todayInSg, formatSgDate } from "@/lib/lessonDates";
import {
  buildLessonLines,
  summarisePayout,
  grossMatchesItems,
  type LessonLine,
  type PayoutItem,
  type PayoutSummary,
  type SessionRosterRow,
} from "@/lib/payoutItems";
import { resolveShadows } from "@/lib/lessonAttribution";

/**
 * Coach wages — the other half of the billing loop.
 *
 * SwimSync tracked every dollar coming IN from parents and nothing going OUT to
 * coaches, so the moment a coach is not the business owner, payroll is a
 * spreadsheet rebuilt by hand from attendance this app already holds.
 *
 * A coach appears here only if they HAVE A RATE. That is how a private coach
 * falls out of payroll without any private-vs-school branch: their income is
 * their parents' invoices, and there is nobody upstream to pay them.
 *
 * DRAFT payouts rebuild on every run — ordinary late corrections just flow in.
 * PAID ones freeze, because money has left the bank and the record has to
 * reconcile against a statement; a later correction to a frozen month appears
 * as an adjustment on the next one.
 *
 * SINCE THE LESSON-LEVEL ROSTER (2026-08-11) A LESSON IS NO LONGER ONE ROW.
 * A shadowed lesson pays two coaches out of two different payouts, and a
 * corrected one leaves a second item on the SAME payout. So the breakdown sums
 * a SET of items per lesson and counts DISTINCT lessons — `lib/payoutItems.ts`
 * holds that arithmetic, and its header explains why none of it may consult
 * `classes.coach_id`.
 *
 * A COVER IS SHOWN AS A DECISION, NEVER AS A DIFFERENT NUMBER. The expensive
 * failure here is not a wrong total; it is a right total nobody can explain —
 * a coach paid $40 less than last month with nothing on screen saying a lesson
 * was reassigned, which turns into a conversation the admin cannot win.
 */

type Rate = { amount: number; unit_minutes: number; effective_from: string };

type CoachRow = {
  id: string;
  name: string;
  /** The MAIN rate in force — what they are paid for a lesson they teach. */
  rate: Rate | null;
  /** The SHADOW rate in force, on its own timeline. Null is the ordinary case
   *  and is NOT missing setup — most coaches never shadow anything. It becomes
   *  a problem only once they are assigned as a class shadow, and payroll
   *  refuses loudly then rather than falling back to the main rate. */
  shadowRate: Rate | null;
};

type PayoutRow = {
  id: string;
  coach_id: string;
  coach_name: string;
  gross_amount: number;
  status: "draft" | "paid";
  /** One entry per LESSON, each summing the items behind it. */
  lines: LessonLine[];
  summary: PayoutSummary;
  /** False when the stored gross and the breakdown disagree — surfaced, not hidden. */
  grossOk: boolean;
};

/**
 * todayInSg(), not the device's calendar. `new Date().getMonth()` is the
 * browser's month, and an admin on a laptop still set to another timezone gets
 * a different default period from the one the engine bills (§7.7).
 */
function currentMonth(): string {
  return todayInSg().slice(0, 7);
}

/**
 * A negative wage line is a CLAWBACK, and it has to read as one. `S$-50.00` —
 * what toFixed() gives you — puts the sign where nobody looks; the minus goes
 * in front of the currency, as on a bank statement.
 */
function money(amount: number): string {
  return `${amount < 0 ? "−" : ""}S$${Math.abs(amount).toFixed(2)}`;
}

/**
 * The small print on one lesson line: how the amount was arrived at, and which
 * month it corrects. An ADJUSTMENT carries no duration — it is a difference,
 * not a lesson length — so the minutes are omitted rather than rendered as
 * "— min", which reads as a lesson whose length nobody recorded.
 */
function lineDetail(line: LessonLine): string {
  const parts: string[] = [];

  if (line.items.length > 1) {
    parts.push(`${line.items.length} entries`);
  } else if (line.items[0].basis === "flat") {
    parts.push("class flat rate");
  } else if (line.items[0].minutes != null) {
    parts.push(`${line.items[0].minutes} min`);
  }

  if (line.adjustedPeriods.length > 0) {
    parts.push(`correcting ${line.adjustedPeriods.join(", ")}`);
  }

  return parts.join(" · ");
}

const LINE_LABELS: Record<LessonLine["kind"], string | null> = {
  ordinary: null,
  assigned: "Assigned to cover",
  shadow: "Shadowing",
  reassigned: "Reassigned to another coach",
  // The cover was cleared after the clawback was emitted, so the roster no
  // longer says who or why — but an unlabelled negative line is worse.
  corrected: "Correction to a settled month",
};

const LINE_STYLES: Record<LessonLine["kind"], string> = {
  ordinary: "",
  assigned: "bg-amber-100 text-amber-800",
  shadow: "bg-sky-100 text-sky-800",
  reassigned: "bg-gray-200 text-gray-700",
  corrected: "bg-violet-100 text-violet-700",
};

export default function WagesPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [rainPays, setRainPays] = useState(false);
  const [runDay, setRunDay] = useState(15);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [period, setPeriod] = useState(currentMonth());
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingPayouts, setLoadingPayouts] = useState(false);
  /** Which payout's per-lesson breakdown is open. One at a time. */
  const [expanded, setExpanded] = useState<string | null>(null);

  // Rate editor
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [rateAmount, setRateAmount] = useState("");
  const [rateUnit, setRateUnit] = useState("60");
  const [rateFrom, setRateFrom] = useState("");
  /** Which rate the editor is writing. Sent explicitly on the insert. */
  const [rateRole, setRateRole] = useState<"main" | "shadow">("main");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (!profile?.tenant_id) return;
      setTenantId(profile.tenant_id);

      const { data: t } = await supabase
        .from("tenants")
        .select("rain_pays_coach, wage_run_day")
        .eq("id", profile.tenant_id)
        .maybeSingle();
      setRainPays(t?.rain_pays_coach ?? false);
      setRunDay(t?.wage_run_day ?? 15);

      await loadCoaches(profile.tenant_id);
    })();
  }, []);

  async function loadCoaches(tid: string) {
    const { data } = await supabase
      .from("coaches")
      .select("id, profiles(full_name), coach_rates(amount, unit_minutes, effective_from, role)")
      .eq("tenant_id", tid);

    setCoaches(
      (data ?? []).map((c: any) => {
        // The rate IN EFFECT is the latest effective_from — rates are
        // effective-dated so a raise never reprices an earlier month.
        //
        // ⚠ FILTERED TO role='main' FIRST, AND THAT IS NOT COSMETIC. Since
        // 20260812000200 a coach can hold a SHADOW rate too, on its own
        // timeline. Sorting every row by effective_from and taking [0] — which
        // is what this did — makes the first shadow rate dated after a main
        // rate display as that coach's rate, while payroll pays the other one.
        const mainRates = (c.coach_rates ?? []).filter(
          (r: any) => (r.role ?? "main") === "main"
        );
        const shadowRates = (c.coach_rates ?? []).filter(
          (r: any) => r.role === "shadow"
        );
        const rates = mainRates.slice().sort((a: any, b: any) =>
          b.effective_from.localeCompare(a.effective_from)
        );
        const shadowSorted = shadowRates.slice().sort((a: any, b: any) =>
          b.effective_from.localeCompare(a.effective_from)
        );
        const prof = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
        return {
          id: c.id,
          name: prof?.full_name ?? "—",
          rate: rates[0]
            ? {
                amount: Number(rates[0].amount),
                unit_minutes: rates[0].unit_minutes,
                effective_from: rates[0].effective_from,
              }
            : null,
          shadowRate: shadowSorted[0]
            ? {
                amount: Number(shadowSorted[0].amount),
                unit_minutes: shadowSorted[0].unit_minutes,
                effective_from: shadowSorted[0].effective_from,
              }
            : null,
        };
      })
    );
  }

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
    const { data, error } = await supabase
      .from("coach_payouts")
      .select(
        "id, coach_id, gross_amount, status, coach_payout_items(id, lesson_session_id, class_title, session_date, basis, minutes, amount, is_adjustment, original_period)"
      )
      .eq("tenant_id", tenantId)
      .eq("period_month", period);

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
      (data ?? []).map((p: any) => [
        p.id,
        (p.coach_payout_items ?? []).map((i: any) => ({
          id: i.id,
          lesson_session_id: i.lesson_session_id,
          class_title: i.class_title,
          session_date: i.session_date,
          basis: i.basis,
          minutes: i.minutes,
          amount: Number(i.amount),
          is_adjustment: i.is_adjustment,
          original_period: i.original_period,
        })),
      ])
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
      const { data: roster, error: rosterErr } = await supabase
        .from("session_coaches")
        .select("lesson_session_id, coach_id")
        .eq("tenant_id", tenantId);

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
        supabase
          .from("class_shadow_coaches")
          .select("class_id, coach_id, effective_from, effective_to")
          .eq("tenant_id", tenantId),
        supabase
          .from("session_coach_absences")
          .select("lesson_session_id, coach_id")
          .eq("tenant_id", tenantId),
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
          ? await supabase
              .from("lesson_sessions")
              .select("id, class_id, session_date")
              .in("class_id", shadowClassIds)
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
    const { error } = await supabase.rpc("generate_coach_payouts", {
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
    const { error } = await supabase.rpc("mark_payout_paid", { p_payout_id: id });
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

  async function handleSaveRate(coachId: string) {
    // An EMPTY amount must not save. Number("") is 0, which is finite and >= 0,
    // so a blank field would silently create a $0 rate — and a $0 rate is worse
    // than no rate: the coach reads as "on payroll" and earns nothing.
    if (rateAmount.trim() === "" || !rateFrom) {
      setMessage("Enter a rate amount and the date it takes effect.");
      return;
    }
    const amount = Number(rateAmount);
    const unit = Number(rateUnit);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(unit) || unit <= 0) {
      setMessage("Rate and minutes must both be greater than zero.");
      return;
    }
    setBusy(true);
    // INSERT, never UPDATE — a new effective-dated row. Editing the old one in
    // place would reprice every month it had already covered.
    // ⚠ role IS SENT EXPLICITLY, never left to the column default. The default
    // is 'main', so a shadow rate saved without it becomes a second main rate
    // and the two race on effective_from.
    const { error } = await supabase.from("coach_rates").insert({
      coach_id: coachId,
      amount,
      unit_minutes: unit,
      effective_from: rateFrom,
      role: rateRole,
    });
    setBusy(false);
    if (error) {
      setMessage(`Could not save rate: ${error.message}`);
      return;
    }
    setRateFor(null);
    setRateAmount("");
    setRateFrom("");
    if (tenantId) await loadCoaches(tenantId);
  }

  async function updateTenant(patch: Record<string, unknown>) {
    if (!tenantId) return;
    await supabase.from("tenants").update(patch).eq("id", tenantId);
  }

  // Above the `if (!tenantId)` return: these call useState, and a hook after a
  // conditional return is a hook that sometimes does not run.
  const rateSort = useTableSort<CoachRow>({
    key: "name",
    accessors: {
      // The rate itself, so "Not on payroll" is blank and sorts last in both
      // directions — a coach with no rate is the row to notice, not to bury in
      // the middle of the alphabet.
      rate: (c) => c.rate?.amount ?? null,
      effective_from: (c) => c.rate?.effective_from ?? null,
    },
  });
  const visibleCoaches = rateSort.apply(coaches);

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

  if (!tenantId) {
    return (
      <div>
        <PageHeader title="Wages" subtitle="Pay your coaches from attendance" />
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-600">
          Wages are run per business, and your account is not attached to one.
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Wages"
        subtitle="Calculated from the lessons your coaches actually taught"
      />

      {/* Policy */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Policy</h2>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={rainPays}
              onChange={async (e) => {
                setRainPays(e.target.checked);
                await updateTenant({ rain_pays_coach: e.target.checked });
              }}
            />
            Pay coaches for lessons cancelled by rain
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            Pay coaches on day
            <input
              type="number"
              min={1}
              max={28}
              value={runDay}
              onChange={(e) => setRunDay(Number(e.target.value))}
              onBlur={async () => {
                const v = Math.min(28, Math.max(1, Math.trunc(runDay)));
                setRunDay(v);
                await updateTenant({ wage_run_day: v });
              }}
              className="w-16 rounded-lg border border-gray-200 px-2 py-1"
            />
            of the month
          </label>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          A lesson pays when at least one student attended. Everyone absent
          doesn&rsquo;t pay; a lesson the coach cancelled never does. Rain
          follows the setting above, and any single session can be overridden.
          Where a lesson was covered or shadowed (see Substitutes), each
          coach is paid their own rate and the coach they replaced is paid
          nothing for it — expand a payout below to see which lessons those are.
        </p>
      </div>

      {/* Rates */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Rates</h2>
        <p className="mb-3 text-xs text-gray-500">
          A coach with no rate isn&rsquo;t on payroll — which is right for a
          private coach, whose income is their parents&rsquo; invoices. Saving a
          rate adds a new dated rate rather than editing the old one, so past
          months keep the rate they were actually worked at.
        </p>
        <Table>
          <Thead>
            <Th sort={rateSort} sortKey="name">Coach</Th>
            <Th sort={rateSort} sortKey="rate" firstDir="desc">Current rate</Th>
            <Th sort={rateSort} sortKey="effective_from">In effect from</Th>
            <Th>Shadow rate</Th>
            <Th>Actions</Th>
          </Thead>
          <Tbody>
            {visibleCoaches.map((c) => (
              <Tr key={c.id}>
                <Td>{c.name}</Td>
                <Td>
                  {c.rate
                    ? `S$${c.rate.amount.toFixed(2)} per ${c.rate.unit_minutes} min`
                    : "Not on payroll"}
                </Td>
                <Td>{c.rate?.effective_from ?? "—"}</Td>
                <Td>
                  {c.shadowRate ? (
                    <span className="text-gray-900">
                      S${c.shadowRate.amount.toFixed(2)} per{" "}
                      {c.shadowRate.unit_minutes} min
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">—</span>
                  )}
                </Td>
                <Td>
                  {rateFor === c.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {/* ⚠ SWITCHING THE ROLE RE-PREFILLS THE AMOUNT. The
                          editor opens on the coach's TEACHING rate, so leaving
                          the number alone when the role changes means the
                          default action for "Shadow rate" is to save the full
                          teaching rate — handing a trainee a coach's pay, which
                          is the one thing the shadow rate exists to prevent. */}
                      <select
                        value={rateRole}
                        onChange={(e) => {
                          const next = e.target.value as "main" | "shadow";
                          setRateRole(next);
                          const r = next === "shadow" ? c.shadowRate : c.rate;
                          setRateAmount(r ? String(r.amount) : "");
                          setRateUnit(String(r?.unit_minutes ?? 60));
                        }}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                      >
                        <option value="main">Teaching rate</option>
                        <option value="shadow">Shadow rate</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="30.00"
                        value={rateAmount}
                        onChange={(e) => setRateAmount(e.target.value)}
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm"
                      />
                      <span className="text-xs text-gray-500">per</span>
                      <input
                        type="number"
                        value={rateUnit}
                        onChange={(e) => setRateUnit(e.target.value)}
                        className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm"
                      />
                      <span className="text-xs text-gray-500">min, from</span>
                      <input
                        type="date"
                        value={rateFrom}
                        onChange={(e) => setRateFrom(e.target.value)}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                      />
                      <button
                        onClick={() => handleSaveRate(c.id)}
                        disabled={busy}
                        className="rounded-lg bg-sky-500 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setRateFor(null)}
                        className="text-sm text-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setRateFor(c.id);
                        setRateRole("main");
                        setRateAmount(c.rate ? String(c.rate.amount) : "");
                        setRateUnit(String(c.rate?.unit_minutes ?? 60));
                        setRateFrom("");
                      }}
                      className="text-sm font-medium text-sky-600 underline"
                    >
                      {c.rate ? "Change rate" : "Set a rate"}
                    </button>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      {/* Payroll run */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              Month
            </label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleRun}
            disabled={busy}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {busy ? "Working…" : "Calculate payroll"}
          </button>
        </div>

        {message && (
          <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
            {message}
          </div>
        )}

        {loadError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError} The amounts below are the ones that will be paid, but a
            lesson taught by a substitute may be showing without its label.
          </div>
        )}

        {/* "Loading" and "none" are DIFFERENT ANSWERS. Rendering the previous
            month's rows, or "no payouts yet", while a load is in flight puts a
            live "Mark paid" beside a month the picker no longer names — and
            marking paid is irreversible by design. */}
        {loadingPayouts ? (
          <p className="py-6 text-center text-sm text-gray-400">
            Loading payouts…
          </p>
        ) : payouts.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            No payouts for this month yet.
          </p>
        ) : (
          <Table>
            <Thead>
              <Th sort={payoutSort} sortKey="coach_name">Coach</Th>
              <Th sort={payoutSort} sortKey="lessons" firstDir="desc">Lessons</Th>
              <Th sort={payoutSort} sortKey="gross_amount" firstDir="desc">Amount</Th>
              <Th sort={payoutSort} sortKey="status">Status</Th>
              <Th>Actions</Th>
            </Thead>
            <Tbody>
              {visiblePayouts.map((p) => (
                <Fragment key={p.id}>
                  <Tr>
                    <Td>
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded(expanded === p.id ? null : p.id)
                        }
                        aria-expanded={expanded === p.id}
                        className="inline-flex items-center gap-1.5 font-medium text-gray-900 hover:text-sky-600"
                      >
                        {expanded === p.id ? (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                        {p.coach_name}
                      </button>
                    </Td>
                    <Td>
                      {p.summary.lessons}
                      {/* The adjustment is called out beside the count rather
                          than folded into it: a correction to an already-paid
                          month is the one line an admin has to be able to
                          explain to the coach receiving it. */}
                      {p.summary.adjustmentTotal !== 0 && (
                        <span className="ml-1.5 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                          {p.summary.adjustmentTotal > 0 ? "+" : ""}
                          {money(p.summary.adjustmentTotal)} correction
                        </span>
                      )}
                    </Td>
                    <Td>
                      {money(p.gross_amount)}
                      {!p.grossOk && (
                        <span
                          className="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                          title={`The lessons below add up to ${money(p.summary.itemTotal)}. A draft payout rebuilds completely on every run, so re-running payroll for this month is the fix.`}
                        >
                          re-run payroll
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span
                        className={
                          p.status === "paid"
                            ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                            : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                        }
                      >
                        {p.status === "paid" ? "Paid" : "Draft"}
                      </span>
                    </Td>
                    <Td>
                      {p.status === "draft" ? (
                        <button
                          onClick={() => handleMarkPaid(p.id)}
                          disabled={busy}
                          className="text-sm font-medium text-sky-600 underline disabled:opacity-50"
                        >
                          Mark paid
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Frozen</span>
                      )}
                    </Td>
                  </Tr>

                  {expanded === p.id && (
                    <Tr>
                      <Td colSpan={5} className="bg-gray-50">
                        {p.lines.length === 0 ? (
                          <p className="py-2 text-sm text-gray-500">
                            This payout has no lesson lines.
                          </p>
                        ) : (
                          <div className="py-1">
                            <table className="w-full text-sm">
                              <tbody>
                                {p.lines.map((line) => (
                                  <tr
                                    key={line.lesson_session_id}
                                    className="border-b border-gray-200 last:border-0"
                                  >
                                    <td className="py-1.5 pr-4 text-gray-500 whitespace-nowrap">
                                      {formatSgDate(line.session_date)}
                                    </td>
                                    <td className="py-1.5 pr-4 text-gray-900">
                                      {line.class_title}
                                      {LINE_LABELS[line.kind] && (
                                        <span
                                          className={`ml-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${LINE_STYLES[line.kind]}`}
                                        >
                                          {LINE_LABELS[line.kind]}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1.5 pr-4 text-xs text-gray-500 whitespace-nowrap">
                                      {lineDetail(line)}
                                    </td>
                                    <td
                                      className={`py-1.5 text-right font-medium whitespace-nowrap ${
                                        line.amount < 0
                                          ? "text-red-700"
                                          : "text-gray-900"
                                      }`}
                                    >
                                      {money(line.amount)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  )}
                </Fragment>
              ))}
            </Tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
