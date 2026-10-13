import { Fragment } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, type TableSort } from "@/components/Table";
import { PackageChip } from "@/components/PackageChip";
import { Tag } from "@/components/ui/Tag";
import { Button } from "@/components/ui/Button";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { formatSgStamp } from "@/lib/lessonDates";
import type { StudentCoverage } from "@/lib/packageCoverage";
import { creditNoteStatusLabel } from "../domain/creditNoteRows";
import {
  creditNoteEmailView,
  emailPillLabel,
  resendBlockedLabel,
} from "../domain/creditNoteEmailState";
import { creditNoteVoidView, voidConfirmMessage } from "../domain/creditNoteVoidState";
import type { CreditNoteRow, EmailDeliveryState, Viewer } from "../types";

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
  onResend: (id: string, prior: EmailDeliveryState) => void;
}) {
  return (
    <Table>
      <Thead>
        <Th sort={sort} sortKey="reference_number">Reference</Th>
        <Th sort={sort} sortKey="student_name">Student</Th>
        <Th sort={sort} sortKey="parent_name">Parent</Th>
        <Th sort={sort} sortKey="amount" firstDir="desc" className="text-right">Amount</Th>
        <Th sort={sort} sortKey="reason" wrap>Reason</Th>
        <Th sort={sort} sortKey="linked_invoice_id">Linked Invoice</Th>
        <Th sort={sort} sortKey="created_at" firstDir="desc">Date</Th>
        <Th sort={sort} sortKey="status">Status</Th>
        <Th>Parent notified</Th>
        {/* The row "…" menu (Void) — DESIGN.md: one inline action per row. */}
        <Th>{""}</Th>
      </Thead>
      <Tbody>
        {loading ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={10}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={10}>
              No credit notes found.
            </Td>
          </Tr>
        ) : (
          visible.map((cn) => (
            <Fragment key={cn.id}>
            <Tr>
              <Td className="font-mono text-label text-ink-secondary">
                {cn.reference_number}
              </Td>
              <Td className="font-medium text-ink">
                {cn.student_name}
                <span className="ml-1.5">
                  <PackageChip coverage={covMap.get(cn.student_id)} />
                </span>
              </Td>
              <Td className="text-ink-muted">{cn.parent_name}</Td>
              {/* A credit is a reduction: Ink, a true minus, right-aligned
                  (DESIGN.md's Aligned Money Rule; UI restyle 5.2). */}
              <Td className="text-right tabular-nums font-semibold text-ink">
                −S${cn.amount.toFixed(2)}
              </Td>
              <Td className="text-ink-muted" wrap>
                {cn.reason ?? "—"}
              </Td>
              <Td className="font-mono text-label text-ink-muted">
                {cn.linked_invoice_id
                  ? cn.linked_invoice_id.slice(0, 8) + "…"
                  : "—"}
              </Td>
              <Td className="text-ink-secondary">
                {/* DISPLAY only — `created_at` stays the YYYY-MM-DD the sort
                    and the CSV read (plan RISK 13). */}
                {cn.created_at === "—"
                  ? "—"
                  : formatSgStamp(cn.created_at, { day: "numeric", month: "short", year: "numeric" })}
              </Td>
              <Td>
                <StatusBadge status={creditNoteStatusLabel(cn.status)} />
              </Td>
              <Td>
                {(() => {
                  const view = creditNoteEmailView(
                    {
                      emailState: cn.email_state,
                      status: cn.status,
                      appliedToInvoiceId: cn.applied_to_invoice_id,
                      hasApplications: cn.has_applications,
                      tenantId: cn.tenant_id,
                    },
                    viewer
                  );
                  if (!view.pill) {
                    return (
                      <span className="text-label text-ink-muted">
                        {resendBlockedLabel(view.blockedReason!)}
                      </span>
                    );
                  }
                  return (
                    <div className="flex flex-col gap-1">
                      <Tag tone={view.pill === "sending" ? "info" : "warning"} className="w-fit">
                        {emailPillLabel(view.pill)}
                      </Tag>
                      {view.pill === "sending" ? null : view.canResend ? (
                        <Button
                          size="row"
                          variant="secondary"
                          onClick={() => onResend(cn.id, cn.email_state)}
                          disabled={resending.has(cn.id)}
                          className="w-fit"
                        >
                          {resending.has(cn.id) ? "Sending…" : "Resend"}
                        </Button>
                      ) : (
                        <span className="text-label text-ink-muted">
                          {resendBlockedLabel(view.blockedReason!)}
                        </span>
                      )}
                      {resendError[cn.id] && (
                        <span className="text-label text-status-danger-text">
                          {resendError[cn.id]}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </Td>
              <Td>
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
                    <RowMenu>
                      {vv.canVoid && (
                        <RowMenuItem
                          destructive
                          onClick={() => {
                            setVoidOpen(voidOpen === cn.id ? null : cn.id);
                            setVoidReason("");
                          }}
                        >
                          Void
                        </RowMenuItem>
                      )}
                    </RowMenu>
                  );
                })()}
              </Td>
            </Tr>
            {voidOpen === cn.id && (
              <Tr>
                <Td colSpan={10} className="bg-status-danger-bg">
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
                        <p className="text-body text-ink-secondary">
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
                          className="w-full max-w-xl rounded-card border border-border-strong px-3 py-2 text-body placeholder:text-ink-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="row"
                            variant="destructive"
                            onClick={() => onVoid(cn)}
                            disabled={voiding.has(cn.id)}
                          >
                            {voiding.has(cn.id) ? "Voiding…" : "Confirm void"}
                          </Button>
                          <Button
                            size="row"
                            variant="secondary"
                            onClick={() => {
                              setVoidOpen(null);
                              setVoidReason("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                        {voidError[cn.id] && (
                          <span className="text-label text-status-danger-text">
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
