import { useState } from "react";
import * as rpc from "../dao/classes.rpc";
import type { ClassRow } from "../types";

/**
 * Cancelling a lesson in advance — the second home for cancel_lesson() (the
 * first is the lesson page reached from the Calendar). Class + future date +
 * reason; every refusal (today/past, guests booked, already marked) is the
 * RPC's own and is rendered verbatim.
 */
export function useCancelLesson() {
  const [cancelFor, setCancelFor] = useState<ClassRow | null>(null);
  const [cancelDate, setCancelDate] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelDone, setCancelDone] = useState<string | null>(null);

  function openCancel(cls: ClassRow) {
    setCancelFor(cls);
    setCancelDate("");
    setCancelReason("");
    setCancelError(null);
    setCancelDone(null);
  }

  async function handleCancelLesson() {
    if (!cancelFor) return;
    setCancelSaving(true);
    setCancelError(null);
    const { error } = await rpc.cancelLesson({
      p_class_id: cancelFor.id,
      p_date: cancelDate,
      p_reason: cancelReason,
    });
    setCancelSaving(false);
    if (error) {
      setCancelError(error.message);
      return;
    }
    setCancelDone(cancelDate);
    setCancelReason("");
    setCancelDate("");
  }

  return {
    cancelFor,
    setCancelFor,
    cancelDate,
    setCancelDate,
    cancelReason,
    setCancelReason,
    cancelSaving,
    cancelError,
    cancelDone,
    openCancel,
    handleCancelLesson,
  };
}
