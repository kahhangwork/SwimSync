// "Change child" dialog (single-child packages, D4). State and the RPC call come
// from useChangeChild; the database's refusal renders inline (⚠ RISK 10).

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import type { ChangeChildForm } from "../domain/useChangeChild";

export function ChangeChildModal({ form, busy }: { form: ChangeChildForm; busy: boolean }) {
  const { target, options, childId, setChildId, changeError, closeChangeChild, saveChangeChild } = form;

  return (
    <Modal open={target !== null} onClose={closeChangeChild} title="Change child">
      {target && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {target.name} ({target.reference_number ?? "no reference"}) is for{" "}
            <strong>{target.student_name ?? "one child"}</strong>. Move it to another of{" "}
            {target.parent_name}&rsquo;s children — only while no lesson has drawn from it.
          </p>
          {options.length === 0 ? (
            <p className="text-sm text-gray-500">
              This family has no other active child at your business.
            </p>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">New child</label>
              <select
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Choose…</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {changeError && (
            <p className="text-sm text-red-600" role="alert">
              {changeError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeChangeChild} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveChangeChild} disabled={busy || !childId}>
              {busy ? "Saving…" : "Change child"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
