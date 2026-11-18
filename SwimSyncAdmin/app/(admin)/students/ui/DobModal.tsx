// Set or clear a child's date of birth (20261118000100). See domain/useDob.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { todayInSg } from "@/lib/lessonDates";
import type { DobState } from "../domain/useDob";

export function DobModal({ d }: { d: DobState }) {
  return (
    <Modal
      title={`Date of birth — ${d.dobFor?.full_name ?? ""}`}
      open={d.dobFor !== null}
      onClose={d.close}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="text-label font-semibold text-ink-secondary">Date of birth</span>
          <input
            type="date"
            value={d.dob}
            max={todayInSg()}
            onChange={(e) => d.setDob(e.target.value)}
            className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body"
          />
          <p className="mt-1 text-label text-ink-muted">Leave it empty to clear a date that was entered by mistake.</p>
        </label>
        {d.dobError && (
          <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-label text-status-danger-text">
            {d.dobError}
          </p>
        )}
        <Button className="w-full" disabled={d.dobBusy} onClick={d.handleSaveDob}>
          {d.dobBusy ? "Saving…" : "Save date of birth"}
        </Button>
      </div>
    </Modal>
  );
}
