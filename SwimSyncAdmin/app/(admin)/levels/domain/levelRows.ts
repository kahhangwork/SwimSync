// Pure: raw tenant_levels rows -> the ladder. Lifted verbatim from the page's
// load() (Admin L-D, BATCH_D_PLAN.md) so it gets the page's first unit tests.
import type { Level, Skill } from "../types";

export function toLevels(data: any[] | null): Level[] {
  return (data ?? []).map((l: any) => ({
    id: l.id,
    label: l.label,
    sort_order: l.sort_order,
    note: l.note,
    // Read off the JOINED students, not off the level — the select is
    // `any`, so the wrong nesting level would typecheck and silently
    // report every level as empty.
    //
    // Split in JS, deliberately NOT with `students!inner(...)` and a
    // server-side filter: that would drop levels with no ACTIVE children out
    // of the result entirely, so a level held only by departed children
    // would VANISH from the ladder and read as deleted. The ladder is the
    // business's curriculum (PRD §7.15) — it must list every rung.
    student_count: (l.students ?? []).filter((s: any) => s.is_active).length,
    inactive_count: (l.students ?? []).filter((s: any) => !s.is_active).length,
    // Ordered here rather than in the query: PostgREST cannot order an
    // embedded resource, so sorting server-side would silently do nothing.
    skills: [...(l.tenant_level_skills ?? [])].sort(
      (a: Skill, b: Skill) =>
        a.sort_order - b.sort_order || a.label.localeCompare(b.label)
    ),
  }));
}
