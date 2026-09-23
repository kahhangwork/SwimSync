// The parent Billing tab's pure half (docs/refactor/BATCH_FGH_PLAN.md, App L-G): the
// formatters and the three row mappings, moved VERBATIM out of
// app/(parent)/billing/index.tsx and pinned by billingFormat.test.ts. No clock, no
// client.
//
// ⚠ formatBillingMonth builds a LOCAL Date from its parts and formats month+year
// with no timeZone — pinned by path in BOTH sgDisplay.drift.test.ts twins
// ("parseInt(month) - 1"), repointed here from the route (plan ⚠ R6). Do NOT
// "fix" it with a timeZone option: it is correct in every zone.
import { formatSgStamp } from "@/lib/lessonDates";
import type { Invoice, ParentPackage, PackageProduct } from "../types";

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

export function invoicesOf(rows: any[] | null): Invoice[] {
  return (rows ?? []).map((inv: any) => {
    const t = Array.isArray(inv.tenants) ? inv.tenants[0] : inv.tenants;
    return {
      ...inv,
      gross_amount: Number(inv.gross_amount),
      package_applied: Number(inv.package_applied ?? 0),
      credit_applied: Number(inv.credit_applied),
      net_amount: Number(inv.net_amount),
      business_name: t?.display_name ?? "Your coach",
    };
  });
}

/** LIVE numbers come from package_live_balances(), keyed by package id — never
 *  recomputed here (the RPC is the single derivation). */
export function packagesOf(rows: any[] | null, liveRows: any[] | null): ParentPackage[] {
  const liveById = new Map<string, any>(
    ((liveRows as any[]) ?? []).map((r) => [r.parent_package_id, r])
  );
  return (rows ?? []).map((p: any) => {
    const t = Array.isArray(p.tenants) ? p.tenants[0] : p.tenants;
    const c = Array.isArray(p.class_categories)
      ? p.class_categories[0]
      : p.class_categories;
    const live = liveById.get(p.id);
    return {
      id: p.id,
      name: p.name,
      business_name: t?.display_name ?? "Your coach",
      category_name: c?.name ?? null,
      lesson_count: p.lesson_count,
      rate_per_lesson: Number(p.rate_per_lesson),
      total_value: Number(p.total_value),
      amount_payable: Number(p.amount_payable),
      discount_amount: Number(p.discount_amount),
      status: p.status,
      offered_by: p.offered_by ?? null,
      expires_on: p.expires_on,
      live_lessons_remaining: live ? Number(live.live_lessons_remaining) : null,
      live_value_remaining: live ? Number(live.live_value_remaining) : null,
      holiday_extension_days: p.holiday_extension_days ?? 0,
      cancel_extension_days: p.cancel_extension_days ?? 0,
    };
  });
}

export function productsOf(rows: any[] | null): PackageProduct[] {
  return (rows ?? []).map((p: any) => {
    const t = Array.isArray(p.tenants) ? p.tenants[0] : p.tenants;
    const c = Array.isArray(p.class_categories)
      ? p.class_categories[0]
      : p.class_categories;
    return {
      id: p.id,
      name: p.name,
      business_name: t?.display_name ?? "Your coach",
      category_name: c?.name ?? null,
      lesson_count: p.lesson_count,
      rate_per_lesson: Number(p.rate_per_lesson),
      validity_weeks: p.validity_weeks,
    };
  });
}
