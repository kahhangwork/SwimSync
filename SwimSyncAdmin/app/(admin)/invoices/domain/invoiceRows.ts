// Pure list-slice helpers for the Invoices page: the raw-row → InvoiceRow
// mapping, the month label, the client-side filter, the payment link, and the
// outstanding total. No React, no state, no client. domain/ may import @/lib
// pure helpers.

import { toWaNumber } from "@/lib/waMessage";
import type { InvoiceRow, SearchField } from "../types";

export function formatBillingMonth(ym: string): string {
  const [year, month] = ym.split("-");
  return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString(
    "en-SG",
    { month: "short", year: "numeric" }
  );
}

/** Map one PostgREST invoice row (with its `parents`/`invoice_items` embeds) to
 *  the flat InvoiceRow the UI renders. Student names are de-duplicated and
 *  preferred from the item's snapshot, falling back to the live student name. */
export function mapInvoiceRow(inv: any): InvoiceRow {
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
    balance_adjustment: Number(inv.balance_adjustment ?? 0),
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
}

// Parent search runs in the DB (past the cap). STUDENT search runs HERE, over
// the fetched set, because pushing it would corrupt the multi-child item list
// (see dao/invoices.repo.ts) — bounded by the cap banner. The status filter also
// refines here: "Claimed" is a derived state reading two columns.
export function filterInvoices(
  invoices: InvoiceRow[],
  searchField: SearchField,
  search: string,
  statusFilter: string
): InvoiceRow[] {
  const studentTerm = searchField === "student" ? search.trim() : "";
  return invoices.filter((inv) => {
    const matchStudent =
      studentTerm === "" ||
      inv.student_names.toLowerCase().includes(studentTerm.toLowerCase());
    const matchStatus =
      statusFilter === "All" ||
      (statusFilter === "Claimed"
        ? inv.status === "outstanding" && inv.paid_claimed_at !== null
        : inv.status.toLowerCase() === statusFilter.toLowerCase());
    return matchStudent && matchStatus;
  });
}

/** The tokenized public page for an invoice — what the WhatsApp message links to
 *  (the QR rides on the page; wa.me links cannot carry images). */
export function invoiceLink(inv: InvoiceRow): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://swimsync.sg";
  return `${base}/invoice/${inv.public_token}`;
}

export function totalOutstanding(invoices: InvoiceRow[]): number {
  return invoices
    .filter((i) => i.status === "outstanding")
    .reduce((sum, i) => sum + i.net_amount, 0);
}
