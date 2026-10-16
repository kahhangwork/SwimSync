// Set a child's gender (20261016000100). See domain/useGender for why it opens with nothing selected when none is
// recorded.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { GenderField } from "@/components/GenderField";
import type { GenderState } from "../domain/useGender";

export function GenderModal({ g }: { g: GenderState }) {
  return (
    <Modal
      title={`Gender — ${g.genderFor?.full_name ?? ""}`}
      open={g.genderFor !== null}
      onClose={g.close}
    >
      <div className="space-y-4">
        {g.genderFor && g.genderFor.gender === null && (
          <p className="text-body text-ink-secondary">No gender is recorded for this child yet.</p>
        )}
        <GenderField value={g.gender} onChange={g.setGender} />
        {g.genderError && (
          <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-label text-status-danger-text">
            {g.genderError}
          </p>
        )}
        <Button className="w-full" disabled={g.genderBusy || !g.gender} onClick={g.handleSaveGender}>
          {g.genderBusy ? "Saving…" : "Save gender"}
        </Button>
      </div>
    </Modal>
  );
}
