"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import { PackageChip } from "@/components/PackageChip";
import {
  creditNoteEmailView,
  resendBlockedLabel,
} from "@/lib/creditNoteEmailState";

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
  status: string; // "applied" | "available"
  // ── Email delivery (docs/plans/CREDIT_NOTE_EMAIL_PLAN.md) ──────────────────
  email_sent_at: string | null;
  tenant_id: string;
  applied_to_invoice_id: string | null;
  /** ⚠ RISK 2 — status stays 'available' while a note is PARTLY drawn down. */
  has_applications: boolean;
};

const STATUS_FILTERS = ["All", "Applied", "Available"];

export default function CreditNotesPage() {
  const [notes, setNotes] = useState<CreditNoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
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

  useEffect(() => {
    // Payment-method chips: fire-and-forget, a failed RPC only means no chips.
    supabase
      .rpc("student_package_coverage")
      .then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])));
    async function load() {
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

      // ⚠ RISK 2 — credit_applications comes back as an EMBED, not a second query.
      // It was `supabase.from("credit_applications").select("credit_note_id")` with no
      // filter, no limit and no error check: an error or a db-max-rows truncation made
      // `has_applications` false on every row, so Resend rendered for part-spent notes
      // — silently turning off the guard whose whole purpose is the case `status`
      // cannot see. As an embed it is scoped to the notes actually loaded, costs no
      // extra round trip, and shares this query's error handling.
      const { data, error } = await supabase
        .from("credit_notes")
        .select(
          "id, reference_number, amount, reason, status, applied_to_invoice_id, issued_at, student_name, email_sent_at, tenant_id, credit_applications(credit_note_id), students(id, full_name), parents(profiles(full_name))"
        )
        .order("issued_at", { ascending: false });

      if (error) {
        // Surfaced, not defaulted to "nothing is applied" — see ⚠ RISK 2 above.
        setLoadError(`Could not load credit notes: ${error.message}`);
        setLoading(false);
        return;
      }

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
          has_applications: (cn.credit_applications ?? []).length > 0,
        }))
      );
      setLoading(false);
    }

    load();
  }, []);

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

  const filtered = notes.filter((cn) => {
    const matchSearch =
      cn.student_name.toLowerCase().includes(search.toLowerCase()) ||
      cn.parent_name.toLowerCase().includes(search.toLowerCase()) ||
      cn.reference_number.toLowerCase().includes(search.toLowerCase());
    const label =
      cn.status === "applied" ? "Applied" : "Available";
    const matchStatus = statusFilter === "All" || label === statusFilter;
    return matchSearch && matchStatus;
  });

  const sort = useTableSort<CreditNoteRow>({
    key: "created_at",
    dir: "desc",
    accessors: {
      status: (cn) => (cn.status === "applied" ? "Applied" : "Available"),
    },
  });
  const visible = sort.apply(filtered);

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
        <input
          type="text"
          placeholder="Search by student, parent or ref..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 w-64"
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
              <Tr key={cn.id}>
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
                  <StatusBadge
                    status={cn.status === "applied" ? "Applied" : "Available"}
                  />
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
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
