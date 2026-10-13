import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { StartsOnField } from "@/components/StartsOnField";
import { formatSgDate } from "@/lib/lessonDates";
import type { ChangeStartState } from "../domain/useChangeStart";

const DAY = { day: "numeric", month: "short" } as const;

// Change when a child started in a class. Rules live in set_enrolment_start;
// this shows the date, the warnings, and — for a LATER start — exactly which
// lessons stop being expected (RISK 6).
export function ChangeStartModal({ c }: { c: ChangeStartState }) {
  const t = c.target;
  return (
    <Modal title="Change start date" open={t !== null} onClose={c.close}>
      {t && (
        <div className="space-y-4">
          <p className="text-body text-ink-secondary">
            <strong>{t.fullName}</strong> in <strong>{t.classTitle}</strong> — currently from{" "}
            {formatSgDate(c.current, { ...DAY, year: "numeric" })}.
          </p>
          <StartsOnField start={c.start} childName={t.fullName} label="New start date" saveLabel="Save" />
          {c.dropped.length > 0 && (
            <p
              data-testid="dropped-dates"
              className="rounded-card border border-status-warning-border bg-status-warning-bg px-3 py-2 text-label text-status-warning-text"
            >
              {t.fullName} will no longer be expected on:{" "}
              {c.dropped.map((d) => formatSgDate(d, DAY)).join(", ")}. If they missed these, mark
              them absent or cancelled instead.
            </p>
          )}
          {c.error && (
            <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">
              {c.error}
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={c.close}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={c.busy || c.start.value === c.current}
              onClick={c.save}
            >
              {c.busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
