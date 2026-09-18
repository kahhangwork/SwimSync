// PostgREST table access for the Platform page — every `.from()` this page makes,
// and nothing else. Stage 2/3 of docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// ORCHESTRATE, NEVER REPLACE. Each function here is a thin wrapper that returns
// the raw `{ data, error }`: no mapping, no error handling, no defaulting. The
// page's error handling must not change by one character when a call moves in
// here — several of this page's error paths are deliberate and asymmetric (one
// read's error is swallowed on purpose, another's must fail TOWARD prompting),
// and a dao that "tidies" them changes behaviour while looking like a move.
//
// dao/ is transport only: no React, no ui/, no @/components (fence check 2).

import { supabase } from "@/lib/supabase";
import { ilikeContains, orIlike } from "@/lib/tableSearch";
import { ROW_LIMIT } from "../constants";

/** The signed-in user, for the platform-admin gate. */
export function currentUser() {
  return supabase.auth.getUser();
}

/** That user's role. The gate compares it to 'platform_admin'. */
export function profileRole(userId: string) {
  return supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
}

/**
 * Children of the matched families, for the family-status table.
 *
 * ⚠ The `.in()` SENTINEL is load-bearing and stays in the dao: `.in("parent_id", [])`
 * matches EVERYTHING, so an empty match list must send a uuid that cannot exist
 * rather than an empty array. Bounded by the matched memberships, so this is not
 * a fresh unbounded fetch.
 */
export function childrenOfParents(parentIds: string[]) {
  return supabase
    .from("parent_students")
    .select("parent_id, students(full_name, is_active, tenant_id)")
    .in(
      "parent_id",
      parentIds.length ? parentIds : ["00000000-0000-0000-0000-000000000000"]
    );
}

/**
 * Family memberships matching a name-or-email term, across every business.
 *
 * ⚠ RISK 3 — this used to fetch EVERY parent_tenants row and filter in JS,
 * which silently searched only the first 1000 memberships. The term is now
 * pushed into the DB: match the parent's name OR email through the profiles
 * embed. BOTH embeds are !inner — over a plain (left) embed the .or() would
 * not restrict the memberships, returning every one with a null embed (the
 * silent wrong answer). The term is sanitised for the .or() grammar by
 * orIlike (lib/tableSearch), so a comma or brackets in a name is data, never
 * structure, and can never change the query.
 */
export function searchFamilyMemberships(term: string) {
  return supabase
    .from("parent_tenants")
    .select(
      "parent_id, tenant_id, is_active, tenants(display_name), parents!inner(profile_id, profiles!inner(full_name, email))"
    )
    .or(orIlike(["full_name", "email"], term), {
      referencedTable: "parents.profiles",
    })
    .limit(ROW_LIMIT);
}

/**
 * Children matching a name, for the move tool.
 *
 * ilikeContains escapes the LIKE wildcards so a name with a literal % or _
 * matches itself — consistent with the scoped search (lib/tableSearch).
 */
export function searchStudents(term: string) {
  return supabase
    .from("students")
    .select("id, full_name, tenant_id, assignment_status, is_active")
    .ilike("full_name", ilikeContains(term))
    .limit(25);
}

/**
 * Every parent linked to a child.
 *
 * ⚠ RISK (fable): the credit check sums EVERY linked parent's credit, not just
 * one — a child can have two parents. Kept as its OWN read, separate from
 * familyCreditAt: a failed link read and a failed balance read must be
 * distinguishable, because both have to fail TOWARD prompting and a merged
 * query would collapse them into one silent outcome.
 */
export function parentLinksForStudent(studentId: string) {
  return supabase
    .from("parent_students")
    .select("parent_id")
    .eq("student_id", studentId);
}

/** Those parents' credit balances at ONE business. Platform-admin readable. */
export function familyCreditAt(tenantId: string, parentIds: string[]) {
  return supabase
    .from("parent_tenant_balances")
    .select("credit_balance")
    .eq("tenant_id", tenantId)
    .in("parent_id", parentIds);
}
