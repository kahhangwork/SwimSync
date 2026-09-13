// CHARACTERISATION test (playbook §0): pins behaviour the Coaches page already
// had. Not a new rule, so §7.25's prove-red-first does not apply.

import { describe, expect, it } from "vitest";
import { replacementOptions, toCoachRows, toOverrideSessions } from "./coachesRows";
import type { CoachRow } from "../types";

describe("coaches domain — pure mapping", () => {
  it("maps coach rows, keeping only ACTIVE class titles, defaulting profile fields", () => {
    const data = [
      {
        id: "c1", profile_id: "p1", disabled_at: null,
        profiles: { full_name: "Amy", email: "a@x.sg", phone: "9" },
        classes: [{ title: "Fish", is_active: true }, { title: "Old", is_active: false }],
      },
      { id: "c2", profile_id: "p2", disabled_at: "2026-01-01", profiles: null, classes: [] },
    ];
    const rows = toCoachRows(data);
    expect(rows[0]).toMatchObject({ id: "c1", full_name: "Amy", class_titles: ["Fish"], disabled_at: null });
    expect(rows[1]).toMatchObject({ id: "c2", full_name: "—", email: "—", phone: null, class_titles: [], disabled_at: "2026-01-01" });
  });

  it("builds override sessions, flattening embeds and keeping only <= today", () => {
    const scData = [
      { lesson_sessions: { id: "s1", class_id: "cl1", session_date: "2026-01-01", classes: { title: "Fish" } } },
      { lesson_sessions: [{ id: "s2", class_id: "cl2", session_date: "2999-01-01", classes: [{ title: "Future" }] }] },
      { lesson_sessions: null },
    ];
    const out = toOverrideSessions(scData, "2026-06-01");
    expect(out).toEqual([{ id: "s1", class_id: "cl1", title: "Fish", session_date: "2026-01-01" }]);
  });

  it("offers active OTHER coaches as replacements", () => {
    const coaches = [
      { id: "c1", disabled_at: null },
      { id: "c2", disabled_at: null },
      { id: "c3", disabled_at: "2026-01-01" },
    ] as CoachRow[];
    expect(replacementOptions(coaches, "c1").map((c) => c.id)).toEqual(["c2"]);
  });
});
