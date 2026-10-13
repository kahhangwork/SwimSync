import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

type Props = {
  open: boolean;
  newDate: string;
  newName: string;
  formError: string | null;
  busy: boolean;
  onClose: () => void;
  onDate: (v: string) => void;
  onName: (v: string) => void;
  onAdd: () => void;
};

export function AddHolidayModal({ open, newDate, newName, formError, busy, onClose, onDate, onName, onAdd }: Props) {
  return (
    <Modal title="Add a holiday" open={open} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-body font-medium text-ink-secondary">Date</label>
          <input
            type="date"
            value={newDate}
            onChange={(e) => onDate(e.target.value)}
            className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
          />
        </div>
        <div>
          <label className="mb-1 block text-body font-medium text-ink-secondary">Name</label>
          <input
            value={newName}
            onChange={(e) => onName(e.target.value)}
            placeholder="Chinese New Year"
            className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
          />
        </div>
        {formError && <p className="text-body text-status-danger-text">{formError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onAdd} disabled={busy}>
            {busy ? "Adding…" : "Add holiday"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
