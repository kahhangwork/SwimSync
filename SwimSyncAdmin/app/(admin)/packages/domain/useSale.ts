// Record-a-sale + price preview (slice 4). Stage 8 of PACKAGES_REFACTOR_PLAN.md.
// busy/error/reload come from usePackageList (⚠ RISK 2).
//
// ⚠ RISK 8 — the suggest/preview effect moves VERBATIM: dep array
// [saleModal, saleParent, saleProduct], the exhaustive-deps disable, and NO
// reset of saleParent/saleProduct/saleStart on close. Only recordSale resets
// them. The page opens the modal with setSaleModal(true) — there is deliberately
// no open()/close() that clears the selection, so a reopened modal keeps the
// previous pair and its preview (today's behaviour).

import { useEffect, useState } from "react";
import { todayInSg } from "@/lib/lessonDates";
import * as repo from "../dao/packages.repo";
import * as rpc from "../dao/packages.rpc";
import { autoChildFor, saleStudentFor } from "./singleChild";
import type { ChildOption, Product } from "../types";

type Shared = {
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  reload: () => void;
  /** Wave 6 D5: the backdated check, run AFTER the sale is recorded (active). */
  onActivated?: (packageId: string, packageName: string) => void;
  /** The product's name, for the dialog's title line. */
  productName?: (productId: string) => string;
  /** The catalogue (to know a product's kind) and each family's active children
   *  at this business (single-child packages, D7). */
  products?: Product[];
  childOptions?: Map<string, ChildOption[]>;
};

export function useSale({
  setBusy,
  setError,
  reload,
  onActivated,
  productName,
  products = [],
  childOptions = new Map(),
}: Shared) {
  const [saleModal, setSaleModal] = useState(false);
  const [saleParent, setSaleParent] = useState("");
  const [saleProduct, setSaleProduct] = useState("");
  // Start date — pre-filled from suggest_package_start, always editable, and
  // failing open to today (⚠ RISK 7: the RPC must never block a sale).
  const [saleStart, setSaleStart] = useState("");
  // The one child a one-child product is for ("" = not chosen). Auto-picked
  // when the family has exactly one active child here (D7).
  const [saleChild, setSaleChild] = useState("");
  // A refusal the database explains (kind ↔ child, D11), shown in the modal.
  const [saleError, setSaleError] = useState<string | null>(null);
  const product = products.find((p) => p.id === saleProduct);
  const saleChildren = childOptions.get(saleParent) ?? [];
  const needsChild = !!product?.single_child;
  const [salePreview, setSalePreview] = useState<
    { total: number; discount: number; payable: number } | null
  >(null);

  // Sale form: when both parent and product are chosen, suggest a start date AND
  // preview the discounted price (RISK 7).
  // A new family or product re-decides the child: auto when there is one.
  useEffect(() => {
    setSaleChild(autoChildFor(childOptions.get(saleParent) ?? []));
    setSaleError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleParent, saleProduct]);

  const studentId = saleStudentFor(product, saleChild);
  useEffect(() => {
    if (saleModal && saleParent && saleProduct) {
      rpc.fetchSuggestedStart(saleParent, saleProduct, studentId).then(setSaleStart);
      rpc.fetchPreviewPrice(saleParent, saleProduct).then(setSalePreview);
    } else {
      setSalePreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleModal, saleParent, saleProduct, studentId]);

  async function recordSale() {
    if (!saleParent || !saleProduct) return;
    if (needsChild && !studentId) {
      setSaleError("Choose which child this package is for.");
      return;
    }
    setBusy(true);
    setSaleError(null);
    // Directly active: the admin recording an offline sale IS the
    // confirmation. The DB snapshots the product's terms and dates expiry from
    // the start date (defaulting to today if the admin cleared the field).
    const { data: created, error: err } = await repo.insertPurchase({
      parent_id: saleParent,
      product_id: saleProduct,
      status: "active",
      start_date: saleStart || todayInSg(),
      tenant_id: await rpc.myTenantId(),
      // ⚠ RISK 7 — a shared product sends null, never the selected child.
      student_id: studentId,
    });
    setBusy(false);
    if (err) {
      // 23514 = a sale the database refuses with a sentence for the admin
      // (which child; one kind per family, D11). Anything else stays generic.
      if (err.code === "23514") setSaleError(err.message);
      else setError("Could not record the sale.");
      return;
    }
    const soldProduct = saleProduct;
    setSaleModal(false);
    setSaleParent("");
    setSaleProduct("");
    setSaleStart("");
    setSaleChild("");
    reload();
    // A sale's start date can be in the past: lessons already marked since then
    // were not drawn at marking — ask (Wave 6 D5).
    if (created?.id) onActivated?.(created.id, productName?.(soldProduct) ?? "The package");
  }

  return {
    saleModal,
    setSaleModal,
    saleParent,
    setSaleParent,
    saleProduct,
    setSaleProduct,
    saleStart,
    setSaleStart,
    salePreview,
    saleChild,
    setSaleChild,
    saleChildren,
    needsChild,
    saleError,
    recordSale,
  };
}

export type SaleForm = ReturnType<typeof useSale>;
