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
          <div className="rounded-card border border-border p-3">
            <p className="text-label font-semibold uppercase tracking-wide text-ink-muted">
              Kept
            </p>
            <p className="mt-1 font-medium text-ink">
              {merging.survivor.full_name}
            </p>
            <p className="text-body text-ink-muted">
              {merging.survivor.lessons} lesson
              {merging.survivor.lessons === 1 ? "" : "s"} recorded
              {merging.survivor.date_of_birth
                ? ` · born ${merging.survivor.date_of_birth}`
                : " · no date of birth"}
            </p>
          </div>

          <div className="rounded-card border border-border p-3">
            <p className="text-label font-semibold uppercase tracking-wide text-ink-muted">
              Deleted
            </p>
            <p className="mt-1 font-medium text-ink">
              {merging.duplicate.full_name}
            </p>
            <p className="text-body text-ink-muted">
              {merging.duplicate.lessons} lesson
              {merging.duplicate.lessons === 1 ? "" : "s"} recorded
              {merging.duplicate.date_of_birth
                ? ` · born ${merging.duplicate.date_of_birth}`
                : " · no date of birth"}
            </p>
          </div>

          <p className="text-body text-ink-secondary">
            The parent account, any trial bookings and any settlements move
            across to the record being kept, along with a date of birth or
            gender it is missing. Nothing already recorded on the kept record
            is overwritten. This cannot be undone.
          </p>

          {merging.eitherWay && (
            <p className="rounded-card bg-status-warning-bg px-3 py-2 text-label text-status-warning-text">
              Neither record has any lessons, so it does not matter much which
              survives — but check the spelling of the name you are keeping.
            </p>
          )}

          {merge.mergeError && (
            <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">
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
