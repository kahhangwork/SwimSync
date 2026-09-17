import { useState } from "react";
import * as rpc from "../dao/classes.rpc";
import type { ClassRow } from "../types";

/**
 * Scheduling a lesson off the class's usual weekday. The admin ARRANGES it; the
 * coach MARKS it — there is deliberately no attendance-writing here. Every rule
 * (admin only, reason required, nothing below the window floor) is enforced in
 * schedule_extra_lesson() and its message is rendered verbatim, never pre-empted.
 */
export function useExtraLesson() {
  const [extraFor, setExtraFor] = useState<ClassRow | null>(null);
  const [extraDate, setExtraDate] = useState("");
  const [extraReason, setExtraReason] = useState("");
  const [extraSaving, setExtraSaving] = useState(false);
  const [extraError, setExtraError] = useState<string | null>(null);
  const [extraDone, setExtraDone] = useState<string | null>(null);

  function openExtra(cls: ClassRow) {
    setExtraFor(cls);
    setExtraDate("");
    setExtraReason("");
    setExtraError(null);
    setExtraDone(null);
  }

  async function handleScheduleExtra() {
    if (!extraFor) return;
    setExtraSaving(true);
    setExtraError(null);

    // Every rule here is ALSO enforced in schedule_extra_lesson(): admin only,
    // a reason required, and nothing below the window floor. Surfacing the
    // database's own message rather than pre-empting it keeps one source of
    // truth for what is allowed.
    const { error } = await rpc.scheduleExtraLesson({
      p_class_id: extraFor.id,
      p_date: extraDate,
      p_reason: extraReason,
    });

    setExtraSaving(false);
    if (error) {
      setExtraError(error.message);
      return;
    }
    setExtraDone(extraDate);
    setExtraReason("");
    setExtraDate("");
  }

  return {
    extraFor,
    setExtraFor,
    extraDate,
    setExtraDate,
    extraReason,
    setExtraReason,
    extraSaving,
    extraError,
    extraDone,
    openExtra,
    handleScheduleExtra,
  };
}
