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

type Shared = {
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  reload: () => void;
};

export function useSale({ setBusy, setError, reload }: Shared) {
  const [saleModal, setSaleModal] = useState(false);
  const [saleParent, setSaleParent] = useState("");
  const [saleProduct, setSaleProduct] = useState("");
  // Start date — pre-filled from suggest_package_start, always editable, and
  // failing open to today (⚠ RISK 7: the RPC must never block a sale).
  const [saleStart, setSaleStart] = useState("");
  const [salePreview, setSalePreview] = useState<
    { total: number; discount: number; payable: number } | null
  >(null);

  // Sale form: when both parent and product are chosen, suggest a start date AND
  // preview the discounted price (RISK 7).
  useEffect(() => {
    if (saleModal && saleParent && saleProduct) {
      rpc.fetchSuggestedStart(saleParent, saleProduct).then(setSaleStart);
      rpc.fetchPreviewPrice(saleParent, saleProduct).then(setSalePreview);
    } else {
      setSalePreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleModal, saleParent, saleProduct]);

  async function recordSale() {
    if (!saleParent || !saleProduct) return;
    setBusy(true);
    // Directly active: the admin recording an offline sale IS the
    // confirmation. The DB snapshots the product's terms and dates expiry from
    // the start date (defaulting to today if the admin cleared the field).
    const { error: err } = await repo.insertPurchase({
      parent_id: saleParent,
      product_id: saleProduct,
      status: "active",
      start_date: saleStart || todayInSg(),
      tenant_id: await rpc.myTenantId(),
    });
    setBusy(false);
    if (err) {
      setError("Could not record the sale.");
      return;
    }
    setSaleModal(false);
    setSaleParent("");
    setSaleProduct("");
    setSaleStart("");
    reload();
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
    recordSale,
  };
}

export type SaleForm = ReturnType<typeof useSale>;
