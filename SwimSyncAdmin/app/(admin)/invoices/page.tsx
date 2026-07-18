"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { todayInSg, monthBounds, formatSgDate } from "@/lib/lessonDates";
import { computeClassCoverage, type ClassCoverage } from "@/lib/classCoverage";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

type InvoiceRow = {
  id: string;
  billing_month: string;
  gross_amount: number;
  credit_applied: number;
  net_amount: number;
  status: string;
  parent_name: string;
  student_names: string; // first invoice item's student name(s)
};

const STATUS_FILTERS = ["All", "Outstanding", "Paid"];

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
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  // Invoice generation controls
  const currentMonth = todayInSg().slice(0, 7); // YYYY-MM
  const [genMonth, setGenMonth] = useState(currentMonth);
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

    const { data: tenant } = await supabase
      .from("tenants")
      .select("auto_invoice_enabled, invoice_run_day")
      .eq("id", tid)
      .maybeSingle();

    setAutoEnabled(tenant?.auto_invoice_enabled ?? true);
    const n = Number(tenant?.invoice_run_day);
    setRunDay(Number.isFinite(n) && n >= 1 ? Math.min(28, n) : 7);
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
      const classesRes = await supabase
        .from("classes")
        .select("id, title, day_of_week")
        .eq("is_active", true)
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

      const [enrolmentsRes, sessionsRes] = await Promise.all([
        supabase
          .from("student_class_enrolments")
          .select("class_id, student_id, is_active, enrolled_at")
          .in("class_id", classIds),
        supabase
          .from("lesson_sessions")
          .select("id, class_id, session_date")
          .in("class_id", classIds)
          .gte("session_date", bounds.start)
          .lte("session_date", bounds.end),
      ]);
      if (enrolmentsRes.error) throw enrolmentsRes.error;
      if (sessionsRes.error) throw sessionsRes.error;

      const sessionIds = (sessionsRes.data ?? []).map((s) => s.id);
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
          todayInSg()
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
      } else {
        // A deferred parent is billed NOTHING this run (a child of theirs sits
        // in a class with unmarked attendance). Surfaced explicitly — silently
        // reporting "Created 0 invoice(s)" would read as "nothing to bill".
        const deferred = Number(json.parents_deferred ?? 0);
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
              : " Month left open — some attendance is still unmarked.")
        );
        await loadInvoices();
      }
    } catch (e) {
      setGenResult(`Error: ${String(e)}`);
    }
    setGenerating(false);
  }

  async function loadInvoices() {
    setLoading(true);
    const { data } = await supabase
      .from("invoices")
      .select(
        "id, billing_month, gross_amount, credit_applied, net_amount, status, parents(profiles(full_name)), invoice_items(students(full_name))"
      )
      .order("generated_at", { ascending: false });

    setInvoices(
      (data ?? []).map((inv: any) => {
        const studentNames = [
          ...new Set(
            (inv.invoice_items ?? [])
              .map((item: any) => item.students?.full_name)
              .filter(Boolean)
          ),
        ].join(", ");
        return {
          id: inv.id,
          billing_month: inv.billing_month,
          gross_amount: Number(inv.gross_amount),
          credit_applied: Number(inv.credit_applied),
          net_amount: Number(inv.net_amount),
          status: inv.status,
          parent_name: inv.parents?.profiles?.full_name ?? "—",
          student_names: studentNames || "—",
        };
      })
    );
    setLoading(false);
  }

  async function handleMarkPaid(invoiceId: string) {
    setMarkingPaid(invoiceId);
    await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", invoiceId);
    setMarkingPaid(null);
    // Update state locally for instant feedback
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
      inv.status.toLowerCase() === statusFilter.toLowerCase();
    return matchSearch && matchStatus;
  });

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

      {/* Invoice generation panel */}
      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              Billing month
            </label>
            <input
              type="month"
              value={genMonth}
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

          {/* Auto-generation toggle */}
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs font-semibold text-gray-700">
                Automatic monthly generation
              </div>
              <div className="text-[11px] text-gray-400">
                Runs from day {runDay ?? 7} for the previous month
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleAuto}
              disabled={togglingAuto || autoEnabled === null}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                autoEnabled ? "bg-sky-500" : "bg-gray-300"
              } disabled:opacity-50`}
              aria-pressed={!!autoEnabled}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  autoEnabled ? "translate-x-5" : "translate-x-0.5"
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
          <input
            id="run-day"
            type="number"
            min={1}
            max={28}
            value={runDay ?? 7}
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
      </div>

      <Table>
        <Thead>
          <tr>
            <Th>Parent</Th>
            <Th>Student(s)</Th>
            <Th>Month</Th>
            <Th>Gross</Th>
            <Th>Credit</Th>
            <Th>Net</Th>
            <Th>Status</Th>
            <Th>Action</Th>
          </tr>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={8}>
                Loading…
              </Td>
            </Tr>
          ) : filtered.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={8}>
                No invoices found.
              </Td>
            </Tr>
          ) : (
            filtered.map((inv) => (
              <Tr key={inv.id}>
                <Td className="font-medium text-gray-900">{inv.parent_name}</Td>
                <Td className="text-gray-600 text-xs">{inv.student_names}</Td>
                <Td>{formatBillingMonth(inv.billing_month)}</Td>
                <Td>S${inv.gross_amount.toFixed(2)}</Td>
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
                </Td>
                <Td>
                  {inv.status === "outstanding" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={markingPaid === inv.id}
                      onClick={() => handleMarkPaid(inv.id)}
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      {markingPaid === inv.id ? "Saving…" : "Mark Paid"}
                    </Button>
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
