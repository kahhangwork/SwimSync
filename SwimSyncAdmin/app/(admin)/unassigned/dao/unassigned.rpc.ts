// Unassigned page — Postgres function calls.

import { supabase } from "@/lib/supabase";

// Payment-method chip — an unassigned child has no class, so the verdict is the
// tenant-scoped fallback: family holds a live package here or not. The pure fold
// into a per-student Map (coverageByStudent) lives in domain/.
export function loadCoverage() {
  return supabase.rpc("student_package_coverage");
}
