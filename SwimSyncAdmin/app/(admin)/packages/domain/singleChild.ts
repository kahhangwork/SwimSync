// Single-child packages (20261010000100, docs/plans/SINGLE_CHILD_PACKAGES_PLAN.md):
// the pure decisions the sale and the renewal offers make about WHICH child a
// package is for. No React, no client — unit-tested in singleChild.test.ts.
//
// The database is the guard (the lifecycle trigger refuses a mismatch); these
// exist so the app never SENDS one.

import type { CandidateRow, ChildOption, Product } from "../types";

/** ⚠ RISK 7 — what a sale sends as student_id. A shared product ALWAYS sends
 *  null, never the selected child; a one-child product sends the child (or null
 *  when none is chosen yet, which the form refuses before sending). */
export function saleStudentFor(
  product: Pick<Product, "single_child"> | undefined,
  childId: string
): string | null {
  if (!product?.single_child) return null;
  return childId || null;
}

/** The child a one-child sale is for when the family has exactly ONE active
 *  child at this business (D7: shown, not asked); otherwise "" (ask). */
export function autoChildFor(children: ChildOption[]): string {
  return children.length === 1 ? children[0].id : "";
}

/** ⚠ RISK 4 — a renewal row's identity: one family row, plus one per child. */
export function candidateKey(row: Pick<CandidateRow, "parent_id" | "student_id">): string {
  return `${row.parent_id}:${row.student_id ?? "family"}`;
}

/** ⚠ RISK 4 — which products a renewal row may offer (D11: one kind per
 *  family). A family row offers shared products; a child's row offers one-child
 *  products. */
export function productFitsRow(
  row: Pick<CandidateRow, "student_id">,
  product: Pick<Product, "single_child">
): boolean {
  return row.student_id ? product.single_child : !product.single_child;
}

/** ⚠ RISK 4 — what an offer sends as p_student_id: the row's child for a
 *  one-child product on a child row; null for a shared product. A one-child
 *  product on a family row is never offered (productFitsRow) — null is the
 *  honest answer, and the database refuses it. */
export function offerStudentFor(
  row: Pick<CandidateRow, "student_id">,
  product: Pick<Product, "single_child"> | undefined
): string | null {
  if (!product?.single_child) return null;
  return row.student_id ?? null;
}
