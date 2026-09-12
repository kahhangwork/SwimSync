// Slice 7 — the Add-a-student form. Stage 7 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.
//
// For a child already attending weekly. A TRIAL is the coach's job — it marks
// attendance on the spot, and back-dating a missed one already works from the
// attendance screen — so this form deliberately offers only the ongoing shape.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { ContactHint } from "@/components/ContactHint";
import { checkSgPhone, checkEmail } from "@/lib/sgPhone";
import type { AddStudentState } from "../domain/useAddStudent";
import {
  describeCandidate,
  partitionCandidates,
  type RosterCandidate,
} from "../domain/rosterDuplicates";

export function AddStudentModal(p: {
  add: AddStudentState;
  classOptions: { id: string; title: string }[];
}) {
  const { add } = p;
  return (
    <Modal title="Add a student" open={add.addOpen} onClose={add.close}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          For a child who is already attending but whose parent hasn&apos;t
          signed up yet. They&apos;ll appear on the coach&apos;s roster
          straight away; invite the parent whenever they&apos;re ready and
          everything already marked becomes theirs.
        </p>

        <label className="block">
          <span className="text-xs font-semibold text-gray-600">
            Child&apos;s full name
          </span>
          <input
            value={add.addName}
            onChange={(e) => add.setAddName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Class</span>
          <select
            value={add.addClassId}
            onChange={(e) => add.setAddClassId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Choose a class…</option>
            {p.classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-gray-600">
            Date of birth <span className="font-normal">(optional)</span>
          </span>
          <input
            type="date"
            value={add.addDob}
            onChange={(e) => add.setAddDob(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              Parent&apos;s phone <span className="text-red-500">*</span>
            </span>
            <input
              value={add.addPhone}
              onChange={(e) => add.setAddPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {/* Advisory. The phone stays REQUIRED (the Add button below is
                disabled without one); its shape never gates submit. */}
            <ContactHint check={checkSgPhone(add.addPhone)} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              Parent&apos;s email <span className="font-normal">(optional)</span>
            </span>
            <input
              type="email"
              value={add.addEmail}
              onChange={(e) => add.setAddEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <ContactHint check={checkEmail(add.addEmail)} />
          </label>
        </div>
        <p className="-mt-1 text-[11px] text-gray-400">
          Both optional, and both save you work later — the email is what the
          invite goes to.
        </p>

        {add.addError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {add.addError}
          </p>
        )}

        {/* ⚠ RISK 1/3: possible duplicates. Phone hits (strong) are shown
            first and separately from same-name hits (weak), so a name
            coincidence never reads as equal evidence to a phone match. The
            admin can still proceed — "Add anyway" — because a phone match may
            be a sibling, not a duplicate. */}
        {add.addDupCandidates.length > 0 &&
          (() => {
            const { strong, weak } = partitionCandidates(add.addDupCandidates);
            const Row = (c: RosterCandidate) => (
              <li key={c.student_id}>
                <span className="font-medium">{c.full_name}</span>{" "}
                <span className="text-amber-700">— {describeCandidate(c)}</span>
              </li>
            );
            return (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p className="font-semibold">
                  This may already be on your roster
                </p>
                {strong.length > 0 && (
                  <>
                    <p className="mt-1 text-[11px] text-amber-700">
                      Same phone number:
                    </p>
                    <ul className="ml-4 list-disc">{strong.map(Row)}</ul>
                  </>
                )}
                {weak.length > 0 && (
                  <>
                    <p className="mt-1 text-[11px] text-amber-700">
                      Same name:
                    </p>
                    <ul className="ml-4 list-disc">{weak.map(Row)}</ul>
                  </>
                )}
                <p className="mt-2 text-[11px]">
                  If this is a new child (a sibling can share a phone), add
                  them anyway. If it is the same child, close this and find
                  them on the roster instead.
                </p>
              </div>
            );
          })()}

        <Button
          className="w-full"
          // Phone required for the same reason as a trial booking: it is the
          // only signal that survives how a name gets written.
          disabled={
            add.addBusy || !add.addName.trim() || !add.addClassId || !add.addPhone.trim()
          }
          onClick={add.handleAddStudent}
        >
          {add.addBusy
            ? "Adding…"
            : add.addConfirmed && add.addDupCandidates.length > 0
              ? "Add anyway"
              : "Add student"}
        </Button>
      </div>
    </Modal>
  );
}
