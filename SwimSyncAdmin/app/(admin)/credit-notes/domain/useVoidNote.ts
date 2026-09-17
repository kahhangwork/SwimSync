import { useState, type Dispatch, type SetStateAction } from "react";
import * as rpc from "../dao/creditNotes.rpc";
import type { CreditNoteRow } from "../types";

// Void flow: which note's inline confirm is open, its reason, in-flight set,
// errors. Takes the list's setNotes for the optimistic 'reversed' update.
export function useVoidNote(setNotes: Dispatch<SetStateAction<CreditNoteRow[]>>) {
  const [voidOpen, setVoidOpen] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState<Set<string>>(new Set());
  const [voidError, setVoidError] = useState<Record<string, string>>({});

  // Void one note. The RPC re-checks authority + already-reversed on its own; this
  // reopens any drawn invoice server-side. On success the row goes 'reversed' and
  // its live-application flag clears, so the Void button and any Resend disappear.
  async function voidNote(cn: CreditNoteRow) {
    const reason = voidReason.trim();
    if (!reason) {
      setVoidError((prev) => ({ ...prev, [cn.id]: "A reason is required." }));
      return;
    }
    setVoiding((prev) => new Set(prev).add(cn.id));
    setVoidError((prev) => {
      const { [cn.id]: _drop, ...rest } = prev;
      return rest;
    });

    const { error } = await rpc.voidCreditNote({
      p_note_id: cn.id,
      p_reason: reason,
    });

    setVoiding((prev) => {
      const next = new Set(prev);
      next.delete(cn.id);
      return next;
    });

    if (error) {
      // Inline, never an Alert. The RPC's messages are admin-readable as-is.
      setVoidError((prev) => ({ ...prev, [cn.id]: error.message }));
      return;
    }

    setNotes((prev) =>
      prev.map((n) =>
        n.id === cn.id
          ? { ...n, status: "reversed", has_applications: false, applied_to_invoice_id: null }
          : n
      )
    );
    setVoidOpen(null);
    setVoidReason("");
  }

  return { voidOpen, setVoidOpen, voidReason, setVoidReason, voiding, voidError, voidNote };
}
