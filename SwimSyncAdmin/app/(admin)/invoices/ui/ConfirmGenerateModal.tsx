"use client";

import { formatSgDate } from "@/lib/lessonDates";
import type { ClassCoverage } from "@/lib/classCoverage";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { formatBillingMonth } from "../domain/invoiceRows";

/** Confirm attendance before generating. Runs the client-side coverage
 *  pre-flight; the engine still re-checks and is the authority. */
export function ConfirmGenerateModal({
  open,
  genMonth,
  checkingCoverage,
  coverageError,
  coverage,
  hasGaps,
  onClose,
  onConfirm,
}: {
  open: boolean;
  genMonth: string;
  checkingCoverage: boolean;
  coverageError: string | null;
  coverage: ClassCoverage[] | null;
  hasGaps: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title={`Generate invoices for ${formatBillingMonth(genMonth)}?`}
      open={open}
      onClose={onClose}
    >
      <div className="space-y-4">
        {checkingCoverage && (
          <p className="text-body text-ink-muted">Checking attendance…</p>
        )}

        {coverageError && (
          <div className="rounded-card border border-status-warning-border bg-status-warning-bg px-3 py-2.5">
            <p className="text-body font-semibold text-status-warning-text">
              Couldn&apos;t check attendance.
            </p>
            <p className="mt-1 text-label text-ink-secondary">
              {coverageError}. Generating now is still possible, but nothing has
              verified that every lesson is marked — check the coach&apos;s app,
              or retry.
            </p>
          </div>
        )}

        {coverage && hasGaps && (
          <div className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2.5">
            <p className="text-body font-semibold text-status-danger-text">
              Cannot generate — some lessons have no attendance marked.
            </p>
            <p className="mt-1 text-label text-ink-secondary">
              Mark these lessons in the coach&apos;s app — or mark them
              cancelled if the lesson didn&apos;t run — then try again. A
              lesson marked <em>after</em> an invoice exists can never be
              added to it, so billing around it would lose that money for
              good.
            </p>
            <ul className="mt-2 space-y-1.5">
              {coverage
                .filter((c) => c.missingDates.length > 0)
                .map((c) => (
                  <li key={c.classId} className="text-label text-ink-secondary">
                    <span className="font-semibold">{c.title}</span> —{" "}
                    {c.marked} of {c.expected} lessons marked
                    <span className="block text-status-danger-text">
                      Missing: {c.missingDates.map((d) => formatSgDate(d)).join(", ")}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {coverage && !hasGaps && coverage.length > 0 && (
          <p className="rounded-card border border-status-success-border bg-status-success-bg px-3 py-2.5 text-body text-status-success-text">
            All {coverage.length} class{coverage.length === 1 ? "" : "es"} fully
            marked for {formatBillingMonth(genMonth)}.
          </p>
        )}

        {coverage && coverage.length === 0 && (
          <p className="text-body text-ink-secondary">
            No classes with enrolled students to check for{" "}
            {formatBillingMonth(genMonth)}.
          </p>
        )}

        <p className="rounded-card border border-border bg-ground px-3 py-2 text-label text-ink-secondary">
          Invoices are based on the attendance recorded now. Parents who already
          have an invoice for this month are skipped.
        </p>

        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          {/* No "Generate anyway". A lesson that genuinely didn't run is
              marked cancelled (non-billable), which clears the gap — so
              there is no legitimate case that needs a bypass, and the
              server refuses regardless. */}
          <Button
            className="flex-1"
            disabled={checkingCoverage || hasGaps}
            onClick={onConfirm}
          >
            Yes, generate
          </Button>
        </div>
      </div>
    </Modal>
  );
}
