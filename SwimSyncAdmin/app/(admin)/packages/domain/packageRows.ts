// Pure row → entity mapping, the derived purchase buckets, and the held-search
// filter for the Packages page. No React, no client — extracted at Stage 4 of
// docs/refactor/PACKAGES_REFACTOR_PLAN.md and covered by packageRows.test.ts
// (characterisation tests: they pin the behaviour the page already had).

import { matchesAnyField } from "@/lib/tableSearch";
import type { Category, Product, Purchase, ParentOption } from "../types";

export function mapCategories(rows: any[] | null): Category[] {
  return (rows ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    class_count: (c.classes ?? []).length,
    default_product_id: c.default_product_id ?? null,
    default_capacity: c.default_capacity ?? null,
  }));
}

export function mapProducts(rows: any[] | null): Product[] {
  return (rows ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    category_id: p.category_id,
    category_name: p.class_categories?.name ?? null,
    lesson_count: p.lesson_count,
    rate_per_lesson: Number(p.rate_per_lesson),
    validity_weeks: p.validity_weeks,
    is_active: p.is_active,
    holder_count: (p.parent_packages ?? []).filter(
      (x: any) => x.status !== "cancelled"
    ).length,
  }));
}

// parent_id → "Ali, Bo" (active children only).
export function childrenByParent(rows: any[] | null): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of rows ?? []) {
    const s = Array.isArray(r.students) ? r.students[0] : r.students;
    if (!s?.is_active || !s?.full_name) continue;
    const arr = map.get(r.parent_id) ?? [];
    arr.push(s.full_name);
    map.set(r.parent_id, arr);
  }
  return map;
}

// Live balances by package id — the RPC's number, never recomputed here.
export function liveBalancesById(rows: any[] | null): Map<string, any> {
  return new Map<string, any>(
    (rows ?? []).map((r: any) => [r.parent_package_id, r])
  );
}

export function mapPurchases(
  rows: any[] | null,
  liveById: Map<string, any>,
  childrenMap: Map<string, string[]>
): Purchase[] {
  return (rows ?? []).map((p: any) => ({
    id: p.id,
    parent_id: p.parent_id,
    parent_name:
      p.parents?.profiles?.full_name ??
      p.parents?.profiles?.email ??
      "Unknown",
    name: p.name,
    category_name: p.class_categories?.name ?? null,
    lesson_count: p.lesson_count,
    rate_per_lesson: Number(p.rate_per_lesson),
    total_value: Number(p.total_value),
    amount_payable: Number(p.amount_payable),
    discount_amount: Number(p.discount_amount),
    value_remaining: Number(p.value_remaining),
    live_value_remaining: liveById.has(p.id)
      ? Number(liveById.get(p.id).live_value_remaining)
      : null,
    live_lessons_remaining: liveById.has(p.id)
      ? Number(liveById.get(p.id).live_lessons_remaining)
      : null,
    status: p.status,
    product_id: p.product_id,
    requested_at: p.requested_at,
    start_date: p.start_date,
    expires_on: p.expires_on,
    holiday_extension_days: p.holiday_extension_days ?? 0,
    cancel_extension_days: p.cancel_extension_days ?? 0,
    manual_extension_days: p.manual_extension_days ?? 0,
    reference_number: p.reference_number ?? null,
    offered_by: p.offered_by ?? null,
    paid_claimed_at: p.paid_claimed_at ?? null,
    superseded_by: p.superseded_by ?? null,
    public_token: p.public_token ?? null,
    children: (childrenMap.get(p.parent_id) ?? []).join(", ") || null,
  }));
}

export function mapParents(rows: any[] | null): ParentOption[] {
  return (rows ?? [])
    .map((r: any) => ({
      id: r.parents?.id,
      name:
        r.parents?.profiles?.full_name ?? r.parents?.profiles?.email ?? "",
    }))
    .filter((p: ParentOption) => p.id);
}

// ── Derived buckets over the loaded purchases ────────────────────────────────

export const pendingPurchases = (purchases: Purchase[]): Purchase[] =>
  purchases.filter((p) => p.status === "pending");

// ⚠ RISK 1 — a SUPERSEDED offer (cancelled by a newer request) so a stray
// bank transfer against the old PKG- reference can still be traced.
export const supersededPurchases = (purchases: Purchase[]): Purchase[] =>
  purchases.filter((p) => p.status === "cancelled" && p.superseded_by);

// "held" is unchanged EXCEPT that a superseded offer is pulled out (it now
// lives in the Awaiting panel's Superseded list, not "Who holds one").
export const heldPurchases = (purchases: Purchase[]): Purchase[] =>
  purchases.filter(
    (p) => p.status !== "pending" && !(p.status === "cancelled" && p.superseded_by)
  );

// The search narrows the DISPLAY only — `held` stays the base so "nobody holds
// one" and "nothing matched your search" can be told apart. Client-side over a
// bounded list; a blank term matches everyone (`matchesAnyField`).
export const heldMatching = (held: Purchase[], search: string): Purchase[] =>
  held.filter((p) =>
    matchesAnyField(p, search, [
      (r) => r.parent_name,
      (r) => r.name,
      (r) => r.reference_number,
    ])
  );

export const activeProducts = (products: Product[]): Product[] =>
  products.filter((p) => p.is_active);
