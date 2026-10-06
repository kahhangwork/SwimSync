// THE ONLY PLACE the generated `Database` types are narrowed or widened (Wave 8,
// docs/plans/WAVE8_GENERATED_TYPES_PLAN.md, F0 step 5). lib/database.types.ts is
// generated (scripts/gen-db-types.sh) and never hand-edited; every client is typed
// with the `Database` exported HERE, which is the generated one with the widenings
// below applied.
//
// RULES (each has burned someone — §7.344–§7.349):
//   - WIDEN ONLY. Never narrow away a value the database can hold (RISK 4): the app's
//     role unions widen to the generated `user_role` enum, never the reverse.
//   - The types describe the SCHEMA, not RLS or grants. A to-one embed the type calls
//     non-null is `null` whenever RLS hides the row (§7.344), and a call that compiles
//     can still be `permission denied` (§7.349).
//   - An insert may omit a NOT NULL column only when a BEFORE INSERT trigger fills it:
//     TRIGGER_FILLED_COLUMNS, proven by the same check.
//   - An RPC param the SQL accepts as NULL goes in NULLABLE_RPC_ARGS with the line of
//     its NULL handling, read from `pg_get_functiondef` — never from a migration file
//     (§7.40). `scripts/check-db-overrides.sh` (run by G5) fails on a missing function,
//     a misspelled param, or a STRICT function (§7.346).
//   - Never replace a hand-written required-key `*Args` type with `Rpc<'fn'>['Args']`:
//     generated Args make every DEFAULTed param optional (§7.345). Keep the hand-written
//     type and assert it beside the wrapper:
//       type _Check = Assert<Extends<MyArgs, Rpc<"my_fn">["Args"]>>;
//   - `fromJson` is the ONLY permitted cast (RISK 8): it narrows a `jsonb` RPC result
//     to its hand-written interface, once, in the dao. It must stay the identity —
//     scripts/check-runtime-identical.sh proves that before treating it as erasable.
//   - Import this file's types with `import type`.

import type { Database as Generated, Json } from "./database.types";

export type { Json };

/**
 * RPC params the app sends as NULL, and what the SQL does with a NULL. One entry per
 * function; each cites its `pg_get_functiondef` output by line (read 2026-10-06).
 * "Refuses" is honest typing too: the wire carries the NULL and the function's
 * answer is its existing refusal.
 */
export const NULLABLE_RPC_ARGS = {
  // L57 `IF p_candidate_id IS NULL` (a plain add); L83/L127 NULLIF(btrim(COALESCE(p_notes,''))).
  // p_tenant_id: L25 `IF NOT parent_in_tenant(p_tenant_id)` refuses a NULL tenant.
  add_child_or_claim: ["p_candidate_id", "p_notes", "p_tenant_id"],
  // L34 `IF p_session_date IS NULL`; L39 `IF p_starts_on IS NOT NULL`; L56 inserts
  // p_date_of_birth as is (students.date_of_birth is nullable); L61–63 NULLIF(trim(COALESCE(…))).
  add_unclaimed_student: [
    "p_session_date", "p_starts_on", "p_date_of_birth",
    "p_contact_name", "p_contact_phone", "p_contact_email",
  ],
  // L9 `v_from DATE := COALESCE(p_effective_from, today_sg())`.
  assign_class_shadow: ["p_effective_from"],
  // L9 `WHERE (p_class_ids IS NULL OR r.class_id = ANY (p_class_ids))` — NULL = every class.
  class_coach_terms: ["p_class_ids"],
  // L67 `IF p_home_class_id IS NULL` (no home class named).
  book_makeup: ["p_home_class_id"],
  // L9 `v_to DATE := COALESCE(p_effective_to, today_sg())` — NULL means "today".
  end_class_shadow: ["p_effective_to"],
  // L7 `is_tenant_admin(p_tenant) AND …`, whose body opens `p_tenant_id IS NOT NULL`:
  // NULL → false, and every caller refuses on `!== true` (the API routes' 403).
  has_admin_area: ["p_tenant"],
  // L16 `IF NOT has_admin_area(p_tenant_id, …)` refuses a NULL tenant; L8
  // normalize_phone(NULL) is NULL; L56 `NOT (p_dob IS NOT NULL AND …)`.
  find_roster_duplicates: ["p_tenant_id", "p_phone", "p_dob"],
  // L11 `v_note TEXT := NULLIF(btrim(p_note), '')`.
  record_package_refund: ["p_note"],
  // L14 `v_start DATE := COALESCE(p_starts_on, today_sg())`; L89/L149 pass it to
  // enrolment_start_at(), whose L11 `IF p_starts_on IS NULL … RETURN app_now()`.
  set_enrolment_start: ["p_starts_on"],
  // L10 `v_from DATE := COALESCE(p_effective_from, today_sg())` (a correction);
  // p_location_address is not read by the body at all (DEFAULT NULL).
  set_class_terms: ["p_effective_from", "p_location_address"],
} as const;

/**
 * NOT NULL columns a BEFORE INSERT row trigger fills, so an insert may omit them or
 * send NULL.
 * `scripts/check-db-overrides.sh` proves each trigger exists, is enabled and assigns
 * NEW.<column>; the citation says when (read the body — the check proves an
 * assignment exists, not that it is unconditional).
 */
export const TRIGGER_FILLED_COLUMNS = {
  // fill_class_tenant L8 `SELECT tenant_id INTO NEW.tenant_id FROM coaches …` (always).
  classes: ["tenant_id"],
  // fill_lesson_session_times L8–10: when either time IS NULL, both come from the class.
  lesson_sessions: ["start_time", "end_time"],
  // derive_package_product_validity L8–9: `ELSIF NEW.validity_months IS NULL AND
  // NEW.validity_weeks IS NOT NULL THEN NEW.validity_months := …` (the form sends weeks).
  package_products: ["validity_months"],
  // enforce_parent_package_lifecycle L19/L30 (every INSERT: tenant and price from the
  // product); assign_parent_package_reference L23 `NEW.reference_number := next_package_ref(…)`.
  parent_packages: ["tenant_id", "amount_payable", "reference_number"],
} as const;

type GeneratedFns = Generated["public"]["Functions"];
type NullableArgs = typeof NULLABLE_RPC_ARGS;
// Distributes over overloads (a union of Args), keeping each key's optionality.
type WidenKeys<A, K extends PropertyKey> = A extends unknown
  ? { [P in keyof A]: P extends K ? A[P] | null : A[P] }
  : never;
type ArgsOf<F extends keyof GeneratedFns> = F extends keyof NullableArgs
  ? NullableArgs[F] extends readonly (infer K extends PropertyKey)[]
    ? WidenKeys<GeneratedFns[F]["Args"], K>
    : GeneratedFns[F]["Args"]
  : GeneratedFns[F]["Args"];

type GeneratedTables = Generated["public"]["Tables"];
type TriggerFilled = typeof TRIGGER_FILLED_COLUMNS;
type Flatten<T> = { [K in keyof T]: T[K] };
// A trigger-filled column may be omitted OR sent as NULL: a BEFORE trigger runs
// before the NOT NULL check, and each listed trigger fills a NULL (or overwrites).
type OptionalKeys<I, K extends PropertyKey> = Flatten<
  { [P in keyof I as P extends K ? never : P]: I[P] } & {
    [P in keyof I as P extends K ? P : never]?: I[P] | null;
  }
>;
type InsertOf<T extends keyof GeneratedTables> = T extends keyof TriggerFilled
  ? OptionalKeys<GeneratedTables[T]["Insert"], TriggerFilled[T][number]>
  : GeneratedTables[T]["Insert"];

/** The schema every client is typed with: the generated one, widened as above. */
export type Database = {
  public: {
    Tables: {
      [T in keyof GeneratedTables]: {
        [P in keyof GeneratedTables[T]]: P extends "Insert" ? InsertOf<T> : GeneratedTables[T][P];
      };
    };
    Views: Generated["public"]["Views"];
    Functions: {
      [F in keyof GeneratedFns]: {
        [P in keyof GeneratedFns[F]]: P extends "Args" ? ArgsOf<F> : GeneratedFns[F][P];
      };
    };
    Enums: Generated["public"]["Enums"];
    CompositeTypes: Generated["public"]["CompositeTypes"];
  };
};

type Public = Database["public"];
export type Tables<T extends keyof Public["Tables"]> = Public["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Public["Tables"]> = Public["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Public["Tables"]> = Public["Tables"][T]["Update"];
export type Views<V extends keyof Public["Views"]> = Public["Views"][V]["Row"];
export type Enums<E extends keyof Public["Enums"]> = Public["Enums"][E];
export type Rpc<F extends keyof Public["Functions"]> = Public["Functions"][F];

/** Every role a `profiles.role` can hold — including the retired `superadmin`. */
export type UserRole = Enums<"user_role">;

/** Compile-time assignability check for a hand-written Args type (see RULES). */
export type Assert<T extends true> = T;
export type Extends<A, B> = [A] extends [B] ? true : false;

/**
 * Narrow a `jsonb` RPC result to its hand-written interface. `source` is the SQL
 * function's name, so every narrowing is greppable back to the function that
 * shapes it. The identity at runtime — keep it exactly `return value`.
 */
export function fromJson<T>(value: Json, source: string): T {
  return value as unknown as T; // g6-exempt: fromJson
}
