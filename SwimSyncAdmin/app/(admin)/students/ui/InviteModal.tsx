// Slice 8b — the Invite-parent modal. Stage 8 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Markup verbatim from page.tsx.

import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import type { InviteState } from "../domain/useInvite";

export function InviteModal({ invite }: { invite: InviteState }) {
  const { inviting, inviteEmail, inviteResult, inviteSent, inviteBusy } = invite;
  return (
    <Modal
      title={`Invite ${inviting?.full_name ?? ""}'s parent`}
      open={inviting !== null}
      onClose={invite.close}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          We&apos;ll email them a link to set a password.{" "}
          {inviting?.full_name} will already be on their account, along with
          the attendance already marked — so the lessons can be invoiced
          normally.
        </p>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">
            Parent&apos;s email <span className="font-normal">(optional)</span>
          </span>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => invite.setInviteEmail(e.target.value)}
            placeholder="parent@example.com"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        {inviteResult && (
          <p
            className={`rounded-lg px-3 py-2 text-xs break-all ${
              inviteSent
                ? "bg-green-50 text-green-800"
                : "bg-gray-50 text-gray-700"
            }`}
          >
            {inviteSent ? "✓ " : ""}
            {inviteResult}
          </p>
        )}

        {/* ⚠ ONCE IT HAS GONE, "SEND INVITE" IS NO LONGER THE PRIMARY ACTION.
            Leaving it as the big blue button invites a second press — and the
            second press used to send NOTHING while reporting success, because
            the first one had created the auth user and the route then took
            the "already has an account" branch. Done is now the primary act;
            Resend is deliberately secondary, and genuinely re-sends. */}
        {inviteSent ? (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={invite.close}>
              Done
            </Button>
            <Button
              variant="outline"
              disabled={inviteBusy}
              onClick={invite.handleInviteParent}
            >
              {inviteBusy ? "Sending…" : "Resend email"}
            </Button>
          </div>
        ) : (
          <Button
            className="w-full"
            disabled={inviteBusy || !inviteEmail.trim()}
            onClick={invite.handleInviteParent}
          >
            {inviteBusy ? "Sending…" : "Send invite"}
          </Button>
        )}
      </div>
    </Modal>
  );
}
