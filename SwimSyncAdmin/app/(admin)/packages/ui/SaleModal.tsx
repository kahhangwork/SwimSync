// "Record a sale" modal (slice 4). Stage 8 of PACKAGES_REFACTOR_PLAN.md —
// markup verbatim; state/handlers come as one `form` prop (useSale).

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { money } from "../constants";
import { todayInSg } from "@/lib/lessonDates";
import type { ParentOption, Product, Purchase } from "../types";
import type { SaleForm } from "../domain/useSale";

export function SaleModal({
  form,
  parents,
  activeProducts,
  busy,
  pending = [],
}: {
  form: SaleForm;
  parents: ParentOption[];
  activeProducts: Product[];
  busy: boolean;
  /** Pending purchases — to warn that a bring-in supersedes an open offer (RISK 12). */
  pending?: Purchase[];
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
    carried,
    setCarried,
    carriedStart,
    setCarriedStart,
    carriedLessons,
    setCarriedLessons,
    selectedProduct,
    recordCarried,
  } = form;

  // RISK 12 — supersede_open_package_offer cancels the family's open offer for
  // the same audience (the family, or this one child) when a package goes active.
  const audience = needsChild ? saleChild || null : null;
  const openOffer = pending.find(
    (p) =>
      p.parent_id === saleParent &&
      p.offered_by &&
      !p.paid_claimed_at &&
      !p.superseded_by &&
      (p.student_id ?? null) === audience
  );

  return (
    <Modal
      open={saleModal}
      onClose={() => setSaleModal(false)}
      title="Record a sale"
    >
      <p className="mb-4 text-body text-ink-secondary">
        {carried
          ? "For a package the family bought before you started using SwimSync. Nothing is charged and it adds nothing to Revenue — the family already paid."
          : "For a purchase arranged outside the app. The package becomes active immediately — record it only once the money has arrived."}
      </p>
      <div className="space-y-4">
        <label className="flex items-start gap-2 text-body text-ink-secondary">
          <input
            type="checkbox"
            checked={carried}
            onChange={(e) => setCarried(e.target.checked)}
            className="mt-1"
            data-testid="sale-carried-toggle"
          />
          <span>
            <span className="font-medium">Existing package (bought before SwimSync)</span>
            <span className="block text-label text-ink-muted">
              Bring in a package a family is part-way through, with the lessons they have left.
            </span>
          </span>
        </label>
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
        {carried && (
          <p className="-mt-2 text-label text-ink-muted">
            Made a product just for this? Retire it afterwards so families can&rsquo;t buy it.
          </p>
        )}
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
        {carried ? (
          <>
            <div>
              <label htmlFor="carried-start" className="mb-1 block text-body font-medium text-ink-secondary">
                Original start date
              </label>
              <input
                id="carried-start"
                type="date"
                value={carriedStart}
                max={todayInSg()}
                onChange={(e) => setCarriedStart(e.target.value)}
                className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
              />
              <p className="mt-1 text-label text-ink-muted">
                When the family&rsquo;s package began. It expires{" "}
                {selectedProduct ? `${selectedProduct.validity_weeks} weeks` : "the package's validity"} after
                this date — use Extend afterwards for any extension you already gave.
              </p>
            </div>
            <div>
              <label htmlFor="carried-lessons" className="mb-1 block text-body font-medium text-ink-secondary">
                Lessons remaining{selectedProduct ? ` (of ${selectedProduct.lesson_count})` : ""}
              </label>
              <input
                id="carried-lessons"
                type="number"
                inputMode="numeric"
                min={1}
                max={selectedProduct?.lesson_count}
                value={carriedLessons}
                onChange={(e) => setCarriedLessons(e.target.value)}
                className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
              />
              <p className="mt-1 text-label text-ink-muted" data-testid="carried-help">
                Count what is left as of today, after every lesson before today — including any
                already marked in SwimSync. Lessons before today never come off this package.
              </p>
            </div>
            {openOffer && (
              <p className="text-body text-status-warning-text" data-testid="carried-offer-warning">
                This family has an open offer{openOffer.reference_number ? ` (${openOffer.reference_number})` : ""}.
                Bringing this package in cancels it.
              </p>
            )}
          </>
        ) : (
        <>
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
        </>
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
          {carried ? (
            <Button
              onClick={recordCarried}
              disabled={busy || !saleParent || !saleProduct || (needsChild && !saleChild) || !carriedStart || !carriedLessons}
            >
              {busy ? "Saving…" : "Bring in package"}
            </Button>
          ) : (
            <Button
              onClick={recordSale}
              disabled={busy || !saleParent || !saleProduct || (needsChild && !saleChild)}
            >
              {busy ? "Saving…" : "Record sale"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
