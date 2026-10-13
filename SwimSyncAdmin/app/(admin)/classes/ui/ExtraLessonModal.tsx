import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Field } from "./Field";
import { capitalize } from "../domain/classRows";
import type { ClassRow } from "../types";

export function ExtraLessonModal({
  extraFor,
  onClose,
  extraDate,
  onExtraDate,
  extraReason,
  onExtraReason,
  extraSaving,
  extraError,
  extraDone,
  onSchedule,
}: {
  extraFor: ClassRow | null;
  onClose: () => void;
  extraDate: string;
  onExtraDate: (v: string) => void;
  extraReason: string;
  onExtraReason: (v: string) => void;
  extraSaving: boolean;
  extraError: string | null;
  extraDone: string | null;
  onSchedule: () => void;
}) {
  return (
    <Modal
      title={extraFor ? `Extra lesson — ${extraFor.title}` : "Extra lesson"}
      open={extraFor !== null}
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-body text-ink-muted">
          A lesson on a day this class does not normally run — a makeup, or a
          public-holiday shift.{" "}
          <span className="text-ink-secondary">
            {extraFor ? capitalize(extraFor.day_of_week) : ""} lessons need no
            scheduling
          </span>
          ; the coach marks those as usual.
        </p>

        <Field
          label="Date"
          placeholder=""
          value={extraDate}
          onChange={onExtraDate}
          type="date"
        />

        <Field
          label="Reason"
          value={extraReason}
          onChange={onExtraReason}
          placeholder="e.g. Makeup for the National Day holiday"
        />
        <p className="-mt-2 text-label text-ink-muted">
          The coach sees this on their class, so they know why the lesson is
          there.
        </p>

        {extraError && (
          <p className="rounded-card bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">
            {extraError}
          </p>
        )}

        {extraDone && (
          <p className="rounded-card bg-status-success-bg px-3 py-2 text-body text-status-success-text">
            Scheduled for {extraDone}. It now appears on the coach&apos;s class,
            and the month will not close until they have marked it.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="rounded-card px-4 py-2 text-body font-medium text-ink-secondary hover:bg-ground"
          >
            Close
          </button>
          <Button
            onClick={onSchedule}
            disabled={extraSaving || !extraDate || !extraReason.trim()}
          >
            {extraSaving ? "Scheduling…" : "Schedule lesson"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
