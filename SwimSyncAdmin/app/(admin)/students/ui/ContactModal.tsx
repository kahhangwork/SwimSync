// Slice 8a — the parent contact details modal. Stage 8 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.
// Two modes off ONE fresh read — see useContact. Editable while the child is
// unclaimed, read-only once a parent holds the account.

import Link from "next/link";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { ContactHint } from "@/components/ContactHint";
import { checkSgPhone, checkEmail } from "@/lib/sgPhone";
import type { ContactState } from "../domain/useContact";

export function ContactModal({ contact: c }: { contact: ContactState }) {
  return (
    <Modal
      // Not "…'s parent": a child can have two, and the claimed branch shows
      // every one of them.
      title={`${c.contactFor?.full_name ?? ""} — parent contact details`}
      open={c.contactFor !== null}
      onClose={c.close}
    >
      {c.contactLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : c.contactLoadFailed ? (
        // The error and NOTHING ELSE — see contactLoadFailed. An empty form
        // here is a loaded gun pointed at real contact details.
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {c.contactError}
        </p>
      ) : c.contactClaimed ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This family has a SwimSync account, so these are their own
            details. They keep them up to date in the app, under{" "}
            <span className="font-medium text-gray-700">
              Profile → Contact Details
            </span>{" "}
            — ask them to change it there and it updates everywhere.
          </p>
          {c.contactParents.map((parent, i) => (
            <div key={i}>
              {c.contactParents.length > 1 && (
                <p className="mb-1 text-xs font-semibold text-gray-500">
                  Parent {i + 1} of {c.contactParents.length}
                </p>
              )}
              <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {[
                  ["Name", parent.full_name],
                  ["Email", parent.email],
                  ["Phone", parent.phone],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-3 px-3 py-2 text-sm">
                    <dt className="w-16 shrink-0 font-medium text-gray-500">
                      {label}
                    </dt>
                    <dd className="text-gray-900">
                      {value || (
                        <span className="text-gray-400">
                          Not provided — the parent can add it in the app
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {c.pendingClaims > 0
              ? // "Nobody has claimed this child yet" is true of the JOIN
                // TABLE and false to a reader looking at a pending request —
                // the two sentences contradicted each other on screen.
                "These are the details taken when this child was added. They are what the parent below was matched on."
              : "Nobody has claimed this child yet, so these are the details taken when they were added. The phone and email are what match this child to their parent's account when the family registers."}
          </p>

          {c.pendingClaims > 0 ? (
            // ⚠ REFUSED, NOT WARNED. See useContact — the Claims queue
            // shows a SNAPSHOT of why the candidate was offered, so editing
            // these underneath it makes the admin approve on a reason that is
            // no longer true. Do NOT add a bypass, and do NOT "fix" this by
            // rewriting student_claims.match_reason: it is a record of a past
            // act, not a live lookup (§6).
            <div className="space-y-3">
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {c.pendingClaims === 1
                  ? "A parent is currently claiming this child, so these details are locked."
                  : `${c.pendingClaims} parents are currently claiming this child, so these details are locked.`}{" "}
                The claim was raised against the details below — changing them
                now would leave the decision resting on a reason that is no
                longer true. Settle it on{" "}
                <Link
                  href="/claims"
                  className="font-semibold underline hover:text-amber-900"
                >
                  Parent claims
                </Link>{" "}
                first.
              </p>
              <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {[
                  ["Name", c.contactName],
                  ["Phone", c.contactPhone],
                  ["Email", c.contactEmail],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-3 px-3 py-2 text-sm">
                    <dt className="w-16 shrink-0 font-medium text-gray-500">
                      {label}
                    </dt>
                    <dd className="text-gray-900">
                      {value || <span className="text-gray-400">—</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="text-xs font-semibold text-gray-600">
                  Parent&apos;s name
                </span>
                <input
                  value={c.contactName}
                  onChange={(e) => c.setContactName(e.target.value)}
                  placeholder="Sarah Lim"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  Who the number belongs to — a parent, a grandparent, a
                  helper.
                </p>
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-gray-600">
                  Parent&apos;s phone
                </span>
                <input
                  value={c.contactPhone}
                  onChange={(e) => c.setContactPhone(e.target.value)}
                  placeholder="9123 4567"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <ContactHint check={checkSgPhone(c.contactPhone)} />
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-gray-600">
                  Parent&apos;s email
                </span>
                <input
                  value={c.contactEmail}
                  onChange={(e) => c.setContactEmail(e.target.value)}
                  placeholder="sarah@example.com"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <ContactHint check={checkEmail(c.contactEmail)} />
              </label>

              {c.contactError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {c.contactError}
                </p>
              )}

              {/* Disabled ONLY while the write is in flight. The hints above
                  never gate this — see ContactHint. */}
              <Button
                className="w-full"
                disabled={c.contactBusy}
                onClick={c.handleSaveContact}
              >
                {c.contactBusy ? "Saving…" : "Save contact details"}
              </Button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
