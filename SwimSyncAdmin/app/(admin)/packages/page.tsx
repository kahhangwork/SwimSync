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

import React, { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { todayInSg, formatSgStamp } from "@/lib/lessonDates";
import { pickOfferProduct } from "./domain/packageOffers";
import { buildPackageOfferMessage, buildWaLink, toWaNumber } from "@/lib/waMessage";
import { WhatsAppQueue, type WaQueueRow } from "@/components/WhatsAppQueue";
import { DMY, ROW_LIMIT, money } from "./constants";
import type { Category, Product, Purchase, CandidateRow } from "./types";
import * as repo from "./dao/packages.repo";
import * as rpc from "./dao/packages.rpc";
import { usePackageList } from "./domain/usePackageList";
import { useCategories } from "./domain/useCategories";
import { usePurchaseActions } from "./domain/usePurchaseActions";
import { useProductForm } from "./domain/useProductForm";
import { useExtend } from "./domain/useExtend";
import { useSale } from "./domain/useSale";
import { ListNotices } from "./ui/ListNotices";
import { ProductModal } from "./ui/ProductModal";
import { ExtendModal } from "./ui/ExtendModal";
import { SaleModal } from "./ui/SaleModal";
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

  // Renewal offers — Generate all preview + the resulting WhatsApp queue.
  const [genModal, setGenModal] = useState(false);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  const [genProgress, setGenProgress] = useState<string | null>(null);

  // ── Renewal offers ─────────────────────────────────────────────────────────

  /** Create ONE offer (create_package_offer), fire the best-effort offer email,
   *  and return the row for the WhatsApp queue. Throws on RPC failure so the
   *  caller can mark that family and continue (RISK 12: the RPC itself refuses a
   *  second open offer). */
  async function createOneOffer(
    c: CandidateRow
  ): Promise<WaQueueRow & { link: string | null }> {
    const { data: offerId, error: err } = await rpc.createPackageOffer(
      c.parent_id,
      c.chosenProduct,
      c.chosenStart || todayInSg()
    );
    if (err || !offerId) {
      throw new Error(err?.message ?? "offer failed");
    }

    const { data: row } = await repo.loadOfferRow(offerId as string);

    // Best-effort email (never blocks the offer).
    rpc
      .invokePackageEmail({ type: "offered", package_id: offerId })
      .catch(() => {});

    const waNumber = toWaNumber(c.parent_phone);
    const payUrl = row?.public_token
      ? `${window.location.origin.replace("admin.", "")}/package/${row.public_token}`
      : "";
    const waLink =
      waNumber && row
        ? buildWaLink(
            waNumber,
            buildPackageOfferMessage({
              businessName,
              childrenNames: c.children ? c.children.split(", ") : [],
              packageName: row.name as string,
              lessons: Number(row.lesson_count),
              // RISK 7 — the WhatsApp price MUST equal the /package pay-page
              // headline and the QR: amount_payable, not the undiscounted worth.
              price: Number(row.amount_payable),
              reference: (row.reference_number as string) ?? "",
              link: payUrl,
            })
          )
        : null;

    return {
      id: offerId as string,
      parentName: c.parent_name,
      subtitle: c.children,
      meta: row
        ? `${row.name} · ${money(Number(row.amount_payable))}`
        : null,
      waNumber,
      rawPhone: c.parent_phone,
      openedStamp: null, // an offer is superseded, not re-chased (no reminded_at)
      link: waLink,
    };
  }

  /** Open the Generate-all preview: pull the candidate families and seed each
   *  row with its suggested product + start date, editable, ticked when a
   *  product could be pre-selected (Decision 6). */
  async function openGenerateAll() {
    setGenBusy(true);
    setError(null);
    const { data, error: err } = await rpc.renewalCandidates();
    setGenBusy(false);
    if (err) {
      setError("Could not load renewal candidates.");
      return;
    }
    const rows: CandidateRow[] = await Promise.all(
      ((data as any[]) ?? []).map(async (r) => {
        const suggested =
          r.suggested_product_id ??
          pickOfferProduct(
            r.original_product_id
              ? {
                  productId: r.original_product_id,
                  isActive: activeProducts.some(
                    (p) => p.id === r.original_product_id
                  ),
                }
              : null,
            null,
            null
          ) ??
          "";
        const start = suggested
          ? await rpc.fetchSuggestedStart(r.parent_id, suggested)
          : todayInSg();
        const preview = suggested
          ? await rpc.fetchPreviewPrice(r.parent_id, suggested)
          : null;
        return {
          parent_id: r.parent_id,
          parent_name: r.parent_name ?? "Unknown",
          parent_phone: r.parent_phone ?? null,
          children: r.children ?? null,
          package_name: r.package_name ?? null,
          lessons_left: r.lessons_left ?? null,
          expires_on: r.expires_on ?? null,
          expired_days_ago: r.expired_days_ago ?? null,
          original_product_id: r.original_product_id ?? null,
          suggested_product_id: suggested || null,
          has_open_offer: !!r.has_open_offer,
          chosenProduct: suggested,
          chosenStart: start,
          include: !!suggested && !r.has_open_offer,
          previewTotal: preview?.total ?? null,
          previewDiscount: preview?.discount ?? null,
          previewPayable: preview?.payable ?? null,
        };
      })
    );
    setCandidates(rows);
    setGenModal(true);
  }

  /** Confirm the preview: create each ticked offer sequentially (a failure marks
   *  that row and continues — RISK 12), then open the WhatsApp queue. */
  async function confirmGenerateAll() {
    setGenBusy(true);
    const created: (WaQueueRow & { link: string | null })[] = [];
    const chosen = candidates.filter((c) => c.include && c.chosenProduct);
    for (let i = 0; i < chosen.length; i++) {
      setGenProgress(`Creating offer ${i + 1} of ${chosen.length}…`);
      try {
        created.push(await createOneOffer(chosen[i]));
      } catch {
        /* skip this family; the rest continue */
      }
    }
    setGenProgress(null);
    setGenBusy(false);
    setGenModal(false);
    setQueue(created);
    load();
  }

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
      <Modal
        open={genModal}
        onClose={() => !genBusy && setGenModal(false)}
        title="Generate renewal offers"
      >
        {candidates.length === 0 ? (
          <p className="text-sm text-gray-600">
            No families are due for renewal right now — everyone covered is above
            the low-balance and expiry thresholds, or already has an open offer.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Each family below is running low or has recently expired. Tick the
              ones to offer, adjust the package or start date, then confirm. An
              email goes out and a WhatsApp queue opens for the rest.
            </p>
            <div className="max-h-[420px] space-y-2 overflow-y-auto">
              {candidates.map((c, i) => (
                <div
                  key={c.parent_id}
                  className="rounded-lg border border-gray-200 p-3"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={c.include}
                      onChange={(e) =>
                        setCandidates((prev) =>
                          prev.map((r, j) =>
                            j === i ? { ...r, include: e.target.checked } : r
                          )
                        )
                      }
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">
                        {c.parent_name}
                        {c.children ? (
                          <span className="text-gray-400"> · {c.children}</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-gray-500">
                        {c.expired_days_ago != null
                          ? `Expired ${c.expired_days_ago} day${c.expired_days_ago === 1 ? "" : "s"} ago`
                          : `${c.lessons_left ?? 0} left${c.expires_on ? ` · expires ${c.expires_on}` : ""}`}
                        {c.has_open_offer ? " · already has an open offer" : ""}
                        {!toWaNumber(c.parent_phone) ? " · no WhatsApp number" : ""}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <select
                          value={c.chosenProduct}
                          onChange={(e) => {
                            const productId = e.target.value;
                            setCandidates((prev) =>
                              prev.map((r, j) =>
                                j === i
                                  ? { ...r, chosenProduct: productId, previewPayable: null,
                                      previewDiscount: null, previewTotal: null }
                                  : r
                              )
                            );
                            // RISK 7 — re-price via preview_package_price, never
                            // lesson_count × rate, so a referral discount shows.
                            if (productId) {
                              rpc.fetchPreviewPrice(c.parent_id, productId).then((pv) =>
                                setCandidates((prev) =>
                                  prev.map((r, j) =>
                                    j === i
                                      ? { ...r, previewTotal: pv?.total ?? null,
                                          previewDiscount: pv?.discount ?? null,
                                          previewPayable: pv?.payable ?? null }
                                      : r
                                  )
                                )
                              );
                            }
                          }}
                          className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                        >
                          <option value="">Choose package…</option>
                          {activeProducts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — {money(p.lesson_count * p.rate_per_lesson)}
                            </option>
                          ))}
                        </select>
                        <input
                          type="date"
                          value={c.chosenStart}
                          onChange={(e) =>
                            setCandidates((prev) =>
                              prev.map((r, j) =>
                                j === i
                                  ? { ...r, chosenStart: e.target.value }
                                  : r
                              )
                            )
                          }
                          className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                        />
                      </div>
                      {/* ⚠ RISK 7 — the discounted price this offer will carry
                          (preview_package_price), matching the WhatsApp price
                          and the pay-page headline. */}
                      {c.previewPayable != null && (
                        <div className="mt-1 text-xs text-gray-600">
                          Pays <strong>{money(c.previewPayable)}</strong>
                          {c.previewDiscount != null && c.previewDiscount > 0 && (
                            <span className="text-emerald-700">
                              {" "}(−{money(c.previewDiscount)} referral off{" "}
                              {money(c.previewTotal ?? 0)})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {genProgress && (
              <p className="text-xs text-sky-700">{genProgress}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setGenModal(false)}
                disabled={genBusy}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmGenerateAll}
                disabled={
                  genBusy ||
                  candidates.filter((c) => c.include && c.chosenProduct)
                    .length === 0
                }
              >
                {genBusy
                  ? "Creating…"
                  : `Create ${candidates.filter((c) => c.include && c.chosenProduct).length} offer(s)`}
              </Button>
            </div>
          </div>
        )}
      </Modal>

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
