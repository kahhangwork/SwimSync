"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Download, Link as LinkIcon, MessageCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { exportCsv, type CsvColumn } from "@/lib/csv";
import {
  todayInSg,
  monthBounds,
  formatSgDate,
  previousBillingMonth,
} from "@/lib/lessonDates";
import { computeClassCoverage, type ClassCoverage } from "@/lib/classCoverage";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { blankToNull, checkSgPhone, normalizeSgPhone } from "@/lib/sgPhone";
import { settlementPayload } from "@/lib/settlementPayload";
import { buildReminderMessage, buildWaLink, toWaNumber } from "@/lib/waMessage";
import { ReminderQueue } from "./ReminderQueue";

type InvoiceRow = {
  id: string;
  billing_month: string;
  gross_amount: number;
  package_applied: number;
  credit_applied: number;
  net_amount: number;
  status: string;
  parent_name: string;
  student_names: string; // first invoice item's student name(s)
  reference_number: string;
  public_token: string;
  /** When the admin last OPENED a WhatsApp chat for this invoice. It does
   *  not prove a message was sent — copy must read "chat opened". */
  reminded_at: string | null;
  /** The parent's "I've paid" claim — check the bank, then confirm. */
  paid_claimed_at: string | null;
  /** wa.me-ready "65XXXXXXXX", or null → the button reads "no number". */
  wa_number: string | null;
  /** What the parent actually typed — the queue's advisory when unusable. */
  raw_phone: string | null;
  student_name_list: string[];
};

/** Mirrors GenerateResult.unclaimed_students in the billing engine. */
type UnclaimedStudent = {
  student_id: string;
  student_name: string | null;
  lessons: number;
  earliest_session_date: string;
  latest_session_date: string;
};

/** Mirrors unbilled_sealed_lessons() in the database — one line per
 *  (student, SEALED month). Same shape as UnclaimedStudent plus the month,
 *  because the admin needs the same thing in both places: enough to date a
 *  settlement. These lessons entered the month AFTER it was billed (backdated
 *  enrolment, backdated make-up, absent→present correction), so the engine can
 *  never see them — this standing report is the only thing that can. */
type OrphanLine = UnclaimedStudent & { billing_month: string };

// CSV export — what's on screen (post-filter/sort `visible`), raw values so an
// accountant can sum the money columns. Month stays the raw YYYY-MM (sortable in
// Excel); status is the badge label, not the lowercased enum.
const INVOICE_CSV_COLUMNS: CsvColumn<InvoiceRow>[] = [
  { header: "Parent", value: (r) => r.parent_name },
  { header: "Students", value: (r) => r.student_names },
  { header: "Month", value: (r) => r.billing_month },
  { header: "Gross", value: (r) => r.gross_amount },
  { header: "Package", value: (r) => r.package_applied },
  { header: "Credit", value: (r) => r.credit_applied },
  { header: "Net", value: (r) => r.net_amount },
  { header: "Status", value: (r) => (r.status === "paid" ? "Paid" : "Outstanding") },
  { header: "Parent says paid", value: (r) => (r.paid_claimed_at ? "yes" : "") },
  { header: "Reference", value: (r) => r.reference_number },
];

// "Claimed" = outstanding AND the parent has said "I've paid" — the rows an
// admin should check against the bank first.
const STATUS_FILTERS = ["All", "Outstanding", "Claimed", "Paid"];

function formatBillingMonth(ym: string): string {
  const [year, month] = ym.split("-");
  return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString(
    "en-SG",
    { month: "short", year: "numeric" }
  );
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

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
  const [queueOpen, setQueueOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  // Students with billable attendance and no parent account to bill. They hold
  // the month OPEN (the engine's fifth seal condition), so the remedy has to be
  // reachable from right here — an admin sent to another page to find them is
  // an admin who does not come back.
  const [unclaimed, setUnclaimed] = useState<UnclaimedStudent[]>([]);
  const [settling, setSettling] = useState<string | null>(null);
  // Amount per student for the "paid outside SwimSync" path. Required by the
  // DB, deliberately: student_settlements CHECKs that a paid_outside row
  // carries an amount, so "the money arrived" can never be recorded without
  // saying how much. That is what makes these rows summable later
  // (BACKLOG → Revenue reporting).
  const [settleAmount, setSettleAmount] = useState<Record<string, string>>({});
  const [settleError, setSettleError] = useState<string | null>(null);
  // Lessons recorded into an already-BILLED month (Wave 4). Separate state from
  // `unclaimed` — that one is a generation-run result and lives in a modal;
  // this is a STANDING report that must persist until each line is settled,
  // because the failure mode it exists for is silence. Keyed per
  // (student, month): the same child can be orphaned in two sealed months.
  const [orphans, setOrphans] = useState<OrphanLine[]>([]);
  const [orphanSettling, setOrphanSettling] = useState<string | null>(null);
  const [orphanAmount, setOrphanAmount] = useState<Record<string, string>>({});
  const [orphanError, setOrphanError] = useState<string | null>(null);
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
    loadInvoices();
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
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, tenant_id")
      .eq("id", auth.user.id)
      .maybeSingle();

    setIsPlatformAdmin(profile?.role === "platform_admin");
    const tid = (profile?.tenant_id as string | null) ?? null;
    setTenantId(tid);
    if (!tid) return;
    loadOrphans(tid);

    const { data: tenant } = await supabase
      .from("tenants")
      .select(
        "display_name, auto_invoice_enabled, invoice_run_day, paynow_uen, paynow_mobile"
      )
      .eq("id", tid)
      .maybeSingle();

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
    const { error } = await supabase
      .from("tenants")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", tenantId);
    setPaynowSaved(error ? `Error: ${error.message}` : "PayNow details saved.");
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
    const { error } = await supabase
      .from("tenants")
      .update({ invoice_run_day: clamped, updated_at: new Date().toISOString() })
      .eq("id", tenantId);
    if (!error) setRunDay(clamped);
    setSavingRunDay(false);
  }

  async function handleToggleAuto() {
    if (autoEnabled === null || !tenantId) return;
    setTogglingAuto(true);
    const next = !autoEnabled;
    const { error } = await supabase
      .from("tenants")
      .update({ auto_invoice_enabled: next, updated_at: new Date().toISOString() })
      .eq("id", tenantId!);
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
      // reassurance this dialog exists to prevent.
      // ⚠ NO `is_active` FILTER, DELIBERATELY — and `deactivated_at` comes with
      // it. The ENGINE bills every class, active or not, and keeps a retired
      // class's recorded sessions in its completeness gate (core.ts). While
      // this query filtered `is_active`, a retired class holding an unmarked
      // lesson blocked generation and was invisible to this dialog: the admin
      // read "all marked", pressed Generate, and got a refusal naming a class
      // on no screen they could reach — §8.32's deadlock on a visibility axis.
      // computeClassCoverage() clamps a retired class's WEEKLY expectation at
      // `deactivated_at` (a DATE, §7.109) while still reporting sessions that
      // genuinely ran, which is the engine's rule exactly. §7.18.
      const classesRes = await supabase
        .from("classes")
        .select("id, title, day_of_week, is_active, deactivated_at")
        .eq("tenant_id", tenantId!);
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
          supabase
            .from("student_class_enrolments")
            // unenrolled_at is needed as well as enrolled_at: who must be marked
            // is a question about the LESSON'S date, so an enrolment is a span,
            // not a flag. See EnrolmentSpan in lib/attendanceCompleteness.ts.
            .select("class_id, student_id, is_active, enrolled_at, unenrolled_at")
            .in("class_id", classIds),
          supabase
            .from("lesson_sessions")
            .select("id, class_id, session_date")
            .in("class_id", classIds)
            .gte("session_date", bounds.start)
            .lte("session_date", bounds.end),
          // Trial AND make-up bookings. Without these this check and the
          // ENGINE disagree: the engine expects a booked child on their lesson
          // and refuses to seal, while this dialog would report the month all
          // clear. §7.18 is exactly that divergence, and it cost a live
          // underbill. Both kinds satisfy the same "expected at one lesson"
          // contract, so they merge into one bookings list.
          supabase
            .from("trial_bookings")
            .select("class_id, student_id, session_date")
            .in("class_id", classIds)
            .is("cancelled_at", null)
            .gte("session_date", bounds.start)
            .lte("session_date", bounds.end),
          supabase
            .from("makeup_bookings")
            .select("class_id, student_id, session_date")
            .in("class_id", classIds)
            .is("cancelled_at", null)
            .gte("session_date", bounds.start)
            .lte("session_date", bounds.end),
        ]);
      if (enrolmentsRes.error) throw enrolmentsRes.error;
      if (sessionsRes.error) throw sessionsRes.error;
      if (bookingsRes.error) throw bookingsRes.error;
      if (makeupsRes.error) throw makeupsRes.error;

      const sessionIds = (sessionsRes.data ?? []).map((s) => s.id);
      // NB the attendance select below is by SESSION, not by student, so a
      // booked child's row is already included — no second query needed.
      const attendanceRes = sessionIds.length
        ? await supabase
            .from("attendance")
            .select("lesson_session_id, student_id")
            .in("lesson_session_id", sessionIds)
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
    } = await supabase.auth.getSession();
    try {
      const res = await fetch("/api/generate-invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ billing_month: genMonth }),
      });
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
        setUnclaimed(json.unclaimed_students ?? []);
        const n = Number(json.unclaimed_billable);
        setGenResult(
          `Created ${json.invoices_created ?? 0} invoice(s) for ${formatBillingMonth(
            genMonth
          )}. Month left open — ${n} billable lesson${
            n === 1 ? "" : "s"
          } have no parent account to bill.`
        );
        await loadInvoices();
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
        await loadInvoices();
      }
    } catch (e) {
      setGenResult(`Error: ${String(e)}`);
    }
    setGenerating(false);
  }

  /**
   * Record that an unclaimed student's lessons are settled — the money arrived
   * outside SwimSync, or is being written off. Either way the month can then
   * close.
   *
   * `settled_through` is the student's LATEST unbilled lesson in this run, not
   * "today": the settlement must cover exactly what was reported and no more,
   * so a lesson they attend next month still blocks and is still decided
   * deliberately.
   */
  async function handleSettle(
    u: UnclaimedStudent,
    kind: "paid_outside" | "written_off",
    amount: number | null
  ) {
    setSettling(u.student_id);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: student } = await supabase
      .from("students")
      .select("tenant_id")
      .eq("id", u.student_id)
      .single();

    const { error } = await supabase.from("student_settlements").insert(
      settlementPayload({
        tenantId: student?.tenant_id,
        studentId: u.student_id,
        settledThrough: u.latest_session_date,
        kind,
        amount,
        recordedBy: user?.id,
      })
    );

    setSettling(null);
    if (error) {
      // Shown INSIDE the modal. genResult renders on the page behind it, so an
      // error surfaced there is invisible while the dialog is open — which is
      // how a failing insert first looked like a silent no-op.
      setSettleError(error.message);
      return;
    }
    setSettleError(null);
    setUnclaimed((prev) => prev.filter((x) => x.student_id !== u.student_id));
    setGenResult(
      `Recorded for ${u.student_name ?? "that student"}. Generate again to close ` +
        `${formatBillingMonth(genMonth)}.`
    );
  }

  /** The standing orphan-lesson report (Wave 4). Server-computed: the
   *  predicate ("billable, inside a sealed month, no invoice line, no live
   *  settlement") lives in unbilled_sealed_lessons() where pgTAP pins it —
   *  not re-derived here, where it would drift. */
  async function loadOrphans(tid: string) {
    const { data, error } = await supabase.rpc("unbilled_sealed_lessons", {
      p_tenant: tid,
    });
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
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("student_settlements").insert(
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

  async function loadInvoices() {
    setLoading(true);
    const { data } = await supabase
      .from("invoices")
      .select(
        "id, billing_month, gross_amount, package_applied, credit_applied, net_amount, status, reference_number, public_token, reminded_at, paid_claimed_at, parents(profiles(full_name, phone)), invoice_items(student_name, students(full_name))"
      )
      .order("generated_at", { ascending: false });

    setInvoices(
      (data ?? []).map((inv: any) => {
        const nameList: string[] = [
          ...new Set(
            (inv.invoice_items ?? [])
              .map((item: any) => item.student_name ?? item.students?.full_name)
              .filter(Boolean)
          ),
        ] as string[];
        return {
          id: inv.id,
          billing_month: inv.billing_month,
          gross_amount: Number(inv.gross_amount),
          package_applied: Number(inv.package_applied),
          credit_applied: Number(inv.credit_applied),
          net_amount: Number(inv.net_amount),
          status: inv.status,
          parent_name: inv.parents?.profiles?.full_name ?? "—",
          student_names: nameList.join(", ") || "—",
          reference_number: inv.reference_number ?? "—",
          public_token: inv.public_token ?? "",
          reminded_at: inv.reminded_at ?? null,
          paid_claimed_at: inv.paid_claimed_at ?? null,
          wa_number: toWaNumber(inv.parents?.profiles?.phone ?? null),
          raw_phone: inv.parents?.profiles?.phone ?? null,
          student_name_list: nameList,
        };
      })
    );
    setLoading(false);
  }

  /** The tokenized public page for an invoice — what the WhatsApp message
   *  links to (the QR rides on the page; wa.me links cannot carry images). */
  function invoiceLink(inv: InvoiceRow): string {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://swimsync.sg";
    return `${base}/invoice/${inv.public_token}`;
  }

  /** Opens the pre-filled chat, then stamps reminded_at. The stamp means
   *  "chat opened", NOT "message sent" — the admin still presses Send, and
   *  the button stays enabled so re-opening is always possible. */
  async function handleWhatsApp(inv: InvoiceRow, businessName: string) {
    if (!inv.wa_number) return;
    const message = buildReminderMessage({
      businessName,
      studentNames: inv.student_name_list,
      billingMonth: inv.billing_month,
      amount: inv.net_amount,
      link: invoiceLink(inv),
      reference: inv.reference_number,
    });
    window.open(buildWaLink(inv.wa_number, message), "_blank", "noopener");
    const stamp = new Date().toISOString();
    const { error } = await supabase
      .from("invoices")
      .update({ reminded_at: stamp })
      .eq("id", inv.id);
    if (!error) {
      setInvoices((prev) =>
        prev.map((row) => (row.id === inv.id ? { ...row, reminded_at: stamp } : row))
      );
    }
  }

  async function handleMarkPaid(invoiceId: string) {
    setMarkingPaid(invoiceId);
    // ONE mark-paid path for every client (PRD §7.21): the RPC writes
    // status + paid_at + paid_marked_by + the payment_records audit row
    // atomically. This page's old direct UPDATE wrote neither audit field.
    const { error } = await supabase.rpc("confirm_invoice_paid", {
      p_invoice_id: invoiceId,
    });
    setMarkingPaid(null);
    if (error) return;
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === invoiceId ? { ...inv, status: "paid" } : inv
      )
    );
  }

  const filtered = invoices.filter((inv) => {
    const matchSearch =
      inv.parent_name.toLowerCase().includes(search.toLowerCase()) ||
      inv.student_names.toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === "All" ||
      (statusFilter === "Claimed"
        ? inv.status === "outstanding" && inv.paid_claimed_at !== null
        : inv.status.toLowerCase() === statusFilter.toLowerCase());
    return matchSearch && matchStatus;
  });

  const sort = useTableSort<InvoiceRow>({
    // Newest billing month first, which is the order the query already returns
    // and the one an admin chasing payment wants.
    key: "billing_month",
    dir: "desc",
    accessors: {
      // Sort the AMOUNTS, not the rendered "−S$40.00" strings — a currency
      // string sorts by its leading character, so a minus sign and a dash would
      // decide the order before the number did.
      status: (inv) => (inv.status === "outstanding" ? "Outstanding" : "Paid"),
    },
  });
  const visible = sort.apply(filtered);

  function handleExportCsv() {
    const res = exportCsv(
      `invoices-${todayInSg()}.csv`,
      visible,
      INVOICE_CSV_COLUMNS,
      { sourceCount: invoices.length },
    );
    setExportNotice(
      res.ok
        ? null
        : `Too many invoices to export at once (the list is capped at ${res.cap}). ` +
            `Narrow it with the status filter, search, or a month, then export again.`,
    );
  }

  const totalOutstanding = invoices
    .filter((i) => i.status === "outstanding")
    .reduce((sum, i) => sum + i.net_amount, 0);

  const hasGaps = (coverage ?? []).some((c) => c.missingDates.length > 0);

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={`Total outstanding: S$${totalOutstanding.toFixed(2)}`}
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

      {/* ── Billable lessons with nobody to bill ────────────────────────────
          These hold the month OPEN (the engine's fifth seal condition). The
          remedy is offered INLINE rather than as a link elsewhere: this is the
          one screen where the admin is already thinking about closing the
          month, and a single forgotten walk-in stalls every family's invoice.
          There is deliberately no bulk "settle all" — that would turn a
          deliberate decision about money into one careless tap. */}
      <Modal
        title="Some lessons have no parent account to bill"
        open={unclaimed.length > 0}
        onClose={() => setUnclaimed([])}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            These children attended billable lessons but have no parent account
            yet, so nobody can be invoiced. {formatBillingMonth(genMonth)} stays
            open until each is resolved — otherwise the month would close over
            them and the lessons could never be billed, even after the parent
            registers.
          </p>

          <ul className="space-y-3">
            {unclaimed.map((u) => (
              <li
                key={u.student_id}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
              >
                <p className="text-sm font-semibold text-gray-800">
                  {u.student_name ?? "Unnamed student"}
                </p>
                <p className="mt-0.5 text-xs text-gray-600">
                  {u.lessons} billable lesson{u.lessons === 1 ? "" : "s"} ·{" "}
                  {u.earliest_session_date === u.latest_session_date
                    ? formatSgDate(u.earliest_session_date)
                    : `${formatSgDate(u.earliest_session_date)} – ${formatSgDate(
                        u.latest_session_date
                      )}`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 text-xs text-gray-600">
                    S$
                    <input
                      value={settleAmount[u.student_id] ?? ""}
                      onChange={(e) =>
                        setSettleAmount((prev) => ({
                          ...prev,
                          [u.student_id]: e.target.value,
                        }))
                      }
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={`Amount received for ${u.student_name ?? "student"}`}
                      className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={
                      settling === u.student_id ||
                      !(Number(settleAmount[u.student_id]) > 0)
                    }
                    onClick={() =>
                      handleSettle(
                        u,
                        "paid_outside",
                        Number(settleAmount[u.student_id])
                      )
                    }
                  >
                    Paid outside SwimSync
                  </Button>
                  <Button
                    variant="outline"
                    disabled={settling === u.student_id}
                    onClick={() => handleSettle(u, "written_off", null)}
                  >
                    Write off
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {settleError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {settleError}
            </p>
          )}

          <p className="text-xs text-gray-600">
            The better fix is usually to <strong>invite the parent</strong> from
            the Students page — then the lessons bill normally and nothing is
            written off. Settle only when the money was genuinely handled
            elsewhere, or is not being collected.
          </p>
          <Button className="w-full" onClick={() => setUnclaimed([])}>
            Close
          </Button>
        </div>
      </Modal>

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

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by parent or student..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 w-56"
        />
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                statusFilter === f
                  ? "bg-sky-500 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            disabled={visible.length === 0}
            onClick={handleExportCsv}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            disabled={invoices.every((i) => i.status !== "outstanding")}
            onClick={() => setQueueOpen(true)}
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp reminders
          </Button>
        </div>
      </div>
      {exportNotice && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {exportNotice}
        </div>
      )}

      <ReminderQueue
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        rows={invoices
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
          const inv = invoices.find((i) => i.id === id);
          if (inv) handleWhatsApp(inv, businessName);
        }}
      />

      <Table>
        <Thead>
          <Th sort={sort} sortKey="parent_name">Parent</Th>
          <Th sort={sort} sortKey="student_names">Student(s)</Th>
          <Th sort={sort} sortKey="billing_month" firstDir="desc">Month</Th>
          <Th sort={sort} sortKey="gross_amount" firstDir="desc">Gross</Th>
          <Th sort={sort} sortKey="package_applied" firstDir="desc">Package</Th>
          <Th sort={sort} sortKey="credit_applied" firstDir="desc">Credit</Th>
          <Th sort={sort} sortKey="net_amount" firstDir="desc">Net</Th>
          <Th sort={sort} sortKey="status">Status</Th>
          <Th>Action</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={9}>
                Loading…
              </Td>
            </Tr>
          ) : visible.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={9}>
                No invoices found.
              </Td>
            </Tr>
          ) : (
            visible.map((inv) => (
              <Tr key={inv.id}>
                <Td className="font-medium text-gray-900">{inv.parent_name}</Td>
                <Td className="text-gray-600 text-xs">{inv.student_names}</Td>
                <Td>{formatBillingMonth(inv.billing_month)}</Td>
                <Td>S${inv.gross_amount.toFixed(2)}</Td>
                <Td className="text-blue-600">
                  {inv.package_applied > 0
                    ? `−S$${inv.package_applied.toFixed(2)}`
                    : "—"}
                </Td>
                <Td className="text-blue-600">
                  {inv.credit_applied > 0
                    ? `−S$${inv.credit_applied.toFixed(2)}`
                    : "—"}
                </Td>
                <Td
                  className={`font-semibold ${
                    inv.status === "outstanding"
                      ? "text-red-600"
                      : "text-green-600"
                  }`}
                >
                  S${inv.net_amount.toFixed(2)}
                </Td>
                <Td>
                  <StatusBadge
                    status={
                      inv.status === "outstanding" ? "Outstanding" : "Paid"
                    }
                  />
                  {inv.status === "outstanding" && inv.paid_claimed_at && (
                    <div
                      className="text-[10px] text-sky-700 mt-0.5"
                      title="The parent tapped 'I've paid' — check your bank, then Mark Paid"
                    >
                      parent says paid{" "}
                      {new Date(inv.paid_claimed_at).toLocaleDateString("en-SG")}
                    </div>
                  )}
                </Td>
                <Td>
                  {inv.status === "outstanding" && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={markingPaid === inv.id}
                        onClick={() => handleMarkPaid(inv.id)}
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        {markingPaid === inv.id ? "Saving…" : "Mark Paid"}
                      </Button>
                      {/* Stays enabled after the stamp — opening a chat is
                          not sending a message, so re-opening must always be
                          possible. "No number" is a visible state, never a
                          broken link. */}
                      {inv.wa_number ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleWhatsApp(inv, businessName)}
                          title={
                            inv.reminded_at
                              ? `Chat opened ${new Date(inv.reminded_at).toLocaleDateString("en-SG")}`
                              : "Open a pre-filled WhatsApp chat"
                          }
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          WhatsApp
                        </Button>
                      ) : (
                        <span
                          className="text-[11px] text-gray-400"
                          title="This parent has no usable phone number"
                        >
                          no number
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Copy the invoice's payment link"
                        onClick={() => {
                          navigator.clipboard?.writeText(invoiceLink(inv));
                          setCopiedLink(inv.id);
                          setTimeout(() => setCopiedLink(null), 1500);
                        }}
                      >
                        <LinkIcon className="h-3.5 w-3.5" />
                        {copiedLink === inv.id ? "Copied" : "Link"}
                      </Button>
                    </div>
                  )}
                  {inv.status === "outstanding" && inv.reminded_at && (
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      chat opened{" "}
                      {new Date(inv.reminded_at).toLocaleDateString("en-SG")}
                    </div>
                  )}
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
