// Every PostgREST read and write of the invoice-email paths (email.ts), moved verbatim
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B3).
//
// THIN BY RULE: the original chains, returned un-awaited (or as a builder the caller
// extends: `profilesQuery`, `ownersQuery`). The callers keep every error branch, every
// fallback and the never-throw contract of each email path.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import type { Database } from "../../_shared/database.overrides.ts";
import { BLOCKED_NOTICE_KEY } from "../constants.ts";

type Db = SupabaseClient<Database>;

export const INVOICE_EMAIL_SELECT =
  "id, parent_id, tenant_id, billing_month, gross_amount, package_applied, credit_applied, balance_adjustment, net_amount, due_date";

/** One invoices row as INVOICE_EMAIL_SELECT reads it. */
export type InvoiceEmailRow = {
  id: string;
  parent_id: string;
  tenant_id: string;
  billing_month: string;
  gross_amount: number;
  package_applied: number;
  credit_applied: number;
  balance_adjustment: number | null;
  net_amount: number;
  due_date: string;
};

// ── Claim → send → settle ───────────────────────────────────────────────────
/** Conditional on the settle token — see settleInvoiceEmail. */
export function settleInvoiceEmailRow(
  supabase: Db,
  patch: Database["public"]["Tables"]["invoices"]["Update"],
  invoiceId: string,
  claimedAt: string,
) {
  return supabase
      .from("invoices")
      .update(patch)
      .eq("id", invoiceId)
      .eq("invoice_email_claimed_at", claimedAt);
}

// ── emailInvoices: one read per table for the batch ─────────────────────────
export function readParentContacts(supabase: Db, parentIds: string[]) {
  return supabase
      .from("parents")
      .select("id, profiles(email, full_name)")
      .in("id", parentIds);
}

export function readTenantBranding(supabase: Db, tenantIds: string[]) {
  return supabase
          .from("tenants")
          .select("id, display_name, logo_url")
          .in("id", tenantIds);
}

export function readStudentNames(supabase: Db, studentIds: string[]) {
  return supabase
      .from("students")
      .select("id, full_name")
      .in("id", studentIds);
}

// ── Retry / resend ──────────────────────────────────────────────────────────
export function readInvoiceItemsFor(supabase: Db, rows: readonly { id: string }[]) {
  return supabase
    .from("invoice_items")
    .select("invoice_id, student_id, session_date, class_title, amount")
    .in("invoice_id", rows.map((r) => r.id as string));
}

/** The retry pass's discovery query. Returned unawaited: the caller may add
 *  `.not("id", "in", …)` for this run's own invoices before sending it. */
export function discoverUnsentInvoices(supabase: Db, tenantId: string, billingMonth: string) {
  return supabase
      .from("invoices")
      .select(INVOICE_EMAIL_SELECT)
      .eq("tenant_id", tenantId)
      .eq("billing_month", billingMonth)
      .in("invoice_email_state", ["UNSENT", "RETRYABLE"]);
}

export function readInvoiceForResend(supabase: Db, invoiceId: string) {
  return supabase
      .from("invoices")
      // `as const` keeps the joined column list a literal TYPE, so the row infers (erased at build).
      .select(`${INVOICE_EMAIL_SELECT}, invoice_email_state` as const)
      .eq("id", invoiceId)
      .maybeSingle();
}

export function readTenantSuspendedAt(supabase: Db, row: { tenant_id: string }) {
  return supabase
      .from("tenants")
      .select("suspended_at")
      .eq("id", row.tenant_id)
      .maybeSingle();
}

// ── The blocked-generation notice ───────────────────────────────────────────
export function readBlockedNoticeState(supabase: Db) {
  return supabase
      .from("app_settings")
      .select("value")
      .eq("key", BLOCKED_NOTICE_KEY)
      .maybeSingle();
}

/** The candidate recipients' base query; the caller scopes it (.or / .in). */
export function profilesQuery(supabase: Db) {
  return supabase.from("profiles").select("id, email, role, tenant_id, admin_role_id");
}

/** Tenant owners' base query; the caller scopes it to one tenant when it has one. */
export function ownersQuery(supabase: Db) {
  return supabase.from("tenants").select("owner_profile_id");
}

export function readOpsEditRoles(supabase: Db) {
  return supabase.from("tenant_role_permissions").select("role_id")
        .eq("area", "operations").eq("level", "edit");
}

/** Record the fingerprint that was alerted. `updated_at` is the write's own stamp. */
export function recordBlockedNotice(
  supabase: Db,
  seen: Record<string, string>,
  seenKey: string,
  fingerprint: string,
) {
  return supabase
        .from("app_settings")
        .update({
          value: { ...seen, [seenKey]: fingerprint },
          updated_at: new Date().toISOString(),
        })
        .eq("key", BLOCKED_NOTICE_KEY);
}
