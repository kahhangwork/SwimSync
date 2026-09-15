// The list-core slice (slice 1) of the Packages page: all the loaded data, the
// held-search box, the WhatsApp queue, the shared busy/error flags, load(), and
// the Retire/Reoffer table action. Stage 4 of PACKAGES_REFACTOR_PLAN.md.
//
// ⚠ RISK 2 — busy and error are ONE flag and ONE banner for the WHOLE page.
// They live HERE and are passed to every other slice's hook as
// { busy, setBusy, setError, reload }. No slice declares its own busy/error.

import { useEffect, useState } from "react";
import type { WaQueueRow } from "@/components/WhatsAppQueue";
import { ROW_LIMIT } from "../constants";
import type { Category, Product, Purchase, ParentOption } from "../types";
import * as repo from "../dao/packages.repo";
import * as rpc from "../dao/packages.rpc";
import {
  mapCategories,
  mapProducts,
  childrenByParent,
  liveBalancesById,
  mapPurchases,
  mapParents,
  pendingPurchases,
  supersededPurchases,
  heldPurchases,
  heldMatching,
  activeProducts,
} from "./packageRows";

export type TenantReferral = {
  enabled: boolean;
  type: "percent" | "amount" | null;
  value: number | null;
};

export function usePackageList() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [parents, setParents] = useState<ParentOption[]>([]);
  const [businessName, setBusinessName] = useState("your swim school");
  const [tenantDefaultProduct, setTenantDefaultProduct] = useState<string | null>(null);
  const [tenantReferral, setTenantReferral] = useState<TenantReferral>({
    enabled: false,
    type: null,
    value: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "Who holds one" search + the truncation flag for its fetch.
  const [heldSearch, setHeldSearch] = useState("");
  const [capped, setCapped] = useState(false);
  // Rows to work through in the WhatsApp queue after offers are created. Each
  // carries its pre-built wa.me link (opened by onOpenChat) plus the fields the
  // shared WhatsAppQueue renders.
  const [queue, setQueue] = useState<(WaQueueRow & { link: string | null })[]>([]);
  // Reveal superseded offers in the Awaiting panel (RISK 1 tracing aid).
  const [showSuperseded, setShowSuperseded] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);

    // Holiday extensions are event-driven now (reconcile trigger,
    // 20260818000700): expires_on is already current when this page reads it,
    // so there is no pre-read recompute call any more.
    const tenant = await rpc.myTenantId();
    if (tenant) {
      const { data: t } = await repo.loadTenantSettings(tenant);
      if (t?.display_name) setBusinessName(t.display_name);
      setTenantDefaultProduct(t?.default_package_product_id ?? null);
      setTenantReferral({
        enabled: !!t?.referral_enabled,
        type: (t?.referral_discount_type as "percent" | "amount" | null) ?? null,
        value: t?.referral_discount_value != null ? Number(t.referral_discount_value) : null,
      });
    }

    // RLS scopes every query here to the caller's own business.
    const [catRes, prodRes, purRes, liveRes, ptRes, childRes] = await Promise.all([
      repo.loadCategories(),
      repo.loadProducts(),
      repo.loadPurchases(),
      rpc.liveBalances(),
      repo.loadParentOptions(),
      repo.loadChildren(),
    ]);

    // A failed catalogue fetch and "this business sells nothing" render
    // IDENTICALLY without this — an empty products table and no signal. That is
    // how the PGRST201 embed break above went unnoticed from 2026-08-15; say so
    // instead of degrading quietly. Same guard as the parent app's Billing tab.
    if (prodRes.error) {
      console.error("package_products fetch failed", prodRes.error);
      setError("Couldn't load the package catalogue — please reload the page.");
    }

    const childMap = childrenByParent(childRes.data as any[]);
    setCategories(mapCategories(catRes.data as any[]));
    setProducts(mapProducts(prodRes.data as any[]));
    setCapped((purRes.data ?? []).length >= ROW_LIMIT);
    const liveById = liveBalancesById(liveRes.data as any[]);
    setPurchases(mapPurchases(purRes.data as any[], liveById, childMap));
    setParents(mapParents(ptRes.data as any[]));

    setLoading(false);
  }

  async function setProductActive(p: Product, active: boolean) {
    setBusy(true);
    const { error: err } = await repo.updateProductActive(p.id, active);
    setBusy(false);
    if (err) setError("Could not update that package.");
    load();
  }

  const pending = pendingPurchases(purchases);
  const superseded = supersededPurchases(purchases);
  const held = heldPurchases(purchases);
  const heldMatches = heldMatching(held, heldSearch);
  const active = activeProducts(products);

  return {
    // data
    categories,
    products,
    purchases,
    parents,
    businessName,
    tenantDefaultProduct,
    tenantReferral,
    loading,
    error,
    busy,
    heldSearch,
    capped,
    queue,
    showSuperseded,
    // derived (packageRows)
    pending,
    superseded,
    held,
    heldMatches,
    activeProducts: active,
    // setters shared across slices (RISK 2)
    setError,
    setBusy,
    setQueue,
    setHeldSearch,
    setShowSuperseded,
    // actions
    load,
    setProductActive,
  };
}
