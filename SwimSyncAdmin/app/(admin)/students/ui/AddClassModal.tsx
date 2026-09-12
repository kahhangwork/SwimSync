// Slice 4 — the Add-a-class modal. Stage 5 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.
//
// Deliberately thin. Every rule about WHICH classes may be combined lives in
// enforce_enrolment_schedule(), so this form does not pre-filter by weekday or
// time: a filtered list that disagreed with the trigger would be a second,
// quieter rule (§7.32 — the picker is an affordance, the trigger is the
// guard). What it does do is show the refusal verbatim, because those
// sentences name the clashing class.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import type { AddClassState } from "../domain/useAddClass";

export function AddClassModal({ addClass }: { addClass: AddClassState }) {
  const { addClassFor } = addClass;
  return (
    <Modal
      title={`Add a class for ${addClassFor?.full_name ?? ""}`}
      open={addClassFor !== null}
      onClose={addClass.close}
    >
      {addClassFor && (
        <div className="space-y-4">
          {addClassFor.classes.length > 0 && (
            <p className="text-sm text-gray-600">
              Already in{" "}
              <strong>
                {addClassFor.classes.map((c) => c.title).join(", ")}
              </strong>
              . This adds another — it does not move them.
            </p>
          )}
          <label className="block text-sm font-medium text-gray-700">
            Class
            <select
              value={addClass.addClassChoice}
              onChange={(e) => addClass.setAddClassChoice(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Choose a class…</option>
              {addClass.classOptions
                .filter(
                  (c) => !addClassFor.classes.some((ec) => ec.id === c.id)
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
          </label>
          <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            An enrolled child is expected at this class <strong>every week</strong>,
            and an unmarked lesson blocks invoicing for the whole business. For a
            one-off visit, book a make-up instead.
          </p>
          {addClass.addClassError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {addClass.addClassError}
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={addClass.close}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={addClass.addClassBusy || !addClass.addClassChoice}
              onClick={addClass.handleAddClass}
            >
              {addClass.addClassBusy ? "Adding…" : "Add class"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
