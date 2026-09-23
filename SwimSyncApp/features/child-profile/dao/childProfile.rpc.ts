// The one Postgres function the Child Profile screen calls
// (docs/refactor/BATCH_FGH_PLAN.md, App L-F). Raw builder, byte-identical.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

export const fetchPackageCoverage = () => supabase.rpc("student_package_coverage");
