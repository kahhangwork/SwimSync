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
import * as repo from "./dao/invoices.repo";
import { generateInvoices } from "./dao/invoices.api";
import { useInvoiceList } from "./domain/useInvoiceList";
import { useTenantBilling } from "./domain/useTenantBilling";
import { useUnclaimed } from "./domain/useUnclaimed";
import { useOrphans } from "./domain/useOrphans";
import { usePendingDebits } from "./domain/usePendingDebits";
import { formatBillingMonth } from "./domain/invoiceRows";
import { InvoiceToolbar } from "./ui/InvoiceToolbar";
import { InvoiceTable } from "./ui/InvoiceTable";
import { UnclaimedModal } from "./ui/UnclaimedModal";
import { OrphanReport } from "./ui/OrphanReport";
import { PendingDebits } from "./ui/PendingDebits";
import { GenerationPanel } from "./ui/GenerationPanel";
import { ReminderQueue } from "./ui/ReminderQueue";

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
  // The tenant this admin bills for and its billing schedule (auto/run-day/
  // PayNow/business name), plus loadTenant — domain/useTenantBilling. tenantId
  // is the shared spine the reports and generation read.
  const tenant = useTenantBilling();
  const { tenantId, isPlatformAdmin, businessName } = tenant;
  // Billable lessons with nobody to bill — they hold the month OPEN (the
  // engine's fifth seal condition). The generation run fills this via
  // unclaimed.setUnclaimed (domain/useUnclaimed).
  const unclaimed = useUnclaimed({ genMonth, setGenResult });
  // Lessons recorded into an already-BILLED month (Wave 4) — a STANDING report,
  // loaded per tenant in loadTenant (domain/useOrphans).
  const orphans = useOrphans(tenantId);

  // Pending charges — a correction to an already-paid invoice left money owing
  // (§8.83). Loaded per tenant in loadTenant (domain/usePendingDebits).
  const debits = usePendingDebits(tenantId);
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

  // Resolve the tenant, then load its tenant-scoped reports. tenantId is the
  // shared spine, so the dependent loads chain off the resolved id (which
  // loadTenant returns) rather than racing the state update.
  useEffect(() => {
    tenant.loadTenant().then((tid) => {
      if (tid) {
        orphans.loadOrphans(tid);
        debits.loadPendingDebits(tid);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        if (tenantId) await debits.loadPendingDebits(tenantId);
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
        if (tenantId) await debits.loadPendingDebits(tenantId);
      }
    } catch (e) {
      setGenResult(`Error: ${String(e)}`);
    }
    setGenerating(false);
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
      <PendingDebits
        pendingDebits={debits.pendingDebits}
        writingOff={debits.writingOff}
        pendingDebitError={debits.pendingDebitError}
        onWriteOff={debits.handleWriteOff}
      />

      <OrphanReport
        orphans={orphans.orphans}
        orphanAmount={orphans.orphanAmount}
        setOrphanAmount={orphans.setOrphanAmount}
        orphanSettling={orphans.orphanSettling}
        orphanError={orphans.orphanError}
        onSettle={orphans.handleSettleOrphan}
      />

      <GenerationPanel
        genMonth={genMonth}
        setGenMonth={setGenMonth}
        latestBillableMonth={latestBillableMonth}
        generating={generating}
        onGenerate={() => {
          setGenResult(null);
          setShowConfirm(true);
          loadCoverage(genMonth);
        }}
        genResult={genResult}
        autoEnabled={tenant.autoEnabled}
        togglingAuto={tenant.togglingAuto}
        onToggleAuto={tenant.handleToggleAuto}
        runDay={tenant.runDay}
        setRunDay={tenant.setRunDay}
        savingRunDay={tenant.savingRunDay}
        onSaveRunDay={tenant.handleSaveRunDay}
        paynowUen={tenant.paynowUen}
        setPaynowUen={tenant.setPaynowUen}
        paynowMobile={tenant.paynowMobile}
        setPaynowMobile={tenant.setPaynowMobile}
        onSavePaynow={tenant.handleSavePaynow}
        paynowSaved={tenant.paynowSaved}
      />

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
