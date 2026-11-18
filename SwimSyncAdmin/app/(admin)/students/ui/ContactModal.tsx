// Slice 8a — the parent contact details modal. Stage 8 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.
// Two modes off ONE fresh read — see useContact. Unclaimed: the details taken
// when the child was added. Claimed: each linked parent's own name + phone
// (editable, 2026-11-18), their email (read-only — it is their login), and Unlink.

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
            This family has a SwimSync account. Correcting a name or phone here
            updates the parent&apos;s own profile, so it shows everywhere they
            use SwimSync. The email is their login — only they can change it,
            in the app under{" "}
            <span className="font-medium text-ink-secondary">
              Profile → Contact Details
            </span>
            .
          </p>
          {c.contactParents.map((parent, i) => {
            const edit = c.parentEdits[parent.id] ?? { name: "", phone: "" };
            const busy = c.parentBusy === parent.id;
            const error = c.parentError?.id === parent.id ? c.parentError.message : null;
            const confirming = c.confirmUnlink === parent.id;
            return (
              <div key={parent.id} className="space-y-3 rounded-control border border-border p-3">
                {c.contactParents.length > 1 && (
                  <p className="text-label font-semibold text-ink-muted">
                    Parent {i + 1} of {c.contactParents.length}
                  </p>
                )}
                <label className="block">
                  <span className="text-label font-semibold text-ink-secondary">Name</span>
                  <input
                    value={edit.name}
                    onChange={(e) => c.setParentField(parent.id, "name", e.target.value)}
                    className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body"
                  />
                </label>
                <label className="block">
                  <span className="text-label font-semibold text-ink-secondary">Phone</span>
                  <input
                    value={edit.phone}
                    onChange={(e) => c.setParentField(parent.id, "phone", e.target.value)}
                    placeholder="9123 4567"
                    className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body"
                  />
                  <ContactHint check={checkSgPhone(edit.phone)} />
                </label>
                <div className="text-body">
                  <span className="text-label font-semibold text-ink-secondary">Email (their login)</span>
                  <p className="mt-1 text-ink">
                    {parent.email || <span className="text-ink-muted">Not provided</span>}
                  </p>
                </div>

                {error && (
                  <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-label text-status-danger-text">
                    {error}
                  </p>
                )}
                {c.parentSaved === parent.id && (
                  <p className="text-label text-status-success-text">Saved.</p>
                )}

                <Button className="w-full" disabled={c.parentBusy !== null} onClick={() => c.saveParent(parent.id)}>
                  {busy && !confirming ? "Saving…" : "Save parent details"}
                </Button>

                {/* ⚠ TWO STEPS, INLINE — never window.confirm. The server refuses
                    once this parent has been billed for this child (invoice or
                    package draw), so the worst a slip can do is an unbilled link,
                    which the family can re-claim. */}
                {confirming ? (
                  <div className="space-y-2 rounded-card border border-status-warning-border bg-status-warning-bg px-3 py-2">
                    <p className="text-label text-status-warning-text">
                      Remove {parent.full_name || "this parent"} from{" "}
                      {c.contactFor?.full_name}? They will no longer see this
                      child or be invoiced for them.
                      {c.contactParents.length === 1 &&
                        " This child will have no parent until one is linked, so their lessons will show as unclaimed when you bill."}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" disabled={busy} onClick={() => c.setConfirmUnlink(null)}>
                        Cancel
                      </Button>
                      <Button variant="danger" disabled={busy} onClick={() => c.unlinkParent(parent.id)}>
                        {busy ? "Removing…" : "Yes, unlink"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={c.parentBusy !== null}
                    onClick={() => c.setConfirmUnlink(parent.id)}
                    className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-body font-semibold text-status-danger-text hover:bg-status-danger-bg disabled:text-ink-muted"
                  >
                    Wrong parent? Unlink from this child
                  </button>
                )}
              </div>
            );
          })}
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
