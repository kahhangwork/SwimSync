"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  todayInSg,
  monthBounds,
  formatSgDate,
  previousBillingMonth,
} from "@/lib/lessonDates";
import { computeClassCoverage, type ClassCoverage } from "@/lib/classCoverage";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { blankToNull, checkSgPhone, normalizeSgPhone } from "@/lib/sgPhone";
import { payNowProxyWarning } from "@/lib/paynow";
import { settlementPayload } from "@/lib/settlementPayload";
import * as repo from "./dao/invoices.repo";
import * as rpc from "./dao/invoices.rpc";
import { generateInvoices } from "./dao/invoices.api";
import { useInvoiceList } from "./domain/useInvoiceList";
import { useUnclaimed } from "./domain/useUnclaimed";
import { formatBillingMonth } from "./domain/invoiceRows";
import { InvoiceToolbar } from "./ui/InvoiceToolbar";
import { InvoiceTable } from "./ui/InvoiceTable";
import { UnclaimedModal } from "./ui/UnclaimedModal";
import { ReminderQueue } from "./ui/ReminderQueue";
import type { OrphanLine, PendingDebit } from "./types";

export default function InvoicesPage() {
  // The invoices list slice: table data, search/filter/sort, CSV, mark-paid,
  // WhatsApp stamp, and the reminder queue (domain/useInvoiceList).
  const list = useInvoiceList();

  // Invoice generation controls.
  //
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
  // The tenant this admin bills for. A tenant_admin has exactly one; a
  // platform_admin has none and must pick one (phase 3's tenant switcher),
  // so the generation controls stay disabled for them rather than silently
  // acting on somebody's business.
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState<boolean | null>(null);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [runDay, setRunDay] = useState<number | null>(null);
  const [savingRunDay, setSavingRunDay] = useState(false);
  // PayNow proxy — where invoice QRs point the money. null = not loaded yet
  // (platform admin has no tenant); "" = loaded and unset.
  const [paynowUen, setPaynowUen] = useState<string | null>(null);
  const [paynowMobile, setPaynowMobile] = useState<string | null>(null);
  const [paynowSaved, setPaynowSaved] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("your swim school");
  // Billable lessons with nobody to bill — they hold the month OPEN (the
  // engine's fifth seal condition). The generation run fills this via
  // unclaimed.setUnclaimed (domain/useUnclaimed).
  const unclaimed = useUnclaimed({ genMonth, setGenResult });
  // Lessons recorded into an already-BILLED month (Wave 4). Separate state from
  // `unclaimed` — that one is a generation-run result and lives in a modal;
  // this is a STANDING report that must persist until each line is settled,
  // because the failure mode it exists for is silence. Keyed per
  // (student, month): the same child can be orphaned in two sealed months.
  const [orphans, setOrphans] = useState<OrphanLine[]>([]);
  const [orphanSettling, setOrphanSettling] = useState<string | null>(null);
  const [orphanAmount, setOrphanAmount] = useState<Record<string, string>>({});
  const [orphanError, setOrphanError] = useState<string | null>(null);

  const [pendingDebits, setPendingDebits] = useState<PendingDebit[]>([]);
  const [writingOff, setWritingOff] = useState<string | null>(null);
  const [pendingDebitError, setPendingDebitError] = useState<string | null>(null);
  // Lessons the server refused to generate around. Non-empty = blocked.
  const [blockedLessons, setBlockedLessons] = useState<
    {
      class_id: string;
      class_title: string;
      session_date: string;
      unmarked_student_count: number;
    }[]
  >([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [coverage, setCoverage] = useState<ClassCoverage[] | null>(null);
  const [checkingCoverage, setCheckingCoverage] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const coverageRequest = useRef(0);

  useEffect(() => {
    loadTenant();
  }, []);

  /**
   * Resolve who is signed in and which business they bill for, then read that
   * tenant's billing schedule.
   *
   * The schedule moved from the GLOBAL app_settings rows onto `tenants` when
   * the engine became tenant-scoped. Left on app_settings these controls would
   * still save happily and the engine would ignore them — a switch that looks
   * like it works and does nothing.
   */
  async function loadTenant() {
    const { data: auth } = await repo.getUser();
    if (!auth.user) return;

    const { data: profile } = await repo.fetchProfile(auth.user.id);

    setIsPlatformAdmin(profile?.role === "platform_admin");
    const tid = (profile?.tenant_id as string | null) ?? null;
    setTenantId(tid);
    if (!tid) return;
    loadOrphans(tid);
    loadPendingDebits(tid);

    const { data: tenant } = await repo.fetchTenant(tid);

    setBusinessName((tenant?.display_name as string | null) ?? "your swim school");
    setAutoEnabled(tenant?.auto_invoice_enabled ?? true);
    const n = Number(tenant?.invoice_run_day);
    setRunDay(Number.isFinite(n) && n >= 1 ? Math.min(28, n) : 7);
    setPaynowUen((tenant?.paynow_uen as string | null) ?? "");
    setPaynowMobile((tenant?.paynow_mobile as string | null) ?? "");
  }

  // Saves on blur, like the run day. Validation is ADVISORY only (the
  // sgPhone doctrine — a blocked save helps nobody); normalizeSgPhone strips
  // +65 so the stored form is the bare 8 digits the QR payload needs.
  async function handleSavePaynow(field: "paynow_uen" | "paynow_mobile", raw: string) {
    if (!tenantId) return;
    const value =
      field === "paynow_mobile" ? blankToNull(normalizeSgPhone(raw)) : blankToNull(raw);
    const { error } = await repo.updateTenant(tenantId, {
      [field]: value,
      updated_at: new Date().toISOString(),
    });
    // Advisory only: the value still saved. A mistyped mobile can't build a QR,
    // and the parent's screen would silently show none — warn here instead.
    const warning = error ? null : payNowProxyWarning(field, value);
    setPaynowSaved(
      error
        ? `Error: ${error.message}`
        : warning
          ? `Saved — ⚠ ${warning}`
          : "PayNow details saved."
    );
    if (!error && field === "paynow_mobile") setPaynowMobile(value ?? "");
    if (!error && field === "paynow_uen") setPaynowUen(value ?? "");
  }

  // Capped at 28 to match the engine: 29-31 would never fire in February.
  // The row is seeded by migration — app_settings has no INSERT policy, so
  // this can only ever UPDATE.
  async function handleSaveRunDay(next: number) {
    if (!tenantId) return;
    const clamped = Math.min(28, Math.max(1, Math.trunc(next)));
    setSavingRunDay(true);
    const { error } = await repo.updateTenant(tenantId, {
      invoice_run_day: clamped,
      updated_at: new Date().toISOString(),
    });
    if (!error) setRunDay(clamped);
    setSavingRunDay(false);
  }

  async function handleToggleAuto() {
    if (autoEnabled === null || !tenantId) return;
    setTogglingAuto(true);
    const next = !autoEnabled;
    const { error } = await repo.updateTenant(tenantId!, {
      auto_invoice_enabled: next,
      updated_at: new Date().toISOString(),
    });
    if (!error) setAutoEnabled(next);
    setTogglingAuto(false);
  }

  /**
   * Which lessons should have been marked for `genMonth`, and which weren't.
   *
   * Runs on the browser client under RLS, which already scopes a tenant_admin
   * to their own classes. The explicit tenant filter below is for the PLATFORM
   * admin, whose RLS reach is every tenant — without it this dialog would
   * report another business's gaps and gate this button on their attendance.
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
      const classesRes = await repo.fetchCoverageClasses(tenantId!);
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
        unclaimed.setUnclaimed(json.unclaimed_students ?? []);
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
        // picker below is capped to prevent this, but the cap is an affordance
        // and the engine is the guard — so this branch must exist.
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
        unclaimed.setUnclaimed(json.unclaimed_students ?? []);
        const n = Number(json.unclaimed_billable);
        setGenResult(
          `Created ${json.invoices_created ?? 0} invoice(s) for ${formatBillingMonth(
            genMonth
          )}. Month left open — ${n} billable lesson${
            n === 1 ? "" : "s"
          } have no parent account to bill.`
        );
        await list.load();
        if (tenantId) await loadPendingDebits(tenantId);
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
        unclaimed.setUnclaimed(json.unclaimed_students ?? []);
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
        await list.load();
        if (tenantId) await loadPendingDebits(tenantId);
      }
    } catch (e) {
      setGenResult(`Error: ${String(e)}`);
    }
    setGenerating(false);
  }

  /** The standing orphan-lesson report (Wave 4). Server-computed: the
   *  predicate ("billable, inside a sealed month, no invoice line, no live
   *  settlement") lives in unbilled_sealed_lessons() where pgTAP pins it —
   *  not re-derived here, where it would drift. */
  async function loadOrphans(tid: string) {
    const { data, error } = await rpc.unbilledSealedLessons(tid);
    if (!error) setOrphans((data ?? []) as OrphanLine[]);
  }

  /**
   * Settle one orphan line. Same mechanism as handleSettle above — the month
   * is already sealed, so nothing is holding it open; the settlement is purely
   * the record of what happened to the money.
   *
   * `settled_through` is the line's LATEST lesson date: it covers exactly what
   * was reported and no more, so a lesson backdated in NEXT week reports
   * again and is decided deliberately.
   */
  async function handleSettleOrphan(
    line: OrphanLine,
    kind: "paid_outside" | "written_off",
    amount: number | null
  ) {
    if (!tenantId) return;
    setOrphanSettling(`${line.student_id}:${line.billing_month}`);
    const {
      data: { user },
    } = await repo.getUser();

    const { error } = await repo.insertSettlement(
      settlementPayload({
        tenantId,
        studentId: line.student_id,
        settledThrough: line.latest_session_date,
        kind,
        amount,
        recordedBy: user?.id,
      })
    );

    setOrphanSettling(null);
    if (error) {
      setOrphanError(error.message);
      return;
    }
    setOrphanError(null);
    // Refetch rather than filter: a settlement dated through this month also
    // covers the same child's EARLIER sealed months, so other lines can clear.
    await loadOrphans(tenantId);
  }

  /**
   * A parent's pending DEBIT, before it bills. Scoped to THIS tenant (RISK 6): a
   * platform admin sees every tenant's invoices in the table below, but the debit
   * view is filtered to their own tenant, so tenant B's debit is never shown
   * against tenant A's rows. A pending debit is one that has NOT yet folded onto
   * an invoice — `folded_at` lives on the draw, but the balance column is the
   * authoritative "still owed and uncollected" figure.
   */
  async function loadPendingDebits(tid: string) {
    const { data, error } = await repo.fetchPendingDebits(tid);
    if (error) {
      setPendingDebitError(error.message);
      setPendingDebits([]); // don't leave a stale list standing behind an error
      return;
    }
    setPendingDebitError(null);
    setPendingDebits(
      (data ?? []).map((row: any) => ({
        parent_id: row.parent_id,
        tenant_id: row.tenant_id,
        parent_name: row.parents?.profiles?.full_name ?? "—",
        debit_balance: Number(row.debit_balance ?? 0),
      }))
    );
  }

  /**
   * Clear a parent's pending debit so a leaver can be offboarded. The RPC forgives
   * it in-app (audited); if the money is actually owed, the admin collects it
   * out-of-band (PayNow/cash) — there is deliberately no in-app charge for this
   * rare case. A reason is required.
   */
  async function handleWriteOff(row: PendingDebit) {
    const reason = window.prompt(
      `Write off S$${row.debit_balance.toFixed(2)} owed by ${row.parent_name}?\n\n` +
        `This clears the pending charge in SwimSync. Collect any money owed ` +
        `directly (PayNow/cash) first. Enter a reason for the record:`
    );
    if (reason === null) return; // cancelled
    if (reason.trim() === "") {
      setPendingDebitError("A reason is required to write off a balance.");
      return;
    }
    const key = `${row.parent_id}:${row.tenant_id}`;
    setWritingOff(key);
    const { error } = await rpc.writeOffParentBalance(
      row.parent_id,
      row.tenant_id,
      reason.trim()
    );
    setWritingOff(null);
    if (error) {
      setPendingDebitError(error.message);
      return;
    }
    setPendingDebitError(null);
    if (tenantId) await loadPendingDebits(tenantId);
  }

  const hasGaps = (coverage ?? []).some((c) => c.missingDates.length > 0);

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={`Total outstanding: S$${list.totalOutstanding.toFixed(2)}`}
      />

      {/* A platform admin belongs to no tenant, so there is no business for
          these controls to act on. Said plainly rather than leaving a button
          that looks live and 400s — the tenant switcher arrives in phase 3. */}
      {isPlatformAdmin && !tenantId && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Platform admin.</strong> Invoice generation runs for one
          business at a time, and your account is not attached to one. Sign in
          as that business&rsquo;s admin to generate their invoices.
        </div>
      )}

      {/* Lessons recorded into an already-BILLED month (Wave 4). A STANDING
          section, deliberately not a modal or a one-time warning: the failure
          mode is silence, and a message that can be dismissed is gone. Each
          line persists until a settlement covers it. No bulk action, same as
          the unclaimed modal — settling is a decision about money. */}
      {pendingDebitError && (
        <p
          data-testid="pending-debit-error"
          className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {pendingDebitError}
        </p>
      )}

      {pendingDebits.length > 0 && (
        <div
          data-testid="pending-debits"
          className="mb-5 rounded-2xl border border-indigo-300 bg-indigo-50 p-4"
        >
          <p className="text-sm font-semibold text-indigo-900">
            Pending charges — not yet invoiced
          </p>
          <p className="mt-1 text-xs text-indigo-800">
            A correction to an already-paid invoice left this amount owing. It is
            folded onto the family&apos;s next invoice automatically. If the family
            is leaving and has no next invoice, collect it directly, then write it
            off here so they can be offboarded.
          </p>

          <ul className="mt-3 space-y-3">
            {pendingDebits.map((row) => {
              const key = `${row.parent_id}:${row.tenant_id}`;
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2.5"
                >
                  <p className="text-sm font-semibold text-gray-800">
                    {row.parent_name}
                    <span className="ml-2 font-normal text-gray-600">
                      owes S${row.debit_balance.toFixed(2)}
                    </span>
                  </p>
                  <Button
                    variant="outline"
                    disabled={writingOff === key}
                    onClick={() => handleWriteOff(row)}
                  >
                    Write off
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {orphans.length > 0 && (
        <div
          data-testid="orphan-report"
          className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm font-semibold text-amber-900">
            Recorded after billing — nobody was billed for these lessons
          </p>
          <p className="mt-1 text-xs text-amber-800">
            These lessons sit inside a month that was already billed and
            sealed, so no invoice can ever include them. They were recorded
            afterwards — usually a backdated enrolment, make-up, or an
            attendance correction. Record what happened to the money; each
            line stays here until you do.
          </p>

          <ul className="mt-3 space-y-3">
            {orphans.map((line) => {
              const key = `${line.student_id}:${line.billing_month}`;
              return (
                <li
                  key={key}
                  className="rounded-lg border border-amber-200 bg-white px-3 py-2.5"
                >
                  <p className="text-sm font-semibold text-gray-800">
                    {line.student_name ?? "Unnamed student"}
                    <span className="ml-2 font-normal text-gray-500">
                      {formatBillingMonth(line.billing_month)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-600">
                    {line.lessons} billable lesson
                    {line.lessons === 1 ? "" : "s"} ·{" "}
                    {line.earliest_session_date === line.latest_session_date
                      ? formatSgDate(line.earliest_session_date)
                      : `${formatSgDate(line.earliest_session_date)} – ${formatSgDate(
                          line.latest_session_date
                        )}`}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 text-xs text-gray-600">
                      S$
                      <input
                        value={orphanAmount[key] ?? ""}
                        onChange={(e) =>
                          setOrphanAmount((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label={`Amount received for ${line.student_name ?? "student"}`}
                        className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                      />
                    </div>
                    <Button
                      variant="outline"
                      disabled={
                        orphanSettling === key ||
                        !(Number(orphanAmount[key]) > 0)
                      }
                      onClick={() =>
                        handleSettleOrphan(
                          line,
                          "paid_outside",
                          Number(orphanAmount[key])
                        )
                      }
                    >
                      Paid outside SwimSync
                    </Button>
                    <Button
                      variant="outline"
                      disabled={orphanSettling === key}
                      onClick={() => handleSettleOrphan(line, "written_off", null)}
                    >
                      Write off
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>

          {orphanError && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {orphanError}
            </p>
          )}
        </div>
      )}

      {/* Invoice generation panel */}
      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              Billing month
            </label>
            {/* Capped at the last COMPLETED month. This is an affordance, not
                the guard — `max` constrains neither a programmatically-set
                value nor every browser, so the engine refuses it too. */}
            <input
              type="month"
              value={genMonth}
              max={latestBillableMonth}
              onChange={(e) => setGenMonth(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
          <Button
            onClick={() => {
              setGenResult(null);
              setShowConfirm(true);
              loadCoverage(genMonth);
            }}
            disabled={generating}
          >
            <RefreshCw
              className={`h-4 w-4 ${generating ? "animate-spin" : ""}`}
            />
            {generating ? "Generating…" : "Generate Invoices"}
          </Button>

          {/* Auto-generation toggle.
              `autoEnabled === null` means UNKNOWN, not off — a platform admin
              has no tenant, so loadTenant() returns before reading any setting.
              Rendering null as "off" (and `runDay ?? 7` as "day 7") presented
              invented values as this business's configuration; it only ever
              looked right because production happens to be false/7. */}
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs font-semibold text-gray-700">
                Automatic monthly generation
              </div>
              <div className="text-[11px] text-gray-400">
                {autoEnabled === null
                  ? "No business selected"
                  : `Runs from day ${runDay ?? 7} for the previous month`}
              </div>
            </div>
            {/* shrink-0: this is a flex item next to a two-line label, and w-11
                is a flex BASIS, not a floor — without it the track squashes
                while the absolutely-positioned knob keeps its 20px offset, so
                the knob rides the edge or overhangs it. */}
            <button
              type="button"
              onClick={handleToggleAuto}
              disabled={togglingAuto || autoEnabled === null}
              aria-label="Automatic monthly invoice generation"
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                autoEnabled === null
                  ? "bg-gray-200"
                  : autoEnabled
                    ? "bg-sky-500"
                    : "bg-gray-300"
              } disabled:opacity-50`}
              aria-pressed={!!autoEnabled}
            >
              <span
                className={`absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  autoEnabled ? "translate-x-[1.375rem]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Run day. Only affects the automatic path, so it is greyed out (but
            still editable) when automatic generation is switched off. */}
        <div className="mt-3 flex items-center gap-2">
          <label
            htmlFor="run-day"
            className={`text-xs font-medium ${
              autoEnabled ? "text-gray-700" : "text-gray-400"
            }`}
          >
            Generate automatic invoices from day
          </label>
          {/* Blank rather than "7" when unknown — see the toggle above. A
              number shown here reads as this business's configured run day. */}
          <input
            id="run-day"
            type="number"
            min={1}
            max={28}
            value={runDay ?? ""}
            placeholder="—"
            disabled={savingRunDay || runDay === null}
            onChange={(e) => setRunDay(Number(e.target.value))}
            onBlur={(e) => handleSaveRunDay(Number(e.target.value))}
            className="w-16 rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
          />
          <span
            className={`text-xs ${
              autoEnabled ? "text-gray-500" : "text-gray-400"
            }`}
          >
            of the following month
            {!autoEnabled && " — no effect while automatic generation is off"}
          </span>
        </div>

        {/* PayNow proxy. The invoice QR is computed from these — no QR image
            is uploaded anywhere. UEN wins when both are set (a corporate
            account is guaranteed to get the reference on its statement; a
            personal mobile proxy is best-effort, and mobile-only is a fully
            supported setup — production's private coach runs on one). */}
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="text-xs font-semibold text-gray-700 mb-1">
            PayNow details for invoice QR codes
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="paynow-uen" className="text-xs text-gray-500">
              UEN
            </label>
            <input
              id="paynow-uen"
              type="text"
              value={paynowUen ?? ""}
              placeholder="e.g. 201403121W"
              disabled={paynowUen === null}
              onChange={(e) => setPaynowUen(e.target.value)}
              onBlur={(e) => handleSavePaynow("paynow_uen", e.target.value)}
              className="w-36 rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
            />
            <label htmlFor="paynow-mobile" className="text-xs text-gray-500 ml-2">
              or mobile
            </label>
            <input
              id="paynow-mobile"
              type="text"
              value={paynowMobile ?? ""}
              placeholder="e.g. 91234567"
              disabled={paynowMobile === null}
              onChange={(e) => setPaynowMobile(e.target.value)}
              onBlur={(e) => handleSavePaynow("paynow_mobile", e.target.value)}
              className="w-32 rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
            />
            {(() => {
              const check = checkSgPhone(paynowMobile ?? "");
              return check.message ? (
                <span className="text-[11px] text-amber-600">{check.message}</span>
              ) : null;
            })()}
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            Invoices show a PayNow QR with the amount and reference locked in.
            A UEN (business account) is preferred when you have one — the
            reference then always reaches your bank statement. A personal
            mobile number works too; reference visibility depends on the bank.
          </p>
          {paynowSaved && (
            <p
              className={`mt-1 text-xs font-medium ${
                paynowSaved.startsWith("Error") ? "text-red-600" : "text-green-600"
              }`}
            >
              {paynowSaved}
            </p>
          )}
        </div>

        <p className="mt-3 text-xs text-gray-500">
          Manual generation bills whatever attendance is marked for the chosen
          month (one invoice per parent, across all their children). It ignores
          the automatic on/off switch and never blocks the scheduled run.
        </p>
        {genResult && (
          <p
            className={`mt-2 text-sm font-medium ${
              genResult.startsWith("Error") ? "text-red-600" : "text-green-600"
            }`}
          >
            {genResult}
          </p>
        )}
      </div>

      <UnclaimedModal
        unclaimed={unclaimed.unclaimed}
        genMonth={genMonth}
        settling={unclaimed.settling}
        settleAmount={unclaimed.settleAmount}
        setSettleAmount={unclaimed.setSettleAmount}
        settleError={unclaimed.settleError}
        onSettle={unclaimed.handleSettle}
        onClose={unclaimed.close}
      />

      {/* Server refused: attendance is incomplete. Distinct from the pre-flight
          dialog above — the client-side coverage check and the engine compute
          the rule separately, so this fires when they disagree (and is the
          authoritative answer). */}
      <Modal
        title="Cannot generate invoices"
        open={blockedLessons.length > 0}
        onClose={() => setBlockedLessons([])}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="text-sm font-semibold text-red-700">
              {blockedLessons.length} lesson
              {blockedLessons.length === 1 ? "" : "s"} still need attendance
              marked.
            </p>
            <ul className="mt-2 space-y-1">
              {blockedLessons.map((b) => (
                <li
                  key={`${b.class_id}-${b.session_date}`}
                  className="text-xs text-gray-700"
                >
                  <span className="font-semibold">{b.class_title}</span> ·{" "}
                  {formatSgDate(b.session_date)}
                  <span className="text-red-700">
                    {" "}
                    ({b.unmarked_student_count} student
                    {b.unmarked_student_count === 1 ? "" : "s"})
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-gray-600">
            Mark these in the coach&apos;s app — or mark them{" "}
            <strong>cancelled</strong> if the lesson didn&apos;t run — then
            generate again. Nothing was billed, so there is nothing to undo.
          </p>
          <Button className="w-full" onClick={() => setBlockedLessons([])}>
            Close
          </Button>
        </div>
      </Modal>

      {/* Confirm attendance before generating */}
      <Modal
        title={`Generate invoices for ${formatBillingMonth(genMonth)}?`}
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
      >
        <div className="space-y-4">
          {checkingCoverage && (
            <p className="text-sm text-gray-500">Checking attendance…</p>
          )}

          {coverageError && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
              <p className="text-sm font-semibold text-amber-800">
                Couldn&apos;t check attendance.
              </p>
              <p className="mt-1 text-xs text-gray-600">
                {coverageError}. Generating now is still possible, but nothing has
                verified that every lesson is marked — check the coach&apos;s app,
                or retry.
              </p>
            </div>
          )}

          {coverage && hasGaps && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-sm font-semibold text-red-700">
                Cannot generate — some lessons have no attendance marked.
              </p>
              <p className="mt-1 text-xs text-gray-600">
                Mark these lessons in the coach&apos;s app — or mark them
                cancelled if the lesson didn&apos;t run — then try again. A
                lesson marked <em>after</em> an invoice exists can never be
                added to it, so billing around it would lose that money for
                good.
              </p>
              <ul className="mt-2 space-y-1.5">
                {coverage
                  .filter((c) => c.missingDates.length > 0)
                  .map((c) => (
                    <li key={c.classId} className="text-xs text-gray-700">
                      <span className="font-semibold">{c.title}</span> —{" "}
                      {c.marked} of {c.expected} lessons marked
                      <span className="block text-red-700">
                        Missing: {c.missingDates.map((d) => formatSgDate(d)).join(", ")}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {coverage && !hasGaps && coverage.length > 0 && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
              All {coverage.length} class{coverage.length === 1 ? "" : "es"} fully
              marked for {formatBillingMonth(genMonth)}.
            </p>
          )}

          {coverage && coverage.length === 0 && (
            <p className="text-sm text-gray-600">
              No classes with enrolled students to check for{" "}
              {formatBillingMonth(genMonth)}.
            </p>
          )}

          <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-gray-600">
            Invoices are based on the attendance recorded now. Parents who already
            have an invoice for this month are skipped.
          </p>

          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowConfirm(false)}
            >
              Cancel
            </Button>
            {/* No "Generate anyway". A lesson that genuinely didn't run is
                marked cancelled (non-billable), which clears the gap — so
                there is no legitimate case that needs a bypass, and the
                server refuses regardless. */}
            <Button
              className="flex-1"
              disabled={checkingCoverage || hasGaps}
              onClick={() => {
                setShowConfirm(false);
                handleGenerate();
              }}
            >
              Yes, generate
            </Button>
          </div>
        </div>
      </Modal>

      <InvoiceToolbar
        searchField={list.searchField}
        setSearchField={list.setSearchField}
        search={list.search}
        setSearch={list.setSearch}
        statusFilter={list.statusFilter}
        setStatusFilter={list.setStatusFilter}
        exportDisabled={list.visible.length === 0}
        remindersDisabled={list.invoices.every((i) => i.status !== "outstanding")}
        onExportCsv={list.handleExportCsv}
        onOpenQueue={() => list.setQueueOpen(true)}
        exportNotice={list.exportNotice}
      />

      <ReminderQueue
        open={list.queueOpen}
        onClose={() => list.setQueueOpen(false)}
        rows={list.invoices
          .filter((i) => i.status === "outstanding")
          .map((i) => ({
            id: i.id,
            parent_name: i.parent_name,
            student_names: i.student_names,
            net_amount: i.net_amount,
            reference_number: i.reference_number,
            reminded_at: i.reminded_at,
            wa_number: i.wa_number,
            raw_phone: i.raw_phone,
          }))}
        onOpenChat={(id) => {
          const inv = list.invoices.find((i) => i.id === id);
          if (inv) list.handleWhatsApp(inv, businessName);
        }}
      />

      <InvoiceTable
        loading={list.loading}
        loadError={list.loadError}
        capped={list.capped}
        searchField={list.searchField}
        search={list.search}
        visible={list.visible}
        sort={list.sort}
        markingPaid={list.markingPaid}
        copiedLink={list.copiedLink}
        onMarkPaid={list.handleMarkPaid}
        onWhatsApp={(inv) => list.handleWhatsApp(inv, businessName)}
        onCopyLink={list.copyLink}
      />
    </div>
  );
}
