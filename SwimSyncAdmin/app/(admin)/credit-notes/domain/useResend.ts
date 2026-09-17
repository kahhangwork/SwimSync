import { useState, type Dispatch, type SetStateAction } from "react";
import * as rpc from "../dao/creditNotes.rpc";
import type { CreditNoteRow } from "../types";
import { resendReasonLabel } from "./creditNoteRows";

// Resend one note's parent notification. Takes the list's setNotes for the
// optimistic "Emailed" update.
export function useResend(setNotes: Dispatch<SetStateAction<CreditNoteRow[]>>) {
  // A SET, not one slot: with a single `resendingId`, pressing Resend on B while A is
  // in flight re-enabled A's button, and A's completion then cleared B's marker —
  // producing spurious red errors on notes that had in fact just been emailed.
  const [resending, setResending] = useState<Set<string>>(new Set());
  const [resendError, setResendError] = useState<Record<string, string>>({});

  const markEmailed = (noteId: string) =>
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId ? { ...n, email_sent_at: new Date().toISOString() } : n
      )
    );

  async function resend(noteId: string) {
    setResending((prev) => new Set(prev).add(noteId));
    setResendError((prev) => {
      const { [noteId]: _drop, ...rest } = prev;
      return rest;
    });

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
    // button, because the optimistic update only ran on success.
    if (reason === "nothing to send") {
      markEmailed(noteId);
      return;
    }

    if (error || sent < 1) {
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
    markEmailed(noteId);
  }

  return { resending, resendError, resend };
}
