import type { InvoiceTag } from "@/lib/invoiceTag";

export type Metrics = {
  activeStudents: number;
  inactiveStudents: number;
  unassignedCount: number;
  outstandingInvoices: number;
  /** Overdue and not claimed (D4) — a part of outstandingInvoices. */
  overdueInvoices: number;
  totalCreditNotes: number;
  totalCoaches: number;
  totalClasses: number;
};

export type TenantInfo = {
  id: string;
  display_name: string;
  join_code: string;
};

export type UnassignedRow = {
  id: string;
  full_name: string;
  parent_name: string;
};

export type InvoiceRow = {
  id: string;
  billing_month: string;
  net_amount: number;
  parent_name: string;
  tag: InvoiceTag;
};
