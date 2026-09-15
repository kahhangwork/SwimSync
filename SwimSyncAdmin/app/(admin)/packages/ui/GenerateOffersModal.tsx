// "Generate renewal offers" preview modal (slice 8). Stage 9 of
// PACKAGES_REFACTOR_PLAN.md — markup verbatim; the three inline onChanges become
// the hook's toggleInclude / changeCandidateProduct / changeCandidateStart.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { toWaNumber } from "@/lib/waMessage";
import { money } from "../constants";
import type { Product } from "../types";
import type { GenerateOffers } from "../domain/useGenerateOffers";

export function GenerateOffersModal({
  form,
  activeProducts,
}: {
  form: GenerateOffers;
  activeProducts: Product[];
}) {
  const {
    genModal,
    setGenModal,
    candidates,
    genBusy,
    genProgress,
    confirmGenerateAll,
    toggleInclude,
    changeCandidateProduct,
    changeCandidateStart,
  } = form;

  return (
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
                    onChange={(e) => toggleInclude(i, e.target.checked)}
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
                        onChange={(e) => changeCandidateProduct(i, e.target.value)}
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
                        onChange={(e) => changeCandidateStart(i, e.target.value)}
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
  );
}
