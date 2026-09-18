// Data access for the Levels page — every PostgREST read/write, as thin
// functions returning the raw builder ({ data, error } awaited by the caller).
// No mapping, no logic: the ladder is built in domain/levelRows.ts, and the
// orchestration — including WHEN the caller's tenant is resolved inside an
// insert (after the validation, before the write) — stays in domain/useLevels.ts.
// RLS scopes every read here to the caller's own business.
import { supabase } from "@/lib/supabase";
import type { Skill } from "../types";

export function loadLevels() {
  return supabase
    .from("tenant_levels")
    .select("id, label, sort_order, note, students(id, is_active), tenant_level_skills(id, label, sort_order)")
    .order("sort_order")
    .order("label");
}

// ── The caller's own business, for an insert's WITH CHECK ───────────────────
export function getAuthUser() {
  return supabase.auth.getUser();
}

export function profileTenant(userId: string | undefined) {
  return supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .single();
}

// ── Levels ──────────────────────────────────────────────────────────────────
type LevelPayload = { label: string; sort_order: number; note: string | null };

export function updateLevel(id: string, payload: LevelPayload) {
  return supabase.from("tenant_levels").update(payload).eq("id", id);
}

export function insertLevel(row: LevelPayload & { tenant_id: unknown }) {
  return supabase.from("tenant_levels").insert(row);
}

export function deleteLevel(id: string) {
  return supabase.from("tenant_levels").delete().eq("id", id);
}

// ── Grade scale (skill_grade_levels) ────────────────────────────────────────
export function loadGradeScale() {
  return supabase
    .from("skill_grade_levels")
    .select("id, rank, label")
    .order("rank");
}

export function insertGrade(row: { label: string; rank: number; tenant_id: unknown }) {
  return supabase.from("skill_grade_levels").insert(row);
}

export function renameGrade(id: string, label: string) {
  return supabase
    .from("skill_grade_levels")
    .update({ label })
    .eq("id", id);
}

export function deleteGrade(id: string) {
  return supabase
    .from("skill_grade_levels")
    .delete()
    .eq("id", id);
}

// ── Skills ──────────────────────────────────────────────────────────────────
export function insertSkill(row: { level_id: string; label: string; sort_order: number }) {
  return supabase.from("tenant_level_skills").insert(row);
}

export function deleteSkill(skill: Skill) {
  return supabase
    .from("tenant_level_skills")
    .delete()
    .eq("id", skill.id);
}

export function setSkillSortOrder(id: string, sort_order: number) {
  return supabase.from("tenant_level_skills")
    .update({ sort_order }).eq("id", id);
}
