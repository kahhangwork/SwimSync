// The parent Billing tab's spine: the load, the list-card claim, and the package
// request / cancel (docs/refactor/BATCH_FGH_PLAN.md, App L-G). Moved VERBATIM from
// app/(parent)/billing/index.tsx — state, handlers and callbacks in their original
// order; builders are dao calls, the three row mappings are domain/billingFormat.
//
// ⚠ plan R8, named prohibitions that govern this file:
//   • `setClaimingId(null)` stays BEFORE the error check; no try/finally.
//   • the package email stays fire-and-forget: NOT awaited, `.catch(() => {})`.
//   • every useCallback keeps its deps byte-identical ([session], [parentId,
//     loadData], [loadData]) — the route's useFocusEffect is keyed on loadData.
import { useState, useCallback } from "react";
import { router } from "expo-router";
import { useAppStore } from "@/store/useAppStore";
import { confirmAction } from "@/lib/confirm";
import {
  fetchParentId,
  fetchInvoices,
  fetchCreditNotes,
  fetchPackages,
  fetchProducts,
  insertPackageRequest,
  cancelPackageRequest,
} from "../dao/billing.repo";
import { claimInvoicePaid, fetchLiveBalances } from "../dao/billing.rpc";
import { invokePackageEmail } from "../dao/billing.api";
import type { Tab, Invoice, ParentPackage, PackageProduct, CreditNote } from "../types";
import { invoicesOf, packagesOf, productsOf } from "./billingFormat";

export function useBilling() {
  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);
  const [activeTab, setActiveTab] = useState<Tab>("Invoices");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [packages, setPackages] = useState<ParentPackage[]>([]);
  const [products, setProducts] = useState<PackageProduct[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** PER-INVOICE, not a single boolean like the detail screen's `claiming` —
   *  a list can have several outstanding invoices and one in flight must not
   *  disable the rest. The re-entrancy guard below is scoped to the SAME row
   *  for that reason: a global `if (claimingId) return` would make a tap on a
   *  second invoice do nothing at all — no dialog, no toast — which is
   *  indistinguishable from a dead button. */
  const [claimingId, setClaimingId] = useState<string | null>(null);

  /** Mirrors `claimPaid` on the invoice detail screen, verbatim copy included:
   *  three surfaces (list, detail, the public tokenized page) must word this
   *  identically or the parent reads three different promises. */
  function claimPaid(inv: Invoice) {
    if (claimingId === inv.id) return; // this row only — see the state comment
    confirmAction(
      "Mark as paid?",
      "This tells your coach you've made the PayNow transfer. They'll confirm it against their bank account.",
      async () => {
        setClaimingId(inv.id);
        const { data, error } = await claimInvoicePaid(inv.id);
        setClaimingId(null);
        if (error) {
          showToast("Couldn't record that — please try again.", "error");
          return;
        }
        // Patch only the row that was claimed. The RPC returns the stored
        // timestamp, and it is IDEMPOTENT — a second press returns the first
        // one unchanged rather than moving it.
        setInvoices((prev) =>
          prev.map((row) =>
            row.id === inv.id
              ? { ...row, paid_claimed_at: data as string }
              : row
          )
        );
        showToast("Noted — your coach will confirm the payment.", "success");
      },
      "I've paid"
    );
  }

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    const { data: parent } = await fetchParentId(session);

    if (!parent) {
      setLoading(false);
      return;
    }
    setParentId(parent.id);

    // Holiday extensions are event-driven now (reconcile trigger,
    // 20260818000700): expires_on is already current when this page reads it,
    // so there is no pre-read recompute call any more.
    const [invoicesRes, creditNotesRes, packagesRes, liveRes, productsRes] =
      await Promise.all([
        fetchInvoices(parent.id),

        fetchCreditNotes(parent.id),

        // RLS scopes these to this parent's own packages.
        fetchPackages(),

        fetchLiveBalances(),

        // Products of every business this parent has joined (RLS) — the ⚠ on
        // the two named FKs lives on dao/billing.repo fetchProducts (§7.176).
        fetchProducts(),
      ]);

    setInvoices(invoicesOf(invoicesRes.data));
    setCreditNotes(creditNotesRes.data ?? []);

    setPackages(packagesOf(packagesRes.data, liveRes.data as any[]));

    // A FAILED products fetch and "this business sells nothing" render
    // IDENTICALLY — `?? []` collapses both to an empty Buy-a-package list with
    // no signal at all. That is how the PGRST201 break above survived three
    // nightlies. Say something instead of degrading quietly.
    if (productsRes.error) {
      console.error("package_products fetch failed", productsRes.error);
      showToast("Couldn't load the packages for sale — please try again.", "error");
    }
    setProducts(productsOf(productsRes.data));

    setLoading(false);
  }, [session]);

  /** Request a package: a PENDING row (the DB snapshots the product's terms
   *  and forces pending for parents), then straight to the PayNow screen. */
  const requestPackage = useCallback(
    async (product: PackageProduct) => {
      if (!parentId) return;
      setRequestingId(product.id);
      setPackageError(null);
      const { data, error } = await insertPackageRequest(parentId, product.id);
      setRequestingId(null);
      if (error || !data) {
        setPackageError("Could not request that package. Please try again.");
        return;
      }
      // Best-effort email with the amount + PayNow instructions. Fire and
      // forget: the parent is already being shown the PayNow screen, so a
      // failed email must never fail the request.
      invokePackageEmail(data.id)
        .catch(() => {});
      await loadData();
      router.push(`/(parent)/billing/paynow?packageId=${data.id}`);
    },
    [parentId, loadData]
  );

  const cancelRequest = useCallback(
    async (pkg: ParentPackage) => {
      setPackageError(null);
      const { error } = await cancelPackageRequest(pkg.id);
      if (error) {
        setPackageError("Could not cancel that request.");
        return;
      }
      loadData();
    },
    [loadData]
  );

  return {
    activeTab,
    setActiveTab,
    invoices,
    creditNotes,
    packages,
    products,
    requestingId,
    packageError,
    loading,
    claimingId,
    claimPaid,
    loadData,
    requestPackage,
    cancelRequest,
  };
}
