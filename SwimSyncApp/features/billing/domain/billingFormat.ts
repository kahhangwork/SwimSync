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
import type { ChildOption, Invoice, ParentPackage, PackageProduct } from "../types";
import type { ChildLinkRow, InvoiceListRow, PackageListRow, ProductListRow } from "../dao/billing.repo";
import type { LiveBalanceRow } from "../dao/billing.rpc";

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

export function invoicesOf(rows: InvoiceListRow[] | null): Invoice[] {
  return (rows ?? []).map((inv) => {
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
export function packagesOf(
  rows: PackageListRow[] | null,
  liveRows: LiveBalanceRow[] | null,
  children: ChildOption[] = []
): ParentPackage[] {
  const liveById = new Map<string, LiveBalanceRow>(
    (liveRows ?? []).map((r) => [r.parent_package_id, r])
  );
  return (rows ?? []).map((p) => {
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
      // census: ui-cast (Wave 8) — the column is `text`, but CHECK (status = ANY
      // ('pending','active','cancelled')) holds it to exactly ParentPackage's union.
      status: p.status as ParentPackage["status"],
      offered_by: p.offered_by ?? null,
      expires_on: p.expires_on,
      live_lessons_remaining: live ? Number(live.live_lessons_remaining) : null,
      live_value_remaining: live ? Number(live.live_value_remaining) : null,
      holiday_extension_days: p.holiday_extension_days ?? 0,
      cancel_extension_days: p.cancel_extension_days ?? 0,
      student_id: p.student_id ?? null,
      child_name: p.student_id
        ? (children.find((k) => k.id === p.student_id)?.name ?? "your child")
        : null,
    };
  });
}

/** The parent's children (inactive ones included — a held package may name one);
 *  rows RLS hides are dropped. */
export function childrenOf(rows: ChildLinkRow[] | null): ChildOption[] {
  const out: ChildOption[] = [];
  for (const r of rows ?? []) {
    const s = Array.isArray(r.students) ? r.students[0] : r.students;
    if (!s?.id || !s.full_name) continue;
    out.push({ id: s.id, name: s.full_name, tenant_id: s.tenant_id, active: s.is_active });
  }
  return out;
}

/** ⚠ RISK 7 — the children a one-child product can be for: the parent's ACTIVE
 *  children at the product's business. */
export function childrenForProduct(
  children: ChildOption[],
  product: Pick<PackageProduct, "tenant_id">
): ChildOption[] {
  return children.filter((k) => k.active && k.tenant_id === product.tenant_id);
}

/** ⚠ RISK 7 — what a request sends as student_id: a shared product always null;
 *  a one-child product the single eligible child (D7 — shown, not asked), else the
 *  parent's choice, else null (the caller refuses before sending). */
export function requestStudentFor(
  product: Pick<PackageProduct, "single_child">,
  eligible: ChildOption[],
  choice: string | undefined
): string | null {
  if (!product.single_child) return null;
  if (eligible.length === 1) return eligible[0].id;
  return eligible.some((k) => k.id === choice) ? (choice as string) : null;
}

export function productsOf(rows: ProductListRow[] | null): PackageProduct[] {
  return (rows ?? []).map((p) => {
    const t = Array.isArray(p.tenants) ? p.tenants[0] : p.tenants;
    const c = Array.isArray(p.class_categories)
      ? p.class_categories[0]
      : p.class_categories;
    return {
      id: p.id,
      tenant_id: p.tenant_id,
      single_child: !!p.single_child,
      name: p.name,
      business_name: t?.display_name ?? "Your coach",
      category_name: c?.name ?? null,
      lesson_count: p.lesson_count,
      rate_per_lesson: Number(p.rate_per_lesson),
      validity_weeks: p.validity_weeks,
    };
  });
}
