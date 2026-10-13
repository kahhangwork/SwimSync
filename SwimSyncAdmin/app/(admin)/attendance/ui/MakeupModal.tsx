import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { formatSgDate } from "@/lib/lessonDates";
import type { AttendanceRow, MakeupClass } from "../types";

type Props = {
  makeupRow: AttendanceRow | null;
  makeupHosts: MakeupClass[];
  mkHost: string;
  mkDate: string;
  mkBusy: boolean;
  mkError: string | null;
  onClose: () => void;
  onHost: (id: string) => void;
  onDate: (d: string) => void;
  datesFor: (classId: string) => string[];
  onBook: () => void;
};

export function MakeupModal({
  makeupRow,
  makeupHosts,
  mkHost,
  mkDate,
  mkBusy,
  mkError,
  onClose,
  onHost,
  onDate,
  datesFor,
  onBook,
}: Props) {
  return (
    <Modal title="Book a make-up" open={makeupRow !== null} onClose={onClose}>
      {makeupRow && (
        <div className="space-y-4">
          <p className="text-body text-ink-secondary">
            Make up <strong>{makeupRow.student_name}</strong>&apos;s missed{" "}
            <strong>{makeupRow.class_title}</strong> lesson on{" "}
            {formatSgDate(makeupRow.session_date)} by guesting them into another
            class of the same kind.
          </p>

          <label className="block">
            <span className="text-label font-semibold text-ink-secondary">Host class</span>
            <select
              value={mkHost}
              onChange={(e) => {
                onHost(e.target.value);
                onDate("");
              }}
              className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body"
            >
              <option value="">Choose a class…</option>
              {makeupHosts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            {makeupHosts.length === 0 && (
              <span className="mt-1 block text-label text-status-warning-text">
                No other class of this kind to host the make-up. Create one, or
                book it from the Makeups page.
              </span>
            )}
          </label>

          <label className="block">
            <span className="text-label font-semibold text-ink-secondary">Lesson</span>
            <select
              value={mkDate}
              onChange={(e) => onDate(e.target.value)}
              disabled={!mkHost}
              className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body disabled:bg-ground"
            >
              <option value="">{mkHost ? "Choose a date…" : "Choose a class first"}</option>
              {datesFor(mkHost).map((d) => (
                <option key={d} value={d}>
                  {formatSgDate(d)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-label text-ink-muted">
              Only the days the host class actually runs.
            </span>
          </label>

          {mkError && (
            <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-label text-status-danger-text">
              {mkError}
            </p>
          )}

          <Button className="w-full" disabled={mkBusy || !mkHost || !mkDate} onClick={onBook}>
            {mkBusy ? "Booking…" : "Book the make-up"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
