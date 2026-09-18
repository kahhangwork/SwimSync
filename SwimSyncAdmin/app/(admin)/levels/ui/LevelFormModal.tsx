import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { LevelsState } from "../domain/useLevels";

export function LevelFormModal(p: { l: LevelsState }) {
  return (
    <Modal
      open={p.l.creating || p.l.editing !== null}
      onClose={p.l.close}
      title={p.l.editing ? "Edit level" : "Add level"}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Level name
          </label>
          <input
            value={p.l.label}
            onChange={(e) => p.l.setLabel(e.target.value)}
            placeholder="Seahorse"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Order
          </label>
          <input
            value={p.l.sortOrder}
            onChange={(e) => p.l.setSortOrder(e.target.value)}
            inputMode="numeric"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Lowest first. This is what stops the ladder sorting alphabetically,
            which would put &ldquo;Advanced&rdquo; above &ldquo;Beginner&rdquo;.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Note <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            value={p.l.note}
            onChange={(e) => p.l.setNote(e.target.value)}
            placeholder="Progress to B3 upon completing T4"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            For anything about the level that isn&rsquo;t a skill — usually a
            progression rule. Skills go in the list on the previous screen.
          </p>
        </div>

        {p.l.error && <p className="text-sm text-red-600">{p.l.error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={p.l.close} disabled={p.l.busy}>
            Cancel
          </Button>
          <Button onClick={p.l.save} disabled={p.l.busy}>
            {p.l.busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
