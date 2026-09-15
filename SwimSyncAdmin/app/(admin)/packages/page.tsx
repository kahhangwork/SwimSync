"use client";

// Prepaid lesson packages — what this business sells, and who holds one.
//
// THREE SECTIONS, one page, because they are one feature:
//   • Class categories — the business's own vocabulary for "what kind of
//     class" (Group, Private…). A package is sold against ONE category, or
//     against every class (no category). Categories exist FOR packages, so
//     they live here rather than as their own nav item.
//   • Products — what is offered: N lessons at a locked rate, valid M months.
//     Money terms are IMMUTABLE by database trigger — a price change is
//     retire + create new, never an edit, so no change can reprice a package
//     a family already holds (the class_rates philosophy).
//   • Purchases — pending requests to confirm (the admin's proof-of-payment
//     step, PRD §7.9's manual-verification model), plus every package held.
//
// Balances shown here are LIVE: package_live_balances() subtracts lessons
// already attended but not yet invoiced. Do NOT recompute that in TS — the
// RPC is the single derivation (PACKAGES_DESIGN.md ⚠ RISK 4).

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { WhatsAppQueue } from "@/components/WhatsAppQueue";
import { usePackageList } from "./domain/usePackageList";
import { useCategories } from "./domain/useCategories";
import { usePurchaseActions } from "./domain/usePurchaseActions";
import { useProductForm } from "./domain/useProductForm";
import { useExtend } from "./domain/useExtend";
import { useSale } from "./domain/useSale";
import { useGenerateOffers } from "./domain/useGenerateOffers";
import { ListNotices } from "./ui/ListNotices";
import { ProductModal } from "./ui/ProductModal";
import { ExtendModal } from "./ui/ExtendModal";
import { SaleModal } from "./ui/SaleModal";
import { GenerateOffersModal } from "./ui/GenerateOffersModal";
import { CategoriesSection } from "./ui/CategoriesSection";
import { ConfirmPaymentModal } from "./ui/ConfirmPaymentModal";
import { CancelModal } from "./ui/CancelModal";
import { PendingPanel } from "./ui/PendingPanel";
import { ProductsTable } from "./ui/ProductsTable";
import { HeldTable } from "./ui/HeldTable";

export default function PackagesPage() {
  // Slice 1 (list-core): all loaded data, held-search, the WhatsApp queue, and
  // the shared busy/error flags live in usePackageList. ⚠ RISK 2 — busy/error
  // are single, owned there, and passed to the other slices (still page
  // functions until their stage). load() is the hook's; every handler awaits it.
  const {
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
    pending,
    superseded,
    held,
    heldMatches,
    activeProducts,
    setError,
    setBusy,
    setQueue,
    setHeldSearch,
    setShowSuperseded,
    load,
    setProductActive,
  } = usePackageList();

  // Slices 2, 5, 6 — categories, confirm-payment, cancel. Each takes the shared
  // busy/error and load() from list-core (⚠ RISK 2).
  const {
    newCategory,
    setNewCategory,
    addCategory,
    removeCategory,
    setCategoryDefault,
    setCategoryCapacity,
    setAllClassesDefault,
  } = useCategories({ setBusy, setError, reload: load });

  const {
    confirming,
    setConfirming,
    cancelling,
    setCancelling,
    confirmStart,
    setConfirmStart,
    confirmPurchase,
    cancelPurchase,
  } = usePurchaseActions({ setBusy, setError, reload: load });

  // Slice 3 — the "Add package" product form.
  const productForm = useProductForm({ setBusy, reload: load });
  const { openProductModal } = productForm;

  // Slice 7 — manual extension.
  const extend = useExtend({ setBusy, reload: load });
  const { openExtend } = extend;

  // Slice 4 — record a sale + price preview.
  const sale = useSale({ setBusy, setError, reload: load });
  const { setSaleModal } = sale;

  // Slice 8 — generate renewal offers (⚠ RISK 9: list-core state as params).
  const gen = useGenerateOffers({
    activeProducts,
    businessName,
    setQueue,
    setError,
    reload: load,
  });
  const { openGenerateAll, genBusy } = gen;

  return (
    <div>
      <PageHeader
        title="Packages"
        subtitle="Prepaid lesson packages — what you sell, and who holds one"
      />

      <div className="mb-6 flex justify-end">
        <Button onClick={openGenerateAll} disabled={genBusy || loading}>
          {genBusy ? "Loading…" : "Generate renewal offers"}
        </Button>
      </div>

      <ListNotices error={error} />


      {/* ── Pending requests — the action queue, so it comes first ────────── */}
      <PendingPanel
        pending={pending}
        superseded={superseded}
        showSuperseded={showSuperseded}
        setShowSuperseded={setShowSuperseded}
        busy={busy}
        setConfirming={setConfirming}
        setCancelling={setCancelling}
      />

      {/* ── Class categories ──────────────────────────────────────────────── */}
      <CategoriesSection
        categories={categories}
        activeProducts={activeProducts}
        tenantDefaultProduct={tenantDefaultProduct}
        busy={busy}
        newCategory={newCategory}
        setNewCategory={setNewCategory}
        addCategory={addCategory}
        removeCategory={removeCategory}
        setCategoryDefault={setCategoryDefault}
        setCategoryCapacity={setCategoryCapacity}
        setAllClassesDefault={setAllClassesDefault}
      />

      {/* ── Products ──────────────────────────────────────────────────────── */}
      <ProductsTable
        products={products}
        loading={loading}
        busy={busy}
        setProductActive={setProductActive}
        openProductModal={openProductModal}
      />

      {/* ── Held packages ─────────────────────────────────────────────────── */}
      <HeldTable
        held={held}
        heldMatches={heldMatches}
        heldSearch={heldSearch}
        setHeldSearch={setHeldSearch}
        loading={loading}
        capped={capped}
        busy={busy}
        openExtend={openExtend}
        setCancelling={setCancelling}
        setSaleModal={setSaleModal}
      />

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <ProductModal
        form={productForm}
        categories={categories}
        tenantReferral={tenantReferral}
        busy={busy}
      />

      <SaleModal
        form={sale}
        parents={parents}
        activeProducts={activeProducts}
        busy={busy}
      />

      <ConfirmPaymentModal
        confirming={confirming}
        confirmStart={confirmStart}
        setConfirmStart={setConfirmStart}
        busy={busy}
        setConfirming={setConfirming}
        confirmPurchase={confirmPurchase}
      />

      <CancelModal
        cancelling={cancelling}
        busy={busy}
        setCancelling={setCancelling}
        cancelPurchase={cancelPurchase}
      />

      {/* Manual extension */}
      <ExtendModal form={extend} busy={busy} />

      {/* ── Generate-all preview (Decision 6) — never a blind send ─────────── */}
      <GenerateOffersModal form={gen} activeProducts={activeProducts} />

      {/* ── WhatsApp queue — the shared shell, fed the created offers ───────── */}
      <WhatsAppQueue
        open={queue.length > 0}
        onClose={() => setQueue([])}
        title="Send the renewal links"
        intro={
          <>
            {queue.length} offer{queue.length === 1 ? "" : "s"} created and
            emailed. Each click opens a pre-filled WhatsApp chat in a new tab —{" "}
            <b>you still press Send there</b>.
          </>
        }
        rows={queue}
        onOpenChat={(id) => {
          const row = queue.find((q) => q.id === id);
          if (row?.link) window.open(row.link, "_blank", "noopener,noreferrer");
        }}
      />
    </div>
  );
}
