import { supabase } from "@/lib/supabase";

/**
 * The business's unmarked-lesson backlog — every lesson from the markable floor
 * to now still needing a mark — as `tenant_unmarked_lesson_count` counts it.
 *
 * ONE source for the number, read by BOTH the sidebar's Lessons badge and the
 * Lessons page's "Needs marking (N)" tab (BACKLOG S8, UI restyle 5.7): the audit
 * found the badge saying 20 while the tab said 2, because the tab counted only
 * the visible week. Never derive this count a second way in a client.
 *
 * null when it cannot be read (no tenant, a RAISE, a transport throw) — callers
 * show no count rather than a wrong one.
 */
export async function fetchUnmarkedLessonCount(tenantId: string | null): Promise<number | null> {
  if (!tenantId) return null;
  try {
    const { data, error } = await supabase.rpc("tenant_unmarked_lesson_count", { p_tenant: tenantId });
    if (error) return null;
    const n = Number(data ?? 0);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
