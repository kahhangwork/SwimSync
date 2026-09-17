// Data access for the Credit Notes page — every PostgREST read, as thin
// functions returning the raw builder ({ data, error } awaited by the caller).
// Row mapping lives in domain/creditNoteRows.ts; orchestration (the sequence
// guard, the error surfacing) in domain/useCreditNoteList.ts.
import { supabase } from "@/lib/supabase";
import { ilikeContains } from "@/lib/tableSearch";
import { ROW_LIMIT } from "../constants";
import type { SearchField } from "../types";

export function getAuthUser() {
  return supabase.auth.getUser();
}

export function loadViewerProfile(userId: string) {
  return supabase
    .from("profiles")
    .select("role, tenant_id, admin_disabled_at")
    .eq("id", userId)
    .maybeSingle();
}

/** `term` is the trimmed search term ("" = no search). */
export function loadNotes(term: string, searchField: SearchField) {
  // ⚠ !inner ONLY on the embed being SEARCHED (parent). A filter on a plain
  // (left) embed returns every note with a null embed — the silent wrong
  // answer. Student and Reference are BASE columns, so they need no embed
  // change. Left plain otherwise, so the default list keeps notes whose parent
  // account has since gone.
  const parentEmbed =
    term !== "" && searchField === "parent"
      ? "parents!inner(profiles!inner(full_name))"
      : "parents(profiles(full_name))";

  let query = supabase
    .from("credit_notes")
    // ⚠ RISK 2 — credit_applications comes back as an EMBED, not a second query.
    // With no filter/limit/error-check it made `has_applications` false on every
    // row (a db-max-rows truncation), silently disarming the part-spent guard.
    // As an embed it is scoped to the notes loaded and shares this error path.
    .select(
      `id, reference_number, amount, reason, status, applied_to_invoice_id, issued_at, student_name, email_sent_at, tenant_id, credit_applications(credit_note_id, reversed_at), students(id, full_name), ${parentEmbed}`
    )
    .order("issued_at", { ascending: false })
    .limit(ROW_LIMIT);

  // Scoped, in the DB. Student and Reference are base columns; Parent rides the
  // profiles embed. Bound `.ilike`, so a `, ( )` in a name is literal.
  if (term !== "") {
    if (searchField === "parent") {
      query = query.ilike("parents.profiles.full_name", ilikeContains(term));
    } else if (searchField === "reference") {
      query = query.ilike("reference_number", ilikeContains(term));
    } else {
      query = query.ilike("student_name", ilikeContains(term));
    }
  }

  return query;
}
