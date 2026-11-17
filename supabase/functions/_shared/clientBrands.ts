// Two Supabase clients that must never be confused (EDGE_FUNCTIONS_REFACTOR_PLAN.md
// B11, RISK 5). Both email functions authorise on the CALLER's own JWT — RLS and
// the authorisation RPCs answer for that user — and read/write with the SERVICE
// client, which bypasses RLS. Swapping them in an authorisation check would let
// every caller through. The brands make that a compile error: an authorisation
// function takes CallerDb, and a ServiceDb is not assignable to it.
//
// Type-only: `declare const` emits nothing, and the casts at creation are erased.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "./database.overrides.ts";

declare const callerBrand: unique symbol;
declare const serviceBrand: unique symbol;

/** Built with the anon key + the caller's Authorization header. */
export type CallerDb = SupabaseClient<Database> & { readonly [callerBrand]: true };
/** Built with the service-role key. Bypasses RLS. */
export type ServiceDb = SupabaseClient<Database> & { readonly [serviceBrand]: true };
