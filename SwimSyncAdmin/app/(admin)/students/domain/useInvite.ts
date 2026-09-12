// Slice 8b — invite the parent of an unclaimed child. Stage 8 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Lifted from page.tsx intact.
//
// The happy path for a child a coach added. Unlike self-registration there is
// no matching to get wrong: the admin asserts the link, so the parent lands
// with this child already on their account and every lesson already marked
// for them becomes billable.

import { useState } from "react";
import * as api from "../dao/students.api";
import type { StudentRow } from "../types";

export function useInvite(reload: () => Promise<void>) {
  const [inviting, setInviting] = useState<StudentRow | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  // Separate from the message, because the modal's ACTIONS change once the
  // invite has gone: re-pressing a primary "Send invite" is how an admin
  // double-sends, or worse, believes they have re-sent when they have not.
  const [inviteSent, setInviteSent] = useState(false);

  async function handleInviteParent() {
    if (!inviting) return;
    setInviteBusy(true);
    setInviteResult(null);
    setInviteSent(false);

    try {
      const { ok, json } = await api.inviteParent(inviting.id, inviteEmail.trim());
      if (!ok) {
        setInviteResult(`Error: ${json.error ?? "invite failed"}`);
      } else if (json.emailed) {
        setInviteResult(
          json.message ?? `Invite sent to ${inviteEmail.trim()}.`
        );
        setInviteSent(true);
        await reload();
      } else if (json.alreadyRegistered) {
        // A live account: the child was linked, nothing was mailed, and saying
        // so plainly matters — this used to claim an email had been sent.
        setInviteResult(json.message);
        setInviteSent(true);
        await reload();
      } else {
        // No RESEND_API_KEY (local, or a misconfigured deploy). Showing the
        // link is deliberate — it keeps the flow usable — but it must be
        // clearly NOT the intended outcome, or a broken key looks like success.
        setInviteResult(
          `No email was sent (no mail key configured). Send them this link yourself: ${json.invite_link}`
        );
        await reload();
      }
    } catch (e) {
      setInviteResult(`Error: ${String(e)}`);
    }
    setInviteBusy(false);
  }

  function open(student: StudentRow) {
    setInviting(student);
    setInviteEmail("");
    setInviteResult(null);
  }

  function close() {
    setInviting(null);
    setInviteSent(false);
    setInviteResult(null);
  }

  return {
    inviting,
    inviteEmail,
    setInviteEmail,
    inviteBusy,
    inviteResult,
    inviteSent,
    open,
    close,
    handleInviteParent,
  };
}

export type InviteState = ReturnType<typeof useInvite>;
