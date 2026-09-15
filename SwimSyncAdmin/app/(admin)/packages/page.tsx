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
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { todayInSg, formatSgStamp } from "@/lib/lessonDates";
import { WhatsAppQueue } from "@/components/WhatsAppQueue";
import { DMY, ROW_LIMIT, money } from "./constants";
import type { Category, Product, Purchase } from "./types";
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

  // Oldest request first: this queue is work waiting on the admin, and the
  // parent who has been waiting longest is the one to serve next.
  const pendingSort = useTableSort<Purchase>({ key: "requested_at" });
  const visiblePending = pendingSort.apply(pending);

  const productSort = useTableSort<Product>({
    key: "name",
    accessors: {
      category_name: (p) => p.category_name ?? "All classes",
      price: (p) => p.lesson_count * p.rate_per_lesson,
    },
  });
  const visibleProducts = productSort.apply(products);

  const heldSort = useTableSort<Purchase>({
    key: "parent_name",
    accessors: { remaining: (p) => p.live_lessons_remaining },
  });
  const visibleHeld = heldSort.apply(heldMatches);
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
      {(pending.length > 0 || superseded.length > 0) && (
        <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-bold text-amber-900">
              Awaiting confirmation ({pending.length})
            </h2>
            {superseded.length > 0 && (
              <button
                onClick={() => setShowSuperseded((v) => !v)}
                className="text-xs font-semibold text-amber-700 underline"
              >
                {showSuperseded ? "Hide" : "Show"} superseded ({superseded.length})
              </button>
            )}
          </div>
          <p className="mb-3 text-xs text-amber-800">
            Confirm once the parent&rsquo;s PayNow transfer has landed in your
            account. Confirming starts the validity period.
          </p>
          <Table>
            <Thead>
              <Th sort={pendingSort} sortKey="parent_name">Parent</Th>
              <Th sort={pendingSort} sortKey="name">Package</Th>
              <Th sort={pendingSort} sortKey="reference_number">Reference</Th>
              <Th sort={pendingSort} sortKey="total_value" firstDir="desc">Price</Th>
              <Th sort={pendingSort} sortKey="requested_at">Requested</Th>
              <Th>&nbsp;</Th>
            </Thead>
            <Tbody>
              {visiblePending.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium text-gray-900">
                    {p.parent_name}
                    {p.offered_by && (
                      <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                        Offer
                      </span>
                    )}
                    {p.paid_claimed_at && (
                      <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        Claimed
                      </span>
                    )}
                  </Td>
                  <Td className="text-gray-600">
                    {p.name}
                    <span className="text-gray-400">
                      {" "}
                      · {p.lesson_count} × {money(p.rate_per_lesson)}
                    </span>
                  </Td>
                  {/* The whole point of the column: this string is what
                      appears on the bank statement, so it must be readable
                      and copyable, not summarised. */}
                  <Td className="font-mono text-xs text-gray-600">
                    {p.reference_number ?? "—"}
                  </Td>
                  <Td className="text-gray-900">
                    {money(p.amount_payable)}
                    {p.discount_amount > 0 && (
                      <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        −{money(p.discount_amount)}
                      </span>
                    )}
                  </Td>
                  <Td className="text-gray-500">
                    {formatSgStamp(p.requested_at, DMY)}
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button onClick={() => setConfirming(p)} disabled={busy}>
                        Payment received
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setCancelling(p)}
                        disabled={busy}
                      >
                        Decline
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
              {showSuperseded &&
                superseded.map((p) => (
                  <Tr key={p.id} className="opacity-60">
                    <Td className="font-medium text-gray-500">
                      {p.parent_name}
                      <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                        Superseded
                      </span>
                    </Td>
                    <Td className="text-gray-500">
                      {p.name}
                      <span className="text-gray-400">
                        {" "}
                        · {p.lesson_count} × {money(p.rate_per_lesson)}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs text-gray-500">
                      {p.reference_number ?? "—"}
                    </Td>
                    <Td className="text-gray-500">{money(p.total_value)}</Td>
                    <Td className="text-gray-400">
                      {formatSgStamp(p.requested_at, DMY)}
                    </Td>
                    <Td className="text-xs text-gray-400">
                      cancelled — a newer request replaced it
                    </Td>
                  </Tr>
                ))}
            </Tbody>
          </Table>
        </div>
      )}

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
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">What you sell</h2>
          <Button onClick={openProductModal}>Add package</Button>
        </div>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : products.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="font-medium text-gray-900">No packages defined</p>
            <p className="mt-1 text-sm text-gray-500">
              A package is N lessons at a locked rate — e.g. 10 lessons at
              S$40, valid 12 weeks. Parents request one from the app and pay
              by PayNow; families without one simply stay on monthly invoices.
            </p>
          </div>
        ) : (
          <Table>
            <Thead>
              <Th sort={productSort} sortKey="name">Package</Th>
              <Th sort={productSort} sortKey="category_name">Valid for</Th>
              <Th sort={productSort} sortKey="lesson_count" firstDir="desc">Lessons</Th>
              <Th sort={productSort} sortKey="rate_per_lesson" firstDir="desc">Rate</Th>
              <Th sort={productSort} sortKey="price" firstDir="desc">Price</Th>
              <Th sort={productSort} sortKey="validity_weeks" firstDir="desc">Validity</Th>
              <Th sort={productSort} sortKey="holder_count" firstDir="desc">Held by</Th>
              <Th>&nbsp;</Th>
            </Thead>
            <Tbody>
              {visibleProducts.map((p) => (
                <Tr key={p.id} className={p.is_active ? "" : "opacity-50"}>
                  <Td className="font-medium text-gray-900">
                    {p.name}
                    {!p.is_active && (
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        retired
                      </span>
                    )}
                  </Td>
                  <Td className="text-gray-500">
                    {p.category_name ?? "All classes"}
                  </Td>
                  <Td className="text-gray-500">{p.lesson_count}</Td>
                  <Td className="text-gray-500">{money(p.rate_per_lesson)}</Td>
                  <Td className="text-gray-900">
                    {money(p.lesson_count * p.rate_per_lesson)}
                  </Td>
                  <Td className="text-gray-500">
                    {p.validity_weeks} week{p.validity_weeks === 1 ? "" : "s"}
                  </Td>
                  <Td className="text-gray-500">{p.holder_count}</Td>
                  <Td>
                    <Button
                      variant="outline"
                      onClick={() => setProductActive(p, !p.is_active)}
                      disabled={busy}
                    >
                      {p.is_active ? "Retire" : "Reoffer"}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-gray-500">
          A package&rsquo;s lessons, rate and validity can&rsquo;t be edited —
          families already hold them at those terms. To change the price,
          retire the package and create a new one; renewals then buy the new
          terms.
        </p>
      </div>

      {/* ── Held packages ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-gray-900">Who holds one</h2>
          <div className="flex items-center gap-2">
            {held.length > 0 && (
              <input
                type="text"
                placeholder="Search parent, package or ref…"
                value={heldSearch}
                onChange={(e) => setHeldSearch(e.target.value)}
                className="w-56 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            )}
            <Button variant="outline" onClick={() => setSaleModal(true)}>
              Record a sale
            </Button>
          </div>
        </div>
        {!loading && capped && (
          <p className="mb-3 text-sm text-amber-700">
            Showing the first {ROW_LIMIT} packages — the list is truncated. This
            is not expected; contact support if you see it.
          </p>
        )}
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : held.length === 0 ? (
          <p className="text-sm text-gray-400">
            Nobody holds a package yet.
          </p>
        ) : heldMatches.length === 0 ? (
          <p className="text-sm text-gray-400">
            No held package matches &ldquo;{heldSearch}&rdquo;.
          </p>
        ) : (
          <Table>
            <Thead>
              <Th sort={heldSort} sortKey="parent_name">Parent</Th>
              <Th sort={heldSort} sortKey="name">Package</Th>
              <Th sort={heldSort} sortKey="reference_number">Reference</Th>
              <Th sort={heldSort} sortKey="remaining">Remaining</Th>
              <Th sort={heldSort} sortKey="start_date">Starts</Th>
              <Th sort={heldSort} sortKey="expires_on">Expires</Th>
              <Th sort={heldSort} sortKey="status">Status</Th>
              <Th>&nbsp;</Th>
            </Thead>
            <Tbody>
              {visibleHeld.map((p) => {
                // todayInSg(), never toISOString().slice — the UTC date is
                // yesterday in SGT before 08:00 (§7.7).
                const expired =
                  p.status === "active" &&
                  p.expires_on !== null &&
                  p.expires_on < todayInSg();
                return (
                  <Tr key={p.id}>
                    <Td className="font-medium text-gray-900">
                      {p.parent_name}
                      {p.children && (
                        <span className="block text-xs font-normal text-gray-400">
                          {p.children}
                        </span>
                      )}
                    </Td>
                    <Td className="text-gray-600">
                      {p.name}
                      <span className="text-gray-400">
                        {" "}
                        · {p.category_name ?? "all classes"}
                      </span>
                    </Td>
                    {/* Kept here too so a payment can still be reconciled
                        after the request has been confirmed. */}
                    <Td className="font-mono text-xs text-gray-600">
                      {p.reference_number ?? "—"}
                    </Td>
                    <Td>
                      {p.status === "active" &&
                      p.live_lessons_remaining !== null ? (
                        <span
                          className="font-medium text-gray-900"
                          data-testid="live-remaining"
                        >
                          {p.live_lessons_remaining} lesson
                          {p.live_lessons_remaining === 1 ? "" : "s"}
                          <span className="font-normal text-gray-400">
                            {" "}
                            · {money(p.live_value_remaining ?? 0)}
                          </span>
                          {p.live_value_remaining !== p.value_remaining && (
                            <span
                              className="ml-1 font-normal text-gray-400"
                              title="Includes lessons attended but not yet invoiced"
                            >
                              *
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-500">
                          {money(p.value_remaining)}
                        </span>
                      )}
                    </Td>
                    <Td className="text-gray-500">{p.start_date ?? "—"}</Td>
                    <Td className="text-gray-500">
                      {p.expires_on ?? "—"}
                      {expired && (
                        <span className="ml-1 text-xs text-red-600">
                          expired
                        </span>
                      )}
                      {p.holiday_extension_days > 0 && (
                        <div className="mt-0.5 text-xs text-gray-400">
                          +{p.holiday_extension_days} day
                          {p.holiday_extension_days === 1 ? "" : "s"} · public holidays
                        </div>
                      )}
                      {p.cancel_extension_days > 0 && (
                        <div className="mt-0.5 text-xs text-gray-400">
                          +{p.cancel_extension_days} day
                          {p.cancel_extension_days === 1 ? "" : "s"} · cancelled lessons
                        </div>
                      )}
                      {p.manual_extension_days > 0 && (
                        <div className="mt-0.5 text-xs text-gray-400">
                          +{p.manual_extension_days} day
                          {p.manual_extension_days === 1 ? "" : "s"} · manual
                        </div>
                      )}
                    </Td>
                    <Td>
                      <StatusBadge
                        status={
                          p.status.charAt(0).toUpperCase() + p.status.slice(1)
                        }
                      />
                    </Td>
                    <Td>
                      {p.status === "active" && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openExtend(p)}
                            disabled={busy}
                          >
                            Extend
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setCancelling(p)}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-gray-500">
          * Remaining balances are live: lessons attended but not yet invoiced
          are already subtracted. The money itself moves when the month is
          billed.
        </p>
      </div>

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
