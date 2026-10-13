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
    saleChild,
    setSaleChild,
    saleChildren,
    needsChild,
    saleError,
    recordSale,
  } = form;

  return (
    <Modal
      open={saleModal}
      onClose={() => setSaleModal(false)}
      title="Record a sale"
    >
      <p className="mb-4 text-body text-ink-secondary">
        For a purchase arranged outside the app. The package becomes active
        immediately — record it only once the money has arrived.
      </p>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-body font-medium text-ink-secondary">
            Parent
          </label>
          <select
            value={saleParent}
            onChange={(e) => setSaleParent(e.target.value)}
            className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
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
          <label className="mb-1 block text-body font-medium text-ink-secondary">
            Package
          </label>
          <select
            value={saleProduct}
            onChange={(e) => setSaleProduct(e.target.value)}
            className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
          >
            <option value="">Choose…</option>
            {activeProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {money(p.lesson_count * p.rate_per_lesson)}
                {p.single_child ? " (one child)" : ""}
              </option>
            ))}
          </select>
        </div>
        {/* Single-child packages (D7): which child a one-child package is for.
            With one active child here it is shown, not asked. */}
        {needsChild && saleParent && (
          <div>
            {saleChildren.length === 0 ? (
              <p className="text-body text-status-warning-text">
                This family has no active child at your business yet.
              </p>
            ) : saleChildren.length === 1 ? (
              <p className="text-body text-ink-secondary" data-testid="sale-child-auto">
                For <strong>{saleChildren[0].name}</strong>
              </p>
            ) : (
              <>
                <label className="mb-1 block text-body font-medium text-ink-secondary">
                  Which child is this for?
                </label>
                <select
                  value={saleChild}
                  onChange={(e) => setSaleChild(e.target.value)}
                  className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
                >
                  <option value="">Choose…</option>
                  {saleChildren.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}
        <div>
          <label className="mb-1 block text-body font-medium text-ink-secondary">
            Start date
          </label>
          <input
            type="date"
            value={saleStart}
            onChange={(e) => setSaleStart(e.target.value)}
            className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
          />
          <p className="mt-1 text-label text-ink-muted">
            Suggested from when this parent&rsquo;s current coverage ends —
            adjust it freely.
          </p>
        </div>
        {/* ⚠ RISK 7 — the price the family pays, from preview_package_price,
            so a referral discount is visible before recording the sale. */}
        {salePreview && (
          <div className="rounded-control bg-ground px-3 py-2 text-body">
            {salePreview.discount > 0 ? (
              <span className="text-ink-secondary">
                Pays <strong>{money(salePreview.payable)}</strong>{" "}
                <span className="text-status-success-text">
                  (−{money(salePreview.discount)} referral discount off{" "}
                  {money(salePreview.total)})
                </span>
              </span>
            ) : (
              <span className="text-ink-secondary">
                Pays <strong>{money(salePreview.payable)}</strong>
              </span>
            )}
          </div>
        )}
        {saleError && (
          <p className="text-body text-status-danger-text" role="alert">
            {saleError}
          </p>
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
            disabled={busy || !saleParent || !saleProduct || (needsChild && !saleChild)}
          >
            {busy ? "Saving…" : "Record sale"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
