// public-package: the tokenized package-OFFER pay page's data source.
//
// The package-renewal mirror of public-invoice. Same doctrine, same reasons
// (see public-invoice/core.ts): this exists INSTEAD of an anon RPC because anon
// has no USAGE on schema public; the service-role client reads and the 128-bit
// public_token is the whole access control.
//
// ⚠ RISK 5 (PACKAGE_RENEWAL_AUTOMATION_PLAN.md): a link sitting in WhatsApp
// history for a superseded / already-active / already-paid offer must NOT show
// a payable QR (double payment).
//   • Responses are built ONLY by serializePublicPackage() — an explicit field
//     allowlist, never a spread of the DB row. core.test.ts pins the key set.
//   • The page renders the QR + "I've paid" ONLY when status === 'pending';
//     claim() returns null unless the row is pending and unclaimed.
//   • Every failure (malformed / unknown token, suspended business, claim on a
//     non-pending row) returns null → index.ts maps null to ONE shared 404.
//   • PROHIBITION: no parent name/email/phone, no UUIDs, no children's names.
//
// ⚠ RISK 9: unlike public-invoice (which deliberately keeps serving a
// suspended tenant's invoices — money owed for lessons already delivered), an
// OFFER is money for lessons that may never run. A suspended business must not
// sell a prepayment, so a suspended tenant is the uniform not-found here.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_RE = /^[0-9a-f]{32}$/;

export interface PublicPackage {
  business_name: string;
  paynow_uen: string | null;
  paynow_mobile: string | null;
  reference: string;
  // What the family PAYS (RISK 3 / D14): total_value is the package's WORTH,
  // amount is the discounted price on the QR, discount_amount the gap between.
  amount: number;
  total_value: number;
  discount_amount: number;
  package_name: string;
  lesson_count: number;
  rate: number;
  start_date: string | null;
  valid_until_preview: string | null;
  status: string;
  paid_claimed_at: string | null;
}

/** start_date + validity_weeks*7, as a YYYY-MM-DD string. Pure date arithmetic
 *  in UTC — no clock is read, so this is not the §7.7 getHours()/split("T")
 *  hazard. Holiday extension can only LENGTHEN validity, so the page frames
 *  this as "valid until at least ...". */
export function validUntilPreview(
  startDate: string | null,
  validityWeeks: number | null,
): string | null {
  if (!startDate || !validityWeeks) return null;
  const d = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + validityWeeks * 7);
  return d.toISOString().slice(0, 10);
}

/** The documented public shape — the ONLY way a response is built. */
export function serializePublicPackage(row: {
  reference_number: string;
  total_value: number;
  amount_payable: number;
  discount_amount: number;
  name: string;
  lesson_count: number;
  rate_per_lesson: number;
  start_date: string | null;
  validity_weeks: number | null;
  status: string;
  paid_claimed_at: string | null;
  tenants: unknown;
}): PublicPackage {
  // PostgREST embeds drift between object and one-element array — normalize.
  const tenantRaw = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
  const tenant = (tenantRaw ?? {}) as {
    display_name?: string;
    paynow_uen?: string | null;
    paynow_mobile?: string | null;
  };

  return {
    business_name: tenant.display_name ?? "",
    paynow_uen: tenant.paynow_uen ?? null,
    paynow_mobile: tenant.paynow_mobile ?? null,
    reference: row.reference_number,
    amount: row.amount_payable,
    total_value: row.total_value,
    discount_amount: row.discount_amount,
    package_name: row.name,
    lesson_count: row.lesson_count,
    rate: row.rate_per_lesson,
    start_date: row.start_date,
    valid_until_preview: validUntilPreview(row.start_date, row.validity_weeks),
    status: row.status,
    paid_claimed_at: row.paid_claimed_at,
  };
}

/** null = not found, for EVERY failure reason (uniform 404 upstream), INCLUDING
 *  a suspended business (RISK 9). */
export async function lookupPackage(
  db: SupabaseClient,
  token: string,
): Promise<PublicPackage | null> {
  if (!TOKEN_RE.test(token)) return null;

  const { data, error } = await db
    .from("parent_packages")
    .select(
      "reference_number, total_value, amount_payable, discount_amount, name, " +
        "lesson_count, rate_per_lesson, start_date, validity_weeks, status, " +
        "paid_claimed_at, " +
        "tenants(display_name, paynow_uen, paynow_mobile, suspended_at)",
    )
    .eq("public_token", token)
    .maybeSingle();

  if (error || !data) return null;

  // supabase-js cannot type embedded selects from a string; normalize the
  // shape (incl. array-vs-object embed drift) ourselves.
  const row = data as unknown as
    & Parameters<typeof serializePublicPackage>[0]
    & { tenants: unknown };
  const tenantRaw = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
  if ((tenantRaw as { suspended_at?: string | null })?.suspended_at) return null;

  return serializePublicPackage(row);
}

/** The sessionless "I've paid" claim. Stamps paid_claimed_at once, then stays
 *  idempotent at the first timestamp. Anything but an unclaimed PENDING offer
 *  (cancelled, active, already-claimed) is null → uniform 404, so a stale link
 *  can never re-arm a payment (RISK 5). A suspended business is null (RISK 9). */
export async function claimPackage(
  db: SupabaseClient,
  token: string,
): Promise<{ paid_claimed_at: string } | null> {
  if (!TOKEN_RE.test(token)) return null;

  const { data, error } = await db
    .from("parent_packages")
    .select("id, status, paid_claimed_at, tenants(suspended_at)")
    .eq("public_token", token)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as {
    id: string;
    status: string;
    paid_claimed_at: string | null;
    tenants: unknown;
  };
  const tenantRaw = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
  if ((tenantRaw as { suspended_at?: string | null })?.suspended_at) return null;
  if (row.paid_claimed_at) return { paid_claimed_at: row.paid_claimed_at };
  if (row.status !== "pending") return null;

  // .is("paid_claimed_at", null) makes a concurrent double-claim lose quietly
  // instead of overwriting the earlier timestamp.
  const { data: updated, error: updErr } = await db
    .from("parent_packages")
    .update({ paid_claimed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("paid_claimed_at", null)
    .select("paid_claimed_at")
    .maybeSingle();

  if (updErr) return null;
  if (updated?.paid_claimed_at) {
    return { paid_claimed_at: updated.paid_claimed_at as string };
  }

  // Lost the race — re-read the winner's timestamp.
  const { data: winner } = await db
    .from("parent_packages")
    .select("paid_claimed_at")
    .eq("id", row.id)
    .maybeSingle();
  return winner?.paid_claimed_at
    ? { paid_claimed_at: winner.paid_claimed_at as string }
    : null;
}
