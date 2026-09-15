// "Extend {package}" modal (slice 7). Stage 7 of PACKAGES_REFACTOR_PLAN.md —
// markup verbatim; state/handlers come as one `form` prop (useExtend).

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import type { ExtendForm } from "../domain/useExtend";

export function ExtendModal({ form, busy }: { form: ExtendForm; busy: boolean }) {
  const {
    extending,
    setExtending,
    extendWeeks,
    setExtendWeeks,
    extendReason,
    setExtendReason,
    extendError,
    submitExtend,
  } = form;

  return (
    <Modal
      open={extending !== null}
      onClose={() => setExtending(null)}
      title={`Extend ${extending?.name ?? "package"}`}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          A discretionary extension for{" "}
          <strong>{extending?.parent_name}</strong>, added on top of any
          public-holiday extension. Currently expires{" "}
          <strong>{extending?.expires_on ?? "—"}</strong>.
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Extra weeks
          </label>
          <input
            value={extendWeeks}
            onChange={(e) => setExtendWeeks(e.target.value)}
            inputMode="numeric"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Reason <span className="text-gray-400">(optional)</span>
          </label>
          <input
            value={extendReason}
            onChange={(e) => setExtendReason(e.target.value)}
            placeholder="Goodwill"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {extendError && <p className="text-sm text-red-600">{extendError}</p>}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setExtending(null)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={submitExtend} disabled={busy}>
            {busy ? "Extending…" : "Extend package"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
