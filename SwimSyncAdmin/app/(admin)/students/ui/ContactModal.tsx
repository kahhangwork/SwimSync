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
        <p className="text-body text-ink-muted">Loading…</p>
      ) : c.contactLoadFailed ? (
        // The error and NOTHING ELSE — see contactLoadFailed. An empty form
        // here is a loaded gun pointed at real contact details.
        <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">
          {c.contactError}
        </p>
      ) : c.contactClaimed ? (
        <div className="space-y-4">
          <p className="text-body text-ink-secondary">
            This family has a SwimSync account, so these are their own
            details. They keep them up to date in the app, under{" "}
            <span className="font-medium text-ink-secondary">
              Profile → Contact Details
            </span>{" "}
            — ask them to change it there and it updates everywhere.
          </p>
          {c.contactParents.map((parent, i) => (
            <div key={i}>
              {c.contactParents.length > 1 && (
                <p className="mb-1 text-label font-semibold text-ink-muted">
                  Parent {i + 1} of {c.contactParents.length}
                </p>
              )}
              <dl className="divide-y divide-divider rounded-control border border-border">
                {[
                  ["Name", parent.full_name],
                  ["Email", parent.email],
                  ["Phone", parent.phone],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-3 px-3 py-2 text-body">
                    <dt className="w-16 shrink-0 font-medium text-ink-muted">
                      {label}
                    </dt>
                    <dd className="text-ink">
                      {value || (
                        <span className="text-ink-muted">
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
          <p className="text-body text-ink-secondary">
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
              <p className="rounded-card border border-status-warning-border bg-status-warning-bg px-3 py-2 text-label text-status-warning-text">
                {c.pendingClaims === 1
                  ? "A parent is currently claiming this child, so these details are locked."
                  : `${c.pendingClaims} parents are currently claiming this child, so these details are locked.`}{" "}
                The claim was raised against the details below — changing them
                now would leave the decision resting on a reason that is no
                longer true. Settle it on{" "}
                <Link
                  href="/claims"
                  className="font-semibold underline hover:text-status-warning-text"
                >
                  Parent claims
                </Link>{" "}
                first.
              </p>
              <dl className="divide-y divide-divider rounded-control border border-border">
                {[
                  ["Name", c.contactName],
                  ["Phone", c.contactPhone],
                  ["Email", c.contactEmail],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-3 px-3 py-2 text-body">
                    <dt className="w-16 shrink-0 font-medium text-ink-muted">
                      {label}
                    </dt>
                    <dd className="text-ink">
                      {value || <span className="text-ink-muted">—</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="text-label font-semibold text-ink-secondary">
                  Parent&apos;s name
                </span>
                <input
                  value={c.contactName}
                  onChange={(e) => c.setContactName(e.target.value)}
                  placeholder="Sarah Lim"
                  className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body"
                />
                <p className="mt-1 text-label text-ink-muted">
                  Who the number belongs to — a parent, a grandparent, a
                  helper.
                </p>
              </label>

              <label className="block">
                <span className="text-label font-semibold text-ink-secondary">
                  Parent&apos;s phone
                </span>
                <input
                  value={c.contactPhone}
                  onChange={(e) => c.setContactPhone(e.target.value)}
                  placeholder="9123 4567"
                  className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body"
                />
                <ContactHint check={checkSgPhone(c.contactPhone)} />
              </label>

              <label className="block">
                <span className="text-label font-semibold text-ink-secondary">
                  Parent&apos;s email
                </span>
                <input
                  value={c.contactEmail}
                  onChange={(e) => c.setContactEmail(e.target.value)}
                  placeholder="sarah@example.com"
                  className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body"
                />
                <ContactHint check={checkEmail(c.contactEmail)} />
              </label>

              {c.contactError && (
                <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-label text-status-danger-text">
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
