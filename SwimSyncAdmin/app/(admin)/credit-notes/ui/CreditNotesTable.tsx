import { Fragment } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, type TableSort } from "@/components/Table";
import { PackageChip } from "@/components/PackageChip";
import type { StudentCoverage } from "@/lib/packageCoverage";
import { creditNoteStatusLabel } from "../domain/creditNoteRows";
import { creditNoteEmailView, resendBlockedLabel } from "../domain/creditNoteEmailState";
import { creditNoteVoidView, voidConfirmMessage } from "../domain/creditNoteVoidState";
import type { CreditNoteRow, Viewer } from "../types";

export function CreditNotesTable({
  sort,
  loading,
  visible,
  covMap,
  viewer,
  voidOpen,
  setVoidOpen,
  voidReason,
  setVoidReason,
  voiding,
  voidError,
  onVoid,
  resending,
  resendError,
  onResend,
}: {
  sort: TableSort<CreditNoteRow>;
  loading: boolean;
  visible: CreditNoteRow[];
  covMap: Map<string, StudentCoverage>;
  viewer: Viewer;
  voidOpen: string | null;
  setVoidOpen: (id: string | null) => void;
  voidReason: string;
  setVoidReason: (r: string) => void;
  voiding: Set<string>;
  voidError: Record<string, string>;
  onVoid: (cn: CreditNoteRow) => void;
  resending: Set<string>;
  resendError: Record<string, string>;
  onResend: (id: string) => void;
}) {
  return (
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
                          onClick={() => onResend(cn.id)}
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
                            onClick={() => onVoid(cn)}
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
  );
}
