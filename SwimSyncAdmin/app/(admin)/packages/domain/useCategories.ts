// The "Class categories" slice (slice 2) of the Packages page: the new-category
// input and the five category writes. Stage 5 of PACKAGES_REFACTOR_PLAN.md.
// busy/error/reload come from usePackageList (⚠ RISK 2 — one flag, one banner).

import { useState } from "react";
import * as repo from "../dao/packages.repo";
import * as rpc from "../dao/packages.rpc";
import type { Category } from "../types";

type Shared = {
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  reload: () => void;
};

export function useCategories({ setBusy, setError, reload }: Shared) {
  const [newCategory, setNewCategory] = useState("");

  async function addCategory() {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    setBusy(true);
    const { error: err } = await repo.insertCategory({
      name: trimmed,
      tenant_id: await rpc.myTenantId(),
    });
    setBusy(false);
    if (err) {
      setError(
        err.code === "23505"
          ? `You already have a category called "${trimmed}".`
          : "Could not add that category."
      );
      return;
    }
    setNewCategory("");
    setError(null);
    reload();
  }

  async function removeCategory(c: Category) {
    setBusy(true);
    const { error: err } = await repo.deleteCategory(c.id);
    setBusy(false);
    if (err) {
      // 23503: a product is sold against it — deleting would silently widen
      // that product's scope to all classes, which the FK forbids.
      setError(
        err.code === "23503"
          ? `"${c.name}" has packages sold against it. Retire those products first.`
          : "Could not remove that category."
      );
      return;
    }
    setError(null);
    reload();
  }

  /** Set (or clear, with "") a category's default renewal product. The DB
   *  trigger refuses a product of the wrong category/tenant or a retired one. */
  async function setCategoryDefault(categoryId: string, productId: string) {
    setBusy(true);
    const { error: err } = await repo.updateCategoryDefault(
      categoryId,
      productId || null
    );
    setBusy(false);
    if (err) {
      setError("Could not set that default.");
      return;
    }
    setError(null);
    reload();
  }

  /** Set (or clear, with "") a category's default max students. The CHECK
   *  refuses 0 / negatives; the field is validated here so the message names
   *  the field rather than a constraint. */
  async function setCategoryCapacity(categoryId: string, raw: string) {
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < 1)) {
      setError("Max students must be a whole number of 1 or more, or blank for no limit.");
      return;
    }
    setBusy(true);
    const { error: err } = await repo.updateCategoryCapacity(categoryId, value);
    setBusy(false);
    if (err) {
      setError("Could not set that max students.");
      return;
    }
    setError(null);
    reload();
  }

  /** Set (or clear) the all-classes fallback default for the business. */
  async function setAllClassesDefault(productId: string) {
    const tenant = await rpc.myTenantId();
    if (!tenant) return;
    setBusy(true);
    const { error: err } = await repo.updateTenantDefaultProduct(
      tenant,
      productId || null
    );
    setBusy(false);
    if (err) {
      setError("Could not set that default.");
      return;
    }
    setError(null);
    reload();
  }

  return {
    newCategory,
    setNewCategory,
    addCategory,
    removeCategory,
    setCategoryDefault,
    setCategoryCapacity,
    setAllClassesDefault,
  };
}
