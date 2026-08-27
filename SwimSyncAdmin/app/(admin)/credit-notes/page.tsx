"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { exportCsv, type CsvColumn } from "@/lib/csv";
import { todayInSg } from "@/lib/lessonDates";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import { PackageChip } from "@/components/PackageChip";
import {
  creditNoteEmailView,
  resendBlockedLabel,
} from "@/lib/creditNoteEmailState";
import {
  creditNoteVoidView,
  voidConfirmMessage,
} from "@/lib/creditNoteVoidState";
import { ilikeContains } from "@/lib/tableSearch";
import { useDebouncedValue } from "@/components/useDebouncedValue";

/** PostgREST caps every fetch at max_rows (1000); this many back means the list
 *  is (probably) truncated and search is how to reach past it (⚠ RISK 3). */
const ROW_LIMIT = 1000;

/** The one column the scoped search targets — pushed into the DB as a bound
 *  `.ilike` so it reaches every note, not just the first 1000. */
type SearchField = "student" | "parent" | "reference";

type CreditNoteRow = {
  id: string;
  reference_number: string;
  student_id: string;
  student_name: string;
  parent_name: string;
  amount: number;
  reason: string | null;
  linked_invoice_id: string | null;
  created_at: string;
  status: string; // "applied" | "available" | "reversed"
  // ── Email delivery (docs/plans/CREDIT_NOTE_EMAIL_PLAN.md) ──────────────────
  email_sent_at: string | null;
  tenant_id: string;
  applied_to_invoice_id: string | null;
  /** ⚠ RISK 2 — status stays 'available' while a note is PARTLY drawn down. Counts
   *  LIVE draws only (reversed_at IS NULL): a voided-then-reactivated note carries
   *  reversed rows that are no longer "spent", so counting them would wrongly block
   *  the resend AND read as drawn on the void confirm (Item 3, RISK 6). */
  has_applications: boolean;
};

const STATUS_FILTERS = ["All", "Applied", "Available", "Reversed"];

// A note voided by an un-correction (status 'reversed', 20260818000100) must NOT
// read as "Available" — it is no longer live credit. One helper so the label, the
// filter, the sort and the CSV all agree.
function creditNoteStatusLabel(status: string): string {
  if (status === "applied") return "Applied";
  if (status === "reversed") return "Reversed";
  return "Available";
}

// CSV export — what's on screen (post-filter/sort). Amounts raw for summing;
// the linked invoice is exported as the full id (the table truncates it), date
// is the raw YYYY-MM-DD, and "Emailed" reflects whether the parent was notified.
const CREDIT_NOTE_CSV_COLUMNS: CsvColumn<CreditNoteRow>[] = [
  { header: "Reference", value: (r) => r.reference_number },
  { header: "Student", value: (r) => r.student_name },
  { header: "Parent", value: (r) => r.parent_name },
  { header: "Amount", value: (r) => r.amount },
  { header: "Reason", value: (r) => r.reason },
  { header: "Linked Invoice", value: (r) => r.linked_invoice_id },
  { header: "Date", value: (r) => r.created_at },
  { header: "Status", value: (r) => creditNoteStatusLabel(r.status) },
  { header: "Emailed", value: (r) => (r.email_sent_at ? "yes" : "no") },
];

export default function CreditNotesPage() {
  const [notes, setNotes] = useState<CreditNoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<SearchField>("student");
  const debouncedSearch = useDebouncedValue(search);
  const [capped, setCapped] = useState(false);
  // Only the newest loadNotes() may write — an old term's slow response must not
  // overwrite a newer one.
  const noteSeq = useRef(0);
  const [statusFilter, setStatusFilter] = useState("All");
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );
  // ⚠ RISK 4 — the viewer's OWN role and tenant, never a value off a row. The
  // select below is unfiltered and leans on RLS, which hands a platform admin every
  // business's notes; only a TENANT admin of a note's own business may email it.
  const [viewer, setViewer] = useState<{
    role: string | null;
    tenantId: string | null;
    adminDisabled: boolean;
  }>({ role: null, tenantId: null, adminDisabled: true }); // deny-by-default until loaded
  // A SET, not one slot: with a single `resendingId`, pressing Resend on B while A is
  // in flight re-enabled A's button, and A's completion then cleared B's marker —
  // producing spurious red errors on notes that had in fact just been emailed.
  const [resending, setResending] = useState<Set<string>>(new Set());
  const [resendError, setResendError] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  // Void flow: which note's inline confirm is open, its reason, in-flight set, errors.
  const [voidOpen, setVoidOpen] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState<Set<string>>(new Set());
  const [voidError, setVoidError] = useState<Record<string, string>>({});

  useEffect(() => {
    // Payment-method chips: fire-and-forget, a failed RPC only means no chips.
    supabase
      .rpc("student_package_coverage")
      .then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])));
    // The viewer's OWN role/tenant, loaded once — email authority keys on it.
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, tenant_id, admin_disabled_at")
          .eq("id", auth.user.id)
          .maybeSingle();
        setViewer({
          role: profile?.role ?? null,
          tenantId: profile?.tenant_id ?? null,
          adminDisabled: profile?.admin_disabled_at != null,
        });
      }
    })();
  }, []);

  // Runs on mount, and again whenever the scoped search changes.
  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, searchField]);

  async function loadNotes() {
    const seq = ++noteSeq.current;
    const term = search.trim();

    // ⚠ !inner ONLY on the embed being SEARCHED (parent). A filter on a plain
    // (left) embed returns every note with a null embed — the silent wrong
    // answer. Student and Reference are BASE columns, so they need no embed
    // change. Left plain otherwise, so the default list keeps notes whose parent
    // account has since gone.
    const parentEmbed =
      term !== "" && searchField === "parent"
        ? "parents!inner(profiles!inner(full_name))"
        : "parents(profiles(full_name))";

    let query = supabase
      .from("credit_notes")
      // ⚠ RISK 2 — credit_applications comes back as an EMBED, not a second query.
      // With no filter/limit/error-check it made `has_applications` false on every
      // row (a db-max-rows truncation), silently disarming the part-spent guard.
      // As an embed it is scoped to the notes loaded and shares this error path.
      .select(
        `id, reference_number, amount, reason, status, applied_to_invoice_id, issued_at, student_name, email_sent_at, tenant_id, credit_applications(credit_note_id, reversed_at), students(id, full_name), ${parentEmbed}`
      )
      .order("issued_at", { ascending: false })
      .limit(ROW_LIMIT);

    // Scoped, in the DB. Student and Reference are base columns; Parent rides the
    // profiles embed. Bound `.ilike`, so a `, ( )` in a name is literal.
    if (term !== "") {
      if (searchField === "parent") {
        query = query.ilike("parents.profiles.full_name", ilikeContains(term));
      } else if (searchField === "reference") {
        query = query.ilike("reference_number", ilikeContains(term));
      } else {
        query = query.ilike("student_name", ilikeContains(term));
      }
    }

    const { data, error } = await query;
    if (seq !== noteSeq.current) return;

    if (error) {
      // Surfaced, not defaulted to "nothing is applied" — see ⚠ RISK 2 above.
      setLoadError(`Could not load credit notes: ${error.message}`);
      setLoading(false);
      return;
    }
    setLoadError(null);
    setCapped((data ?? []).length >= ROW_LIMIT);

    setNotes(
      (data ?? []).map((cn: any) => ({
        id: cn.id,
        reference_number: cn.reference_number,
        student_id: cn.students?.id ?? "",
        student_name: cn.student_name ?? cn.students?.full_name ?? "—",
        parent_name: cn.parents?.profiles?.full_name ?? "—",
        amount: Number(cn.amount),
        reason: cn.reason,
        linked_invoice_id: cn.applied_to_invoice_id,
        created_at: cn.issued_at?.split("T")[0] ?? "—",
        status: cn.status,
        email_sent_at: cn.email_sent_at ?? null,
        tenant_id: cn.tenant_id,
        applied_to_invoice_id: cn.applied_to_invoice_id ?? null,
        has_applications: (cn.credit_applications ?? []).some(
          (a: { reversed_at: string | null }) => a.reversed_at === null
        ),
      }))
    );
    setLoading(false);
  }

  // Resend one note's notification. The edge function re-checks authority and
  // refuses an applied note on its own; this only stops a doomed press.
  /** Human copy for the reasons the function can return. */
  function resendReasonLabel(reason: string): string {
    switch (reason) {
      case "already-applied":
        return "That credit has already been used on an invoice.";
      case "invoice-line-already-emailed":
        return "This lesson's credit was already emailed.";
      case "no-snapshot":
        return "That credit note is missing its invoice details.";
      case "tenant suspended":
        return "This business is suspended, so no email was sent.";
      case "not allowed":
        return "You do not administer this business.";
      default:
        return reason;
    }
  }

  const markEmailed = (noteId: string) =>
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId ? { ...n, email_sent_at: new Date().toISOString() } : n
      )
    );

  async function resend(noteId: string) {
    setResending((prev) => new Set(prev).add(noteId));
    setResendError((prev) => {
      const { [noteId]: _drop, ...rest } = prev;
      return rest;
    });

    const { data, error } = await supabase.functions.invoke(
      "credit-note-emails",
      { body: { credit_note_id: noteId } }
    );

    setResending((prev) => {
      const next = new Set(prev);
      next.delete(noteId);
      return next;
    });

    const sent = (data as { sent?: number } | null)?.sent ?? 0;
    const reason = (data as { reason?: string } | null)?.reason;

    // "nothing to send" means it is ALREADY emailed — the coach's save may have
    // beaten this press by a second. Showing a red error there is wrong twice over:
    // it reads as a failure, and it left the row saying "Not emailed" with a live
    // button, because the optimistic update only ran on success.
    if (reason === "nothing to send") {
      markEmailed(noteId);
      return;
    }

    if (error || sent < 1) {
      // Inline, never an Alert — this is a web page (and Alert.alert is a no-op on
      // RN-web anyway, which is why the coach app has the same rule).
      setResendError((prev) => ({
        ...prev,
        [noteId]: reason
          ? resendReasonLabel(reason)
          : error?.message ?? "Not sent.",
      }));
      return;
    }
    markEmailed(noteId);
  }

  // Void one note. The RPC re-checks authority + already-reversed on its own; this
  // reopens any drawn invoice server-side. On success the row goes 'reversed' and
  // its live-application flag clears, so the Void button and any Resend disappear.
  async function voidNote(cn: CreditNoteRow) {
    const reason = voidReason.trim();
    if (!reason) {
      setVoidError((prev) => ({ ...prev, [cn.id]: "A reason is required." }));
      return;
    }
    setVoiding((prev) => new Set(prev).add(cn.id));
    setVoidError((prev) => {
      const { [cn.id]: _drop, ...rest } = prev;
      return rest;
    });

    const { error } = await supabase.rpc("void_credit_note", {
      p_note_id: cn.id,
      p_reason: reason,
    });

    setVoiding((prev) => {
      const next = new Set(prev);
      next.delete(cn.id);
      return next;
    });

    if (error) {
      // Inline, never an Alert. The RPC's messages are admin-readable as-is.
      setVoidError((prev) => ({ ...prev, [cn.id]: error.message }));
      return;
    }

    setNotes((prev) =>
      prev.map((n) =>
        n.id === cn.id
          ? { ...n, status: "reversed", has_applications: false, applied_to_invoice_id: null }
          : n
      )
    );
    setVoidOpen(null);
    setVoidReason("");
  }

  // Search moved into the DB (scoped, past the 1000-row cap); the status filter
  // refines the fetched set here.
  const filtered = notes.filter((cn) => {
    const label = creditNoteStatusLabel(cn.status);
    return statusFilter === "All" || label === statusFilter;
  });

  const sort = useTableSort<CreditNoteRow>({
    key: "created_at",
    dir: "desc",
    accessors: {
      status: (cn) => creditNoteStatusLabel(cn.status),
    },
  });
  const visible = sort.apply(filtered);

  function handleExportCsv() {
    const res = exportCsv(
      `credit-notes-${todayInSg()}.csv`,
      visible,
      CREDIT_NOTE_CSV_COLUMNS,
      { sourceCount: notes.length },
    );
    setExportNotice(
      res.ok
        ? null
        : `Too many credit notes to export at once (the list is capped at ${res.cap}). ` +
            `Narrow it with the status filter or search, then export again.`,
    );
  }

  return (
    <div>
      <PageHeader
        title="Credit Notes"
        subtitle="Auto-issued when attendance is corrected post-invoice — amounts are immutable; the parent's notification can be resent"
      />

      {loadError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        {/* Scoped search — the dropdown picks the column the term is pushed into,
            so it reaches every note in the DB, not the first 1000 (⚠ RISK 3). */}
        <div className="flex overflow-hidden rounded-xl border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-sky-400">
          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value as SearchField)}
            className="border-r border-gray-200 bg-gray-50 px-2 py-2.5 text-sm text-gray-600 focus:outline-none"
            aria-label="Search by"
          >
            <option value="student">Student</option>
            <option value="parent">Parent</option>
            <option value="reference">Reference</option>
          </select>
          <input
            type="text"
            placeholder={
              searchField === "parent"
                ? "Search parent name…"
                : searchField === "reference"
                ? "Search reference…"
                : "Search student name…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-52 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none"
          />
        </div>
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
        <div className="ml-auto">
          <Button
            variant="outline"
            disabled={visible.length === 0}
            onClick={handleExportCsv}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>
      {exportNotice && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {exportNotice}
        </div>
      )}

      {!loading && capped && (
        <p className="mb-3 text-sm text-amber-700">
          Showing the first {ROW_LIMIT}{" "}
          {search.trim() ? "matches" : "credit notes"}.{" "}
          {search.trim()
            ? "Refine your search to narrow them."
            : "Search to find a specific one."}
        </p>
      )}

      <Table>
        <Thead>
          <Th sort={sort} sortKey="reference_number">Reference</Th>
          <Th sort={sort} sortKey="student_name">Student</Th>
          <Th sort={sort} sortKey="parent_name">Parent</Th>
          <Th sort={sort} sortKey="amount" firstDir="desc">Amount</Th>
          <Th sort={sort} sortKey="reason" wrap>Reason</Th>
          <Th sort={sort} sortKey="linked_invoice_id">Linked Invoice</Th>
          <Th sort={sort} sortKey="created_at" firstDir="desc">Date</Th>
          <Th sort={sort} sortKey="status">Status</Th>
          <Th>Parent notified</Th>
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
                No credit notes found.
              </Td>
            </Tr>
          ) : (
            visible.map((cn) => (
              <Fragment key={cn.id}>
              <Tr>
                <Td className="font-mono text-xs text-gray-700">
                  {cn.reference_number}
                </Td>
                <Td className="font-medium text-gray-900">
                  {cn.student_name}
                  <span className="ml-1.5">
                    <PackageChip coverage={covMap.get(cn.student_id)} />
                  </span>
                </Td>
                <Td className="text-gray-500">{cn.parent_name}</Td>
                <Td className="font-semibold text-blue-600">
                  S${cn.amount.toFixed(2)}
                </Td>
                <Td className="text-gray-500" wrap>
                  {cn.reason ?? "—"}
                </Td>
                <Td className="font-mono text-xs text-gray-500">
                  {cn.linked_invoice_id
                    ? cn.linked_invoice_id.slice(0, 8) + "…"
                    : "—"}
                </Td>
                <Td className="text-gray-500">{cn.created_at}</Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    <StatusBadge status={creditNoteStatusLabel(cn.status)} />
                    {(() => {
                      const vv = creditNoteVoidView(
                        {
                          status: cn.status,
                          hasLiveApplications: cn.has_applications,
                          tenantId: cn.tenant_id,
                        },
                        viewer
                      );
                      if (!vv.canVoid) return null;
                      return (
                        <button
                          onClick={() => {
                            setVoidOpen(voidOpen === cn.id ? null : cn.id);
                            setVoidReason("");
                          }}
                          className="w-fit rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Void
                        </button>
                      );
                    })()}
                  </div>
                </Td>
                <Td>
                  {(() => {
                    const view = creditNoteEmailView(
                      {
                        emailSentAt: cn.email_sent_at,
                        status: cn.status,
                        appliedToInvoiceId: cn.applied_to_invoice_id,
                        hasApplications: cn.has_applications,
                        tenantId: cn.tenant_id,
                      },
                      viewer
                    );
                    if (!view.showNotEmailed) {
                      return <span className="text-xs text-gray-400">Emailed</span>;
                    }
                    return (
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex w-fit items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Not emailed
                        </span>
                        {view.canResend ? (
                          <button
                            onClick={() => resend(cn.id)}
                            disabled={resending.has(cn.id)}
                            className="w-fit rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {resending.has(cn.id) ? "Sending…" : "Resend"}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">
                            {resendBlockedLabel(view.blockedReason!)}
                          </span>
                        )}
                        {resendError[cn.id] && (
                          <span className="text-xs text-red-600">
                            {resendError[cn.id]}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </Td>
              </Tr>
              {voidOpen === cn.id && (
                <Tr>
                  <Td colSpan={9} className="bg-red-50/40">
                    {(() => {
                      const vv = creditNoteVoidView(
                        {
                          status: cn.status,
                          hasLiveApplications: cn.has_applications,
                          tenantId: cn.tenant_id,
                        },
                        viewer
                      );
                      return (
                        <div className="flex flex-col gap-2 py-1">
                          <p className="text-sm text-gray-700">
                            {voidConfirmMessage(
                              vv.isDrawn,
                              cn.amount,
                              cn.reference_number
                            )}
                          </p>
                          <textarea
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            placeholder="Reason for voiding (required) — recorded in the audit log"
                            rows={2}
                            className="w-full max-w-xl rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => voidNote(cn)}
                              disabled={voiding.has(cn.id)}
                              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              {voiding.has(cn.id) ? "Voiding…" : "Confirm void"}
                            </button>
                            <button
                              onClick={() => {
                                setVoidOpen(null);
                                setVoidReason("");
                              }}
                              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                          {voidError[cn.id] && (
                            <span className="text-xs text-red-600">
                              {voidError[cn.id]}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </Td>
                </Tr>
              )}
              </Fragment>
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
