import { type CsvColumn } from "@/lib/csv";
import type { InvoiceRow } from "./types";

// The Singapore calendar date of a timestamptz, in the dd/mm/yyyy shape this
// page has always shown. `formatSgStamp` pins Asia/Singapore; the bare
// `toLocaleDateString("en-SG")` it replaced rendered the VIEWER's date, a day
// early west of Singapore for anything stamped before 08:00 SGT.
export const DMY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

/** PostgREST caps every fetch at max_rows (1000); this many back means the list
 *  is (probably) truncated and search is how to reach past it (⚠ RISK 3). */
export const ROW_LIMIT = 1000;

// CSV export — what's on screen (post-filter/sort `visible`), raw values so an
// accountant can sum the money columns. Month stays the raw YYYY-MM (sortable in
// Excel); status is the badge label, not the lowercased enum.
export const INVOICE_CSV_COLUMNS: CsvColumn<InvoiceRow>[] = [
  { header: "Parent", value: (r) => r.parent_name },
  { header: "Students", value: (r) => r.student_names },
  { header: "Month", value: (r) => r.billing_month },
  { header: "Gross", value: (r) => r.gross_amount },
  { header: "Package", value: (r) => r.package_applied },
  { header: "Credit", value: (r) => r.credit_applied },
  { header: "Adjustment", value: (r) => r.balance_adjustment },
  { header: "Net", value: (r) => r.net_amount },
  { header: "Status", value: (r) => (r.status === "paid" ? "Paid" : "Outstanding") },
  { header: "Parent says paid", value: (r) => (r.paid_claimed_at ? "yes" : "") },
  { header: "Reference", value: (r) => r.reference_number },
];

// "Claimed" = outstanding AND the parent has said "I've paid" — the rows an
// admin should check against the bank first.
export const STATUS_FILTERS = ["All", "Outstanding", "Claimed", "Paid"];
