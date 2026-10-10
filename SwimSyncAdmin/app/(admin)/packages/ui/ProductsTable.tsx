// "What you sell" — the product catalogue table (display half of slices 1/3).
// Stage 11 of PACKAGES_REFACTOR_PLAN.md.
//
// ⚠ RISK 3 — productSort is declared here, ABOVE the `loading ? … : <Table>`
// branch, and the page renders <ProductsTable/> unconditionally, so the sort
// survives a load() reload (which flips loading true) instead of resetting.

import { useState } from "react";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { money } from "../constants";
import type { Product } from "../types";

export function ProductsTable({
  products,
  loading,
  busy,
  setProductActive,
  setProductSingleChild,
  openProductModal,
}: {
  products: Product[];
  loading: boolean;
  busy: boolean;
  setProductActive: (p: Product, active: boolean) => void;
  /** Shared ↔ one child (D6) — new sales only. */
  setProductSingleChild?: (p: Product, singleChild: boolean) => void;
  openProductModal: () => void;
}) {
  // The product whose kind is about to flip; confirmed in a dialog (D6).
  const [flipping, setFlipping] = useState<Product | null>(null);
  const productSort = useTableSort<Product>({
    key: "name",
    accessors: {
      category_name: (p) => p.category_name ?? "All classes",
      kind: (p) => (p.single_child ? 1 : 0),
      price: (p) => p.lesson_count * p.rate_per_lesson,
    },
  });
  const visibleProducts = productSort.apply(products);

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">What you sell</h2>
        <Button onClick={openProductModal}>Add package</Button>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : products.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="font-medium text-gray-900">No packages defined</p>
          <p className="mt-1 text-sm text-gray-500">
            A package is N lessons at a locked rate — e.g. 10 lessons at
            S$40, valid 12 weeks. Parents request one from the app and pay
            by PayNow; families without one simply stay on monthly invoices.
          </p>
        </div>
      ) : (
        <Table>
          <Thead>
            <Th sort={productSort} sortKey="name">Package</Th>
            <Th sort={productSort} sortKey="category_name">Valid for</Th>
            <Th sort={productSort} sortKey="kind">Who can use it</Th>
            <Th sort={productSort} sortKey="lesson_count" firstDir="desc">Lessons</Th>
            <Th sort={productSort} sortKey="rate_per_lesson" firstDir="desc">Rate</Th>
            <Th sort={productSort} sortKey="price" firstDir="desc">Price</Th>
            <Th sort={productSort} sortKey="validity_weeks" firstDir="desc">Validity</Th>
            <Th sort={productSort} sortKey="holder_count" firstDir="desc">Held by</Th>
            <Th>&nbsp;</Th>
          </Thead>
          <Tbody>
            {visibleProducts.map((p) => (
              <Tr key={p.id} className={p.is_active ? "" : "opacity-50"}>
                <Td className="font-medium text-gray-900">
                  {p.name}
                  {!p.is_active && (
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      retired
                    </span>
                  )}
                </Td>
                <Td className="text-gray-500">
                  {p.category_name ?? "All classes"}
                </Td>
                <Td className="text-gray-500">
                  {p.single_child ? "One child only" : "Shared across siblings"}
                  {setProductSingleChild && (
                    <button
                      onClick={() => setFlipping(p)}
                      disabled={busy}
                      className="ml-2 text-xs font-semibold text-sky-700 underline disabled:opacity-50"
                    >
                      Change
                    </button>
                  )}
                </Td>
                <Td className="text-gray-500">{p.lesson_count}</Td>
                <Td className="text-gray-500">{money(p.rate_per_lesson)}</Td>
                <Td className="text-gray-900">
                  {money(p.lesson_count * p.rate_per_lesson)}
                </Td>
                <Td className="text-gray-500">
                  {p.validity_weeks} week{p.validity_weeks === 1 ? "" : "s"}
                </Td>
                <Td className="text-gray-500">{p.holder_count}</Td>
                <Td>
                  <Button
                    variant="outline"
                    onClick={() => setProductActive(p, !p.is_active)}
                    disabled={busy}
                  >
                    {p.is_active ? "Retire" : "Reoffer"}
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      <Modal
        open={flipping !== null}
        onClose={() => setFlipping(null)}
        title={flipping?.single_child ? "Make it shared across siblings?" : "Make it one child only?"}
      >
        {flipping && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              {flipping.name} becomes{" "}
              <strong>{flipping.single_child ? "shared across siblings" : "one child only"}</strong>.
            </p>
            <p className="text-sm text-gray-600">
              Applies to new sales only — packages already sold keep their terms.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFlipping(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setProductSingleChild?.(flipping, !flipping.single_child);
                  setFlipping(null);
                }}
                disabled={busy}
              >
                Change
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <p className="mt-2 text-xs text-gray-500">
        A package&rsquo;s lessons, rate and validity can&rsquo;t be edited —
        families already hold them at those terms. To change the price,
        retire the package and create a new one; renewals then buy the new
        terms.
      </p>
    </div>
  );
}
