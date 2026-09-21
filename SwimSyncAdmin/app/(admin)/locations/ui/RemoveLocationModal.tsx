import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { Location } from "../types";

type Props = {
  removing: Location | null;
  setRemoving: (l: Location | null) => void;
  busy: boolean;
  remove: (l: Location) => void;
};

export function RemoveLocationModal({
  removing,
  setRemoving,
  busy,
  remove,
}: Props) {
  return (
    <Modal
      open={removing !== null}
      onClose={() => setRemoving(null)}
      title="Remove this location?"
    >
      <p className="text-sm text-gray-600">
        {removing && removing.active_class_count > 0 ? (
          <>
            &ldquo;{removing.name}&rdquo; is used by{" "}
            <strong>
              {removing.active_class_count} active class
              {removing.active_class_count === 1 ? "" : "es"}
            </strong>
            . Move or retire those classes first, then remove it.
          </>
        ) : removing && removing.retired_class_count > 0 ? (
          <>
            &ldquo;{removing.name}&rdquo; will be removed from your list and every
            picker. The {removing.retired_class_count} retired class
            {removing.retired_class_count === 1 ? "" : "es"} still held here keep
            it for their records. You can reuse the name afterwards.
          </>
        ) : (
          <>
            &ldquo;{removing?.name}&rdquo; will be removed from your list and every
            picker. You can reuse the name afterwards.
          </>
        )}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
          Cancel
        </Button>
        <Button
          onClick={() => removing && remove(removing)}
          disabled={busy || (removing?.active_class_count ?? 0) > 0}
          variant="danger"
        >
          {busy ? "Removing…" : "Remove"}
        </Button>
      </div>
    </Modal>
  );
}
