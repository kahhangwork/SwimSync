import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { Location } from "../types";

type Props = {
  open: boolean;
  editing: Location | null;
  close: () => void;
  name: string;
  setName: (v: string) => void;
  address: string;
  setAddress: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  sortOrder: string;
  setSortOrder: (v: string) => void;
  error: string | null;
  busy: boolean;
  save: () => void;
};

export function LocationFormModal({
  open,
  editing,
  close,
  name,
  setName,
  address,
  setAddress,
  notes,
  setNotes,
  sortOrder,
  setSortOrder,
  error,
  busy,
  save,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={close}
      title={editing ? "Edit location" : "Add location"}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Location name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bishan Swimming Complex"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Address <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="1 Bishan Street 14, Singapore 579767"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Shown to parents so they know where to go.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Notes <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Park at Basement 2; enter via the side gate"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Order
          </label>
          <input
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            inputMode="numeric"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Lowest first — the order locations appear in every dropdown.
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
