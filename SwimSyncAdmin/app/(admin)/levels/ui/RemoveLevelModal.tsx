import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { describeLevelRemoval } from "@/lib/studentCounts";
import type { LevelsState } from "../domain/useLevels";

export function RemoveLevelModal(p: { l: LevelsState }) {
  return (
    <Modal
      open={p.l.removing !== null}
      onClose={() => p.l.setRemoving(null)}
      title="Remove this level?"
    >
      <p className="text-sm text-gray-600">
        {/* Counts EVERYONE, not just the active — see Level.inactive_count. */}
        {p.l.removing
          ? describeLevelRemoval(p.l.removing.student_count, p.l.removing.inactive_count)
          : null}
      </p>
      {p.l.removeError && <p className="mt-3 text-sm text-red-600">{p.l.removeError}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => p.l.setRemoving(null)} disabled={p.l.busy}>
          Cancel
        </Button>
        <Button onClick={() => p.l.removing && p.l.remove(p.l.removing)} disabled={p.l.busy} variant="danger">
          {p.l.busy ? "Removing…" : "Remove"}
        </Button>
      </div>
    </Modal>
  );
}
