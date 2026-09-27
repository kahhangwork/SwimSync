import { useState, type Dispatch, type SetStateAction } from "react";
import * as rpc from "../dao/creditNotes.rpc";
import type { CreditNoteRow, EmailDeliveryState } from "../types";
import { resendReasonLabel } from "./creditNoteRows";

// Resend one note's parent notification. Takes the list's setNotes for the
// optimistic update — which sets SENDING, never SENT: a press is a claim, not a
// delivery (CRASH_SAFE_EMAIL_CLAIM_PLAN.md §3.3). SENT only once the function
// reports a confirmed send.
export function useResend(setNotes: Dispatch<SetStateAction<CreditNoteRow[]>>) {
  // A SET, not one slot: with a single `resendingId`, pressing Resend on B while A is
  // in flight re-enabled A's button, and A's completion then cleared B's marker —
  // producing spurious red errors on notes that had in fact just been emailed.
  const [resending, setResending] = useState<Set<string>>(new Set());
  const [resendError, setResendError] = useState<Record<string, string>>({});

  const setState = (noteId: string, email_state: EmailDeliveryState) =>
    setNotes((prev) =>
      prev.map((n) =>
        n.id !== noteId
          ? n
          : {
              ...n,
              email_state,
              email_sent_at:
                email_state === "SENT" ? n.email_sent_at ?? new Date().toISOString() : n.email_sent_at,
            }
      )
    );

  async function resend(noteId: string, prior: EmailDeliveryState) {
    setResending((prev) => new Set(prev).add(noteId));
    setResendError((prev) => {
      const { [noteId]: _drop, ...rest } = prev;
      return rest;
    });
    setState(noteId, "SENDING");

    const { data, error } = await rpc.resendCreditNoteEmail(noteId);

    setResending((prev) => {
      const next = new Set(prev);
      next.delete(noteId);
      return next;
    });

    const sent = (data as { sent?: number } | null)?.sent ?? 0;
    const reason = (data as { reason?: string } | null)?.reason;

    // "nothing to send" means it is ALREADY emailed — the coach's save may have
    // beaten this press by a second. Showing a red error there is wrong twice over:
    // it reads as a failure, and it left the row saying "Not emailed" with a live
    // button.
    if (reason === "nothing to send") {
      setState(noteId, "SENT");
      return;
    }
    // Someone else's send holds the claim right now. Not an error — the row says
    // "Sending…" and settles on the next load.
    if (reason === "sending") return;

    if (error || sent < 1) {
      // What the server did with the claim is unknown here (a 4xx released it, a
      // 5xx kept it), so fall back to what the row said before the press. A press
      // against a kept claim then answers "sending", above.
      setState(noteId, prior);
      // Inline, never an Alert — this is a web page (and Alert.alert is a no-op on
      // RN-web anyway, which is why the coach app has the same rule).
      setResendError((prev) => ({
        ...prev,
        [noteId]: reason
          ? resendReasonLabel(reason)
          : error?.message ?? "Not sent.",
      }));
      return;
    }
    setState(noteId, "SENT");
  }

  return { resending, resendError, resend };
}
