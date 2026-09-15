// The "Class categories" section (slice 2). Stage 5 of
// PACKAGES_REFACTOR_PLAN.md — markup verbatim; state + handlers come from
// useCategories / usePackageList as props.

import { Button } from "@/components/Button";
import type { Category, Product } from "../types";

export function CategoriesSection({
  categories,
  activeProducts,
  tenantDefaultProduct,
  busy,
  newCategory,
  setNewCategory,
  addCategory,
  removeCategory,
  setCategoryDefault,
  setCategoryCapacity,
  setAllClassesDefault,
}: {
  categories: Category[];
  activeProducts: Product[];
  tenantDefaultProduct: string | null;
  busy: boolean;
  newCategory: string;
  setNewCategory: (v: string) => void;
  addCategory: () => void;
  removeCategory: (c: Category) => void;
  setCategoryDefault: (categoryId: string, productId: string) => void;
  setCategoryCapacity: (categoryId: string, raw: string) => void;
  setAllClassesDefault: (productId: string) => void;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-1 text-sm font-bold text-gray-900">
        Class categories
      </h2>
      <p className="mb-3 text-xs text-gray-500">
        Your own grouping of classes — &ldquo;Group&rdquo;,
        &ldquo;Private&rdquo;, whatever you price together. A package sold
        against a category is spendable at every class in it, including ones
        you add later. Assign a class its category on the Classes page.
      </p>
      <div className="mb-3 flex gap-2">
        <input
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCategory();
          }}
          placeholder="Group"
          className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <Button onClick={addCategory} disabled={busy || !newCategory.trim()}>
          Add category
        </Button>
      </div>
      {categories.length > 0 && (
        <ul className="space-y-1">
          {categories.map((c) => {
            // Products that may default this category: its own, or all-classes.
            const eligible = activeProducts.filter(
              (p) => p.category_id === c.id || p.category_id === null
            );
            return (
              <li
                key={c.id}
                className="flex w-[36rem] items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-900">{c.name}</span>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400">Default:</label>
                  <select
                    value={c.default_product_id ?? ""}
                    onChange={(e) => setCategoryDefault(c.id, e.target.value)}
                    disabled={busy}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="">None</option>
                    {eligible.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <label className="text-xs text-gray-400" htmlFor={`cap-${c.id}`}>
                    Max:
                  </label>
                  <input
                    // Keyed on the STORED value: a refused save (CHECK or RLS)
                    // reloads and remounts the field back to what the DB holds.
                    key={`${c.id}-${c.default_capacity ?? ""}`}
                    id={`cap-${c.id}`}
                    type="number"
                    min={1}
                    step={1}
                    placeholder="∞"
                    defaultValue={c.default_capacity ?? ""}
                    disabled={busy}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      const cur = c.default_capacity == null ? "" : String(c.default_capacity);
                      if (next !== cur) setCategoryCapacity(c.id, next);
                    }}
                    title="Default max students per class in this category (blank = no limit). Each class can override it."
                    className="w-14 rounded-lg border border-gray-300 px-2 py-1 text-xs"
                  />
                  <span className="text-xs text-gray-500">
                    {c.class_count} class{c.class_count === 1 ? "" : "es"}
                  </span>
                  <button
                    onClick={() => removeCategory(c)}
                    disabled={busy}
                    className="text-gray-400 hover:text-red-600"
                    aria-label={`Remove ${c.name}`}
                  >
                    &times;
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* The all-classes fallback: proposed when neither the family's original
          nor a category default applies (Decision 5). */}
      <div className="mt-3 flex w-[36rem] items-center gap-2 text-sm">
        <label className="text-xs text-gray-500">
          All-classes default (fallback):
        </label>
        <select
          value={tenantDefaultProduct ?? ""}
          onChange={(e) => setAllClassesDefault(e.target.value)}
          disabled={busy}
          className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">None</option>
          {activeProducts
            .filter((p) => p.category_id === null)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}
