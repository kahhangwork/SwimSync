// Every Postgres function the parent Billing tab calls (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). Raw builders, byte-identical to the calls they replaced.
//
// ⚠ claim_invoice_paid is ALSO called by features/invoice-detail — two separate
// dao functions on purpose. Do NOT deduplicate across features (plan ⚠ R8).
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";
import type { DataOf } from "@/lib/database.overrides";

export const claimInvoicePaid = (invoiceId: string) =>
  supabase.rpc("claim_invoice_paid", {
    p_invoice_id: invoiceId,
  });

export const fetchLiveBalances = () => supabase.rpc("package_live_balances");

// The referral card's "friends you've brought" — first names only (RISK 5).
export const fetchMyReferrals = () => supabase.rpc("my_referrals");

// What one package paid for (Wave 6 D3): marking-time draws + legacy
// invoice-time rows, one row per draw, returns flagged. DEFINER with its own
// gate — the owning parent (tenant not suspended), a packages:view admin or a
// platform admin; anyone else is refused (42501).
export const fetchPackageUsage = (packageId: string) =>
  supabase.rpc("package_usage", { p_package: packageId });

// ── Row types (Wave 8) — set-returning RPCs, typed rows (not jsonb) ──────────
export type LiveBalanceRow = DataOf<typeof fetchLiveBalances>[number];
export type MyReferralRow = DataOf<typeof fetchMyReferrals>[number];
