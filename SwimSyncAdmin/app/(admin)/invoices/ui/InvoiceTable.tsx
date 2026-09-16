"use client";

import { CheckCircle, Link as LinkIcon, MessageCircle } from "lucide-react";
import { formatSgStamp } from "@/lib/lessonDates";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  type TableSort,
} from "@/components/Table";
import { Button } from "@/components/Button";
import { DMY, ROW_LIMIT } from "../constants";
import type { InvoiceRow, SearchField } from "../types";
import { formatBillingMonth } from "../domain/invoiceRows";

export function InvoiceTable({
  loading,
  loadError,
  capped,
  searchField,
  search,
  visible,
  sort,
  markingPaid,
  copiedLink,
  onMarkPaid,
  onWhatsApp,
  onCopyLink,
}: {
  loading: boolean;
  loadError: string | null;
  capped: boolean;
  searchField: SearchField;
  search: string;
  visible: InvoiceRow[];
  sort: TableSort<InvoiceRow>;
  markingPaid: string | null;
  copiedLink: string | null;
  onMarkPaid: (id: string) => void;
  onWhatsApp: (inv: InvoiceRow) => void;
  onCopyLink: (inv: InvoiceRow) => void;
}) {
  return (
    <>
      {loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the invoices: {loadError}. The list below is incomplete
          — do not read it as the full set.
        </div>
      )}

      {!loading && !loadError && capped && (
        <p className="mb-3 text-sm text-amber-700">
          Showing the first {ROW_LIMIT}{" "}
          {searchField === "parent" && search.trim() ? "matches" : "invoices"}.{" "}
          {searchField === "parent" && search.trim()
            ? "Refine your search to narrow them."
            : "Search by parent to reach invoices past this limit."}
        </p>
      )}

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
                      {formatSgStamp(inv.paid_claimed_at, DMY)}
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
                        onClick={() => onMarkPaid(inv.id)}
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
                          onClick={() => onWhatsApp(inv)}
                          title={
                            inv.reminded_at
                              ? `Chat opened ${formatSgStamp(inv.reminded_at, DMY)}`
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
                        onClick={() => onCopyLink(inv)}
                      >
                        <LinkIcon className="h-3.5 w-3.5" />
                        {copiedLink === inv.id ? "Copied" : "Link"}
                      </Button>
                    </div>
                  )}
                  {inv.status === "outstanding" && inv.reminded_at && (
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      chat opened{" "}
                      {formatSgStamp(inv.reminded_at, DMY)}
                    </div>
                  )}
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </>
  );
}
