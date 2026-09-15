// "Record a sale" modal (slice 4). Stage 8 of PACKAGES_REFACTOR_PLAN.md —
// markup verbatim; state/handlers come as one `form` prop (useSale).

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { money } from "../constants";
import type { ParentOption, Product } from "../types";
import type { SaleForm } from "../domain/useSale";

export function SaleModal({
  form,
  parents,
  activeProducts,
  busy,
}: {
  form: SaleForm;
  parents: ParentOption[];
  activeProducts: Product[];
  busy: boolean;
}) {
  const {
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
  } = form;

  return (
    <Modal
      open={saleModal}
      onClose={() => setSaleModal(false)}
      title="Record a sale"
    >
      <p className="mb-4 text-sm text-gray-600">
        For a purchase arranged outside the app. The package becomes active
        immediately — record it only once the money has arrived.
      </p>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Parent
          </label>
          <select
            value={saleParent}
            onChange={(e) => setSaleParent(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Choose…</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Package
          </label>
          <select
            value={saleProduct}
            onChange={(e) => setSaleProduct(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Choose…</option>
            {activeProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {money(p.lesson_count * p.rate_per_lesson)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Start date
          </label>
          <input
            type="date"
            value={saleStart}
            onChange={(e) => setSaleStart(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            Suggested from when this parent&rsquo;s current coverage ends —
            adjust it freely.
          </p>
        </div>
        {/* ⚠ RISK 7 — the price the family pays, from preview_package_price,
            so a referral discount is visible before recording the sale. */}
        {salePreview && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
            {salePreview.discount > 0 ? (
              <span className="text-gray-700">
                Pays <strong>{money(salePreview.payable)}</strong>{" "}
                <span className="text-emerald-700">
                  (−{money(salePreview.discount)} referral discount off{" "}
                  {money(salePreview.total)})
                </span>
              </span>
            ) : (
              <span className="text-gray-700">
                Pays <strong>{money(salePreview.payable)}</strong>
              </span>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setSaleModal(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={recordSale}
            disabled={busy || !saleParent || !saleProduct}
          >
            {busy ? "Saving…" : "Record sale"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
