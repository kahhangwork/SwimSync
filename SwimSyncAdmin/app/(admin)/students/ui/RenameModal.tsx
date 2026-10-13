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
        <p className="text-body text-ink-secondary">
          Set this child&apos;s name — for example, replacing a coach&apos;s
          placeholder with the full name their parent provided. This changes
          the name shown across SwimSync. Invoices already issued keep the name
          they were billed under.
        </p>
        <label className="block">
          <span className="text-label font-semibold text-ink-secondary">
            Child&apos;s name
          </span>
          <input
            value={rename.renameName}
            onChange={(e) => rename.setRenameName(e.target.value)}
            placeholder="Anya Rahman"
            className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body"
          />
        </label>
        {rename.renameError && (
          <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-label text-status-danger-text">
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
