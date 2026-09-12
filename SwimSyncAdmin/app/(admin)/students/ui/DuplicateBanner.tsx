// Slice 2 — the "two rows that look like the same child" banner. Stage 6 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.
//
// The claim flow stops NEW duplicates. This is for the ones already here —
// every child added before it shipped, and every child a parent created by
// answering "no, that's a different child". Without this nothing in the app
// ever mentions that a duplicate exists.

import { Button } from "@/components/Button";
import type { DupPair } from "../domain/duplicateStudents";

export function DuplicateBanner(p: { pairs: DupPair[]; onReview: (pair: DupPair) => void }) {
  if (p.pairs.length === 0) return null;
  return (
    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-800">
        {p.pairs.length === 1
          ? "Two records may be the same child"
          : `${p.pairs.length} pairs of records may be the same child`}
      </p>
      <div className="mt-2 space-y-2">
        {p.pairs.map((pair) => (
          <div
            key={`${pair.survivor.id}:${pair.duplicate.id}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
          >
            <p className="text-sm text-gray-700">
              <span className="font-medium">{pair.survivor.full_name}</span>{" "}
              ({pair.survivor.lessons} lesson
              {pair.survivor.lessons === 1 ? "" : "s"}) and{" "}
              <span className="font-medium">{pair.duplicate.full_name}</span>{" "}
              ({pair.duplicate.lessons} lesson
              {pair.duplicate.lessons === 1 ? "" : "s"})
            </p>
            {pair.needsHuman ? (
              // merge_students() refuses this outright. Say so here rather
              // than offering a button that only produces an error.
              <span className="text-xs font-medium text-red-700">
                Both have lessons recorded — sort this one out by hand
              </span>
            ) : (
              <Button variant="outline" onClick={() => p.onReview(pair)}>
                Review &amp; merge
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
