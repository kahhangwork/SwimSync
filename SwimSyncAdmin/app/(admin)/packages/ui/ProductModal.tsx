// "Add package" modal (slice 3). Stage 6 of PACKAGES_REFACTOR_PLAN.md — markup
// verbatim; the form state/handlers come as one `form` prop (useProductForm).

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { discountLabel } from "@/lib/referralDiscount";
import { money } from "../constants";
import type { Category } from "../types";
import type { ProductForm } from "../domain/useProductForm";
import type { TenantReferral } from "../domain/usePackageList";

export function ProductModal({
  form,
  categories,
  tenantReferral,
  busy,
}: {
  form: ProductForm;
  categories: Category[];
  tenantReferral: TenantReferral;
  busy: boolean;
}) {
  const {
    productModal,
    setProductModal,
    pName,
    setPName,
    pCategory,
    setPCategory,
    pLessons,
    setPLessons,
    pRate,
    setPRate,
    pWeeks,
    setPWeeks,
    pRefOverride,
    setPRefOverride,
    pRefType,
    setPRefType,
    pRefValue,
    setPRefValue,
    formError,
    saveProduct,
  } = form;

  return (
    <Modal
      open={productModal}
      onClose={() => setProductModal(false)}
      title="Add package"
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            value={pName}
            onChange={(e) => setPName(e.target.value)}
            placeholder="10 Group Lessons"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Valid for
          </label>
          <select
            value={pCategory}
            onChange={(e) => setPCategory(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">All classes</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} classes only
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Lessons
            </label>
            <input
              value={pLessons}
              onChange={(e) => setPLessons(e.target.value)}
              inputMode="numeric"
              placeholder="10"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Rate (S$)
            </label>
            <input
              value={pRate}
              onChange={(e) => setPRate(e.target.value)}
              inputMode="decimal"
              placeholder="40"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Weeks valid
            </label>
            <input
              value={pWeeks}
              onChange={(e) => setPWeeks(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        {pLessons && pRate && Number(pLessons) > 0 && Number(pRate) > 0 && (
          <p className="text-sm text-gray-600">
            Sells for{" "}
            <strong>{money(Number(pLessons) * Number(pRate))}</strong> —{" "}
            {pLessons} lessons at {money(Number(pRate))} each.
          </p>
        )}

        {/* Referral discount override (D4). Off = inherit the tenant default. */}
        <div className="rounded-lg border border-gray-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={pRefOverride}
              onChange={(e) => setPRefOverride(e.target.checked)}
            />
            Override referral discount
          </label>
          {!pRefOverride ? (
            <p className="mt-1 text-xs text-gray-500">
              {tenantReferral.enabled && tenantReferral.type
                ? `Inherits the tenant default (${discountLabel(tenantReferral.type, tenantReferral.value ?? 0)}).`
                : "Referrals are off, or no tenant default is set — no discount applies."}
            </p>
          ) : (
            <div className="mt-2 flex items-end gap-2">
              <select
                value={pRefType}
                onChange={(e) => setPRefType(e.target.value as "percent" | "amount")}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="percent">Percent (%)</option>
                <option value="amount">Fixed (S$)</option>
              </select>
              <input
                value={pRefValue}
                onChange={(e) => setPRefValue(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
              />
              <span className="text-xs text-gray-500">
                0 = no referral discount on this product.
              </span>
            </div>
          )}
        </div>

        {formError && <p className="text-sm text-red-600">{formError}</p>}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setProductModal(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={saveProduct} disabled={busy}>
            {busy ? "Saving…" : "Create package"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
