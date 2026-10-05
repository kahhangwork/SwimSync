"use client";

// "Starts on" — one field for all four add-to-class screens and the roster's
// Change (Wave 4, docs/plans/WAVE4_START_DATE_FRONT_DESK_PLAN.md §1.4).
//
// The rules are the database's (set_enrolment_start); the bounds come from
// enrolment_start_bounds; the warnings are lib/enrolmentStart.ts. This file only
// wires them to a date input.
//
// ⚠ RISK 14: if the bounds cannot be loaded, the field degrades to TODAY ONLY and
// the Add proceeds exactly as it did before this feature. A bounds failure never
// disables Save.

import { useEffect, useState } from "react";
import {
  needsStartConfirmation,
  parseBounds,
  startWarnings,
  todayOnly,
  type StartBounds,
} from "@/lib/enrolmentStart";
import { fetchStartBounds } from "@/lib/enrolmentStart.rpc";
import { todayInSg } from "@/lib/lessonDates";

export interface StartsOnState {
  bounds: StartBounds;
  value: string;
  setValue: (v: string) => void;
  /** True after the first press on a start that needs confirming (RISK 1). */
  confirmPending: boolean;
  /**
   * Call at the top of Save. Returns true when the press must STOP here — the
   * first press on a start in an earlier, unbilled month — and arms the second.
   */
  holdForConfirmation: () => boolean;
  /** What to send as p_starts_on: null means today (the database keeps NOW()). */
  startsOnParam: () => string | null;
  /** Reset to today, e.g. when the dialog opens. */
  reset: (initial?: string) => void;
}

export function useStartsOn(classId: string | null): StartsOnState {
  const [bounds, setBounds] = useState<StartBounds>(() => todayOnly(todayInSg()));
  const [value, setValueRaw] = useState<string>(() => todayInSg());
  const [confirmPending, setConfirmPending] = useState(false);

  useEffect(() => {
    const today = todayInSg();
    setConfirmPending(false);
    if (!classId) {
      setBounds(todayOnly(today));
      return;
    }
    let live = true;
    fetchStartBounds(classId).then(
      ({ data, error }) => {
        if (!live) return;
        setBounds(error ? todayOnly(today) : parseBounds(data, today));
      },
      () => {
        if (live) setBounds(todayOnly(today));
      }
    );
    return () => {
      live = false;
    };
  }, [classId]);

  return {
    bounds,
    value,
    setValue: (v) => {
      setValueRaw(v);
      setConfirmPending(false);
    },
    confirmPending,
    holdForConfirmation: () => {
      if (needsStartConfirmation(bounds, value, confirmPending)) {
        setConfirmPending(true);
        return true;
      }
      return false;
    },
    startsOnParam: () => (value === bounds.today ? null : value),
    reset: (initial) => {
      setValueRaw(initial ?? todayInSg());
      setConfirmPending(false);
    },
  };
}

const TONE: Record<string, string> = {
  sealed: "border-amber-200 bg-amber-50 text-amber-800",
  unbilled: "border-orange-300 bg-orange-50 text-orange-800",
  quiet: "border-gray-100 bg-gray-50 text-gray-600",
};

export function StartsOnField({
  start,
  childName,
  label = "Starts on",
  saveLabel = "Save",
}: {
  start: StartsOnState;
  childName: string;
  label?: string;
  /** The button the second press is on, named in the confirm line. */
  saveLabel?: string;
}) {
  const { bounds } = start;
  const warnings = startWarnings(bounds, start.value, childName || "This child");
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        {label}
        <input
          type="date"
          aria-label={label}
          value={start.value}
          min={bounds.floor}
          max={bounds.today}
          disabled={bounds.floor === bounds.today}
          onChange={(e) => e.target.value && start.setValue(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
        />
      </label>
      {start.value !== bounds.today && (
        <p className="text-xs text-gray-500">
          For a child who already swam before today. They are expected from this date on.
        </p>
      )}
      {warnings.map((w) => (
        <p
          key={w.tone}
          data-tone={w.tone}
          className={`rounded-lg border px-3 py-2 text-xs ${TONE[w.tone]}`}
        >
          {w.text}
        </p>
      ))}
      {start.confirmPending && (
        <p role="alert" className="text-xs font-semibold text-orange-800">
          Press {saveLabel} again to confirm this start date.
        </p>
      )}
    </div>
  );
}
