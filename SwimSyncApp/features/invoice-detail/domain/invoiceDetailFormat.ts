// The Invoice Detail screen's pure half (docs/refactor/BATCH_FGH_PLAN.md, App L-G):
// the formatters and the invoice mapping, moved VERBATIM out of
// app/(parent)/billing/invoice/[id].tsx and pinned by invoiceDetailFormat.test.ts.
//
// ⚠ formatBillingMonth builds a LOCAL Date from its parts, month+year only, no
// timeZone — pinned by path in BOTH sgDisplay.drift.test.ts twins ("parseInt(month)
// - 1"), repointed here from the route (plan ⚠ R6). Correct in every zone.
import { formatSgStamp } from "@/lib/lessonDates";
import type { InvoiceItem, InvoiceDetail } from "../types";

export function formatBillingMonth(ym: string): string {
  const [year, month] = ym.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("en-SG", { month: "long", year: "numeric" });
}

export function formatDate(dateStr: string): string {
  return formatSgStamp(dateStr, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");
}

/** The invoice as the screen holds it: amounts as numbers, lines sorted by date,
 *  each line tagged with the package that funded it (`funded`, from
 *  fundingByItem), and the coach found via the first line's lesson session. */
export function invoiceDetailOf(
  inv: any,
  cns: any[] | null,
  funded: Map<string, string>,
  coachId: string | null
): InvoiceDetail {
  return {
    id: inv.id,
    reference_number: (inv as any).reference_number ?? null,
    billing_month: inv.billing_month,
    business_name:
      (Array.isArray((inv as any).tenants)
        ? (inv as any).tenants[0]
        : (inv as any).tenants)?.display_name ?? "Your coach",
    gross_amount: Number(inv.gross_amount),
    package_applied: Number((inv as any).package_applied ?? 0),
    credit_applied: Number(inv.credit_applied),
    balance_adjustment: Number((inv as any).balance_adjustment ?? 0),
    net_amount: Number(inv.net_amount),
    status: inv.status,
    generated_at: inv.generated_at,
    paid_at: inv.paid_at,
    paid_claimed_at: (inv as any).paid_claimed_at ?? null,
    items: (inv.invoice_items ?? [])
      .map((item: any) => ({
        id: item.id,
        // The name AS INVOICED, falling back to the live join only for
        // rows written before the snapshot existed. Reading the live name
        // first would let a later rename rewrite an invoice already sent.
        student_name: item.student_name ?? item.students?.full_name ?? "—",
        class_title: item.class_title,
        session_date: item.session_date,
        attendance_status: item.attendance_status,
        amount: Number(item.amount),
        funded_by: funded.get(item.id) ?? null,
      }))
      .sort((a: InvoiceItem, b: InvoiceItem) =>
        a.session_date.localeCompare(b.session_date)
      ),
    credit_notes: (cns ?? []).map((cn: any) => ({
      ...cn,
      amount: Number(cn.amount),
    })),
    coach_id: coachId,
  };
}
