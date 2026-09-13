// Coaches page — pure mapping and derivations. No React, no network. Carries
// unit tests (coachesRows.test.ts). (coachDisableImpact.ts, the completeness
// rule, lives beside this — moved here from lib/ as this is its sole importer.)

import type { CoachRow } from "../types";
import type { OverrideSession } from "./coachDisableImpact";

export function toCoachRows(data: any[]): CoachRow[] {
  return (data ?? []).map((c: any) => ({
    id: c.id,
    profile_id: c.profile_id,
    full_name: c.profiles?.full_name ?? "—",
    email: c.profiles?.email ?? "—",
    phone: c.profiles?.phone ?? null,
    class_titles: (c.classes ?? [])
      .filter((cls: any) => cls.is_active)
      .map((cls: any) => cls.title),
    disabled_at: c.disabled_at ?? null,
  }));
}

// The ⚠ RISK 8 candidate set: the coach's override sessions on or before today
// (only PAST/TODAY lessons can be unmarked and fall to the admin after disable).
export function toOverrideSessions(scData: any[], today: string): OverrideSession[] {
  return (scData ?? [])
    .map((r: any) => {
      const ls = Array.isArray(r.lesson_sessions)
        ? r.lesson_sessions[0]
        : r.lesson_sessions;
      if (!ls) return null;
      const cls = Array.isArray(ls.classes) ? ls.classes[0] : ls.classes;
      return {
        id: ls.id,
        class_id: ls.class_id,
        title: cls?.title ?? "—",
        session_date: ls.session_date,
      };
    })
    .filter((s: OverrideSession | null): s is OverrideSession => s !== null)
    .filter((s) => s.session_date <= today);
}

// Active coaches other than the one being disabled — the handover targets.
export function replacementOptions(
  coaches: CoachRow[],
  disableId: string | undefined
): CoachRow[] {
  return coaches.filter((c) => c.id !== disableId && !c.disabled_at);
}
