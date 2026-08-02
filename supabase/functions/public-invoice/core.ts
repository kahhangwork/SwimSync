// public-invoice: the tokenized invoice page's data source.
//
// This function exists INSTEAD of an anon-callable RPC, deliberately: anon
// has no USAGE on schema public, and opening that would arm §7.39's cloud
// default-EXECUTE grants on every function whose revoke was ever forgotten.
// Here the service-role client does the reading and the 128-bit token is the
// whole access control.
//
// ⚠ RISK 3 (PAYMENT_COLLECTION_DESIGN.md): this is the product's first
// anonymous surface.
//   • Responses are built ONLY by serializePublicInvoice() below — an
//     explicit field allowlist, never a spread of the DB row, so a future
//     invoices column stays private by default. core.test.ts pins the exact
//     key set.
//   • Every failure (malformed token, unknown token, claim on a paid
//     invoice) returns null from these handlers, and index.ts maps null to
//     ONE shared 404 response — uniformity is structural, not per-branch.
//   • PROHIBITION: no parent name, no email, no phone, no row UUIDs in any
//     response. The page needs none of them.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_RE = /^[0-9a-f]{32}$/;

export interface PublicInvoice {
  business_name: string;
  paynow_uen: string | null;
  paynow_mobile: string | null;
  reference: string;
  amount: number;
  billing_month: string;
  status: string;
  paid_claimed_at: string | null;
  students: string[];
}

/** The documented public shape — the ONLY way a response is built. */
export function serializePublicInvoice(row: {
  net_amount: number;
  billing_month: string;
  status: string;
  paid_claimed_at: string | null;
  reference_number: string;
  tenants: unknown;
  invoice_items: unknown;
}): PublicInvoice {
  // PostgREST embeds drift between object and one-element array (§7.9's
  // shape family) — normalize before reading.
  const tenantRaw = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
  const tenant = (tenantRaw ?? {}) as {
    display_name?: string;
    paynow_uen?: string | null;
    paynow_mobile?: string | null;
  };
  const items = (Array.isArray(row.invoice_items) ? row.invoice_items : []) as {
    student_name?: string | null;
  }[];

  // First names only: a leaked URL should not carry a child's full name.
  const students = [
    ...new Set(
      items
        .map((i) => (i.student_name ?? "").trim().split(/\s+/)[0])
        .filter((n) => n !== ""),
    ),
  ];

  return {
    business_name: tenant.display_name ?? "",
    paynow_uen: tenant.paynow_uen ?? null,
    paynow_mobile: tenant.paynow_mobile ?? null,
    reference: row.reference_number,
    amount: row.net_amount,
    billing_month: row.billing_month,
    status: row.status,
    paid_claimed_at: row.paid_claimed_at,
    students,
  };
}

/** null = not found, for EVERY failure reason (uniform 404 upstream). */
export async function lookupInvoice(
  db: SupabaseClient,
  token: string,
): Promise<PublicInvoice | null> {
  if (!TOKEN_RE.test(token)) return null;

  const { data, error } = await db
    .from("invoices")
    .select(
      "net_amount, billing_month, status, paid_claimed_at, reference_number, " +
        "tenants(display_name, paynow_uen, paynow_mobile), " +
        "invoice_items(student_name)",
    )
    .eq("public_token", token)
    .maybeSingle();

  if (error || !data) return null;
  // supabase-js cannot type embedded selects from a string; the serializer
  // normalizes the shape (incl. array-vs-object embed drift) itself.
  return serializePublicInvoice(
    data as unknown as Parameters<typeof serializePublicInvoice>[0],
  );
}

/** The sessionless "I've paid" claim. Idempotent: an existing claim is
 *  returned as-is. Claiming a non-outstanding invoice is null → uniform 404
 *  (the page never offers the button on a paid invoice anyway). */
export async function claimInvoice(
  db: SupabaseClient,
  token: string,
): Promise<{ paid_claimed_at: string } | null> {
  if (!TOKEN_RE.test(token)) return null;

  const { data, error } = await db
    .from("invoices")
    .select("id, status, paid_claimed_at")
    .eq("public_token", token)
    .maybeSingle();

  if (error || !data) return null;
  if (data.paid_claimed_at) return { paid_claimed_at: data.paid_claimed_at };
  if (data.status !== "outstanding") return null;

  // .is("paid_claimed_at", null) makes a concurrent double-claim lose
  // quietly instead of overwriting the earlier timestamp.
  const { data: updated, error: updErr } = await db
    .from("invoices")
    .update({ paid_claimed_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("paid_claimed_at", null)
    .select("paid_claimed_at")
    .maybeSingle();

  if (updErr) return null;
  if (updated?.paid_claimed_at) return { paid_claimed_at: updated.paid_claimed_at };

  // Lost the race — re-read the winner's timestamp.
  const { data: winner } = await db
    .from("invoices")
    .select("paid_claimed_at")
    .eq("id", data.id)
    .maybeSingle();
  return winner?.paid_claimed_at ? { paid_claimed_at: winner.paid_claimed_at } : null;
}
