// Slice 2 — the merge confirmation, the one action that repoints a child's
// records. Stage 6 of docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup
// verbatim from page.tsx.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import type { MergeState } from "../domain/useMerge";

export function MergeModal({ merge }: { merge: MergeState }) {
  const { merging } = merge;
  return (
    <Modal open={merging !== null} onClose={merge.close} title="Merge these two records?">
      {merging && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Kept
            </p>
            <p className="mt-1 font-medium text-gray-900">
              {merging.survivor.full_name}
            </p>
            <p className="text-sm text-gray-500">
              {merging.survivor.lessons} lesson
              {merging.survivor.lessons === 1 ? "" : "s"} recorded
              {merging.survivor.date_of_birth
                ? ` · born ${merging.survivor.date_of_birth}`
                : " · no date of birth"}
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Deleted
            </p>
            <p className="mt-1 font-medium text-gray-900">
              {merging.duplicate.full_name}
            </p>
            <p className="text-sm text-gray-500">
              {merging.duplicate.lessons} lesson
              {merging.duplicate.lessons === 1 ? "" : "s"} recorded
              {merging.duplicate.date_of_birth
                ? ` · born ${merging.duplicate.date_of_birth}`
                : " · no date of birth"}
            </p>
          </div>

          <p className="text-sm text-gray-600">
            The parent account, any trial bookings and any settlements move
            across to the record being kept, along with a date of birth or
            gender it is missing. Nothing already recorded on the kept record
            is overwritten. This cannot be undone.
          </p>

          {merging.eitherWay && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Neither record has any lessons, so it does not matter much which
              survives — but check the spelling of the name you are keeping.
            </p>
          )}

          {merge.mergeError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {merge.mergeError}
            </p>
          )}

          <div className="flex gap-2">
            <Button disabled={merge.mergeBusy} onClick={() => merge.doMerge(merging)}>
              {merge.mergeBusy ? "Merging…" : "Merge them"}
            </Button>
            <Button variant="outline" onClick={merge.close}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
