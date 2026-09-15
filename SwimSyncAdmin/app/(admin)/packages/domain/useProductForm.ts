// The "Add package" product form (slice 3). Stage 6 of
// PACKAGES_REFACTOR_PLAN.md. Owns its own formError; busy/reload come from
// usePackageList (⚠ RISK 2). Validations run BEFORE coercing (Number("")===0
// has saved a $0 rate here before — §7.22/§7.14).

import { useState } from "react";
import * as repo from "../dao/packages.repo";
import * as rpc from "../dao/packages.rpc";

type Shared = {
  setBusy: (b: boolean) => void;
  reload: () => void;
};

export function useProductForm({ setBusy, reload }: Shared) {
  const [productModal, setProductModal] = useState(false);
  const [pName, setPName] = useState("");
  const [pCategory, setPCategory] = useState("");
  const [pLessons, setPLessons] = useState("");
  const [pRate, setPRate] = useState("");
  const [pWeeks, setPWeeks] = useState("12");
  // Per-product referral override (D4): off = inherit the tenant default; on =
  // this product's own type + value (a 0 is an explicit "no referral discount").
  const [pRefOverride, setPRefOverride] = useState(false);
  const [pRefType, setPRefType] = useState<"percent" | "amount">("percent");
  const [pRefValue, setPRefValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function openProductModal() {
    setPName("");
    setPCategory("");
    setPLessons("");
    setPRate("");
    setPWeeks("12");
    setPRefOverride(false);
    setPRefType("percent");
    setPRefValue("");
    setFormError(null);
    setProductModal(true);
  }

  async function saveProduct() {
    const name = pName.trim();
    // Empty BEFORE coercing — Number("") is 0, which has saved a $0 wage rate
    // and an invoice run day of 1 in this codebase (§7.22, §7.14). The DB
    // CHECKs would refuse anyway; validating here gives a usable message.
    if (!name) return setFormError("The package needs a name.");
    if (pLessons.trim() === "" || !Number.isInteger(Number(pLessons)) || Number(pLessons) <= 0)
      return setFormError("Lessons must be a whole number above zero.");
    if (pRate.trim() === "" || !Number.isFinite(Number(pRate)) || Number(pRate) <= 0)
      return setFormError("The rate per lesson must be above zero.");
    if (pWeeks.trim() === "" || !Number.isInteger(Number(pWeeks)) || Number(pWeeks) <= 0)
      return setFormError("Validity must be a whole number of weeks.");
    if (pRefOverride) {
      if (pRefValue.trim() === "" || !Number.isFinite(Number(pRefValue)) || Number(pRefValue) < 0)
        return setFormError("The referral discount must be zero or more.");
      if (pRefType === "percent" && Number(pRefValue) > 100)
        return setFormError("A percentage discount cannot exceed 100.");
    }

    setBusy(true);
    setFormError(null);
    const { error: err } = await repo.insertProduct({
      name,
      category_id: pCategory || null,
      lesson_count: Number(pLessons),
      rate_per_lesson: Number(pRate),
      validity_weeks: Number(pWeeks),
      // Override present ⇒ its own type + value; absent ⇒ NULL/NULL = inherit.
      referral_discount_type: pRefOverride ? pRefType : null,
      referral_discount_value: pRefOverride ? Number(pRefValue) : null,
      tenant_id: await rpc.myTenantId(),
    });
    setBusy(false);
    if (err) {
      setFormError("Could not create the package.");
      return;
    }
    setProductModal(false);
    reload();
  }

  return {
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
    openProductModal,
    saveProduct,
  };
}

export type ProductForm = ReturnType<typeof useProductForm>;
