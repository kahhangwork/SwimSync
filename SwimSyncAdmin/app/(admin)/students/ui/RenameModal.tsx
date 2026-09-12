// Slice 3 — the Rename modal. Stage 5 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.
// Not frozen under a pending claim — see useRename's note.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import type { RenameState } from "../domain/useRename";

export function RenameModal({ rename }: { rename: RenameState }) {
  return (
    <Modal
      title={`Rename ${rename.renameFor?.full_name ?? ""}`}
      open={rename.renameFor !== null}
      onClose={rename.close}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Set this child&apos;s name — for example, replacing a coach&apos;s
          placeholder with the full name their parent provided. This changes
          the name shown across SwimSync. Invoices already issued keep the name
          they were billed under.
        </p>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">
            Child&apos;s name
          </span>
          <input
            value={rename.renameName}
            onChange={(e) => rename.setRenameName(e.target.value)}
            placeholder="Anya Rahman"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        {rename.renameError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {rename.renameError}
          </p>
        )}
        <Button className="w-full" disabled={rename.renameBusy} onClick={rename.handleRename}>
          {rename.renameBusy ? "Saving…" : "Save name"}
        </Button>
      </div>
    </Modal>
  );
}
