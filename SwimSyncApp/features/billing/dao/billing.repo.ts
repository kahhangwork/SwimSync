// Every PostgREST read and write the parent Billing tab makes, including its
// referral card (docs/refactor/BATCH_FGH_PLAN.md, App L-G). Each returns the RAW
// builder — no mapping, no error handling, no await — byte-identical to the chain
// it replaced in app/(parent)/billing/index.tsx or components/ReferralSection.tsx.
// The hooks' Promise.all shapes and `.data` / `.error` reads are unchanged.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

type Session = { id: string };

export const fetchParentId = (session: Session) =>
  supabase
    .from("parents")
    .select("id")
    .eq("profile_id", session.id)
    .single();

export const fetchInvoices = (parentId: string) =>
  supabase
    .from("invoices")
    .select("id, reference_number, billing_month, gross_amount, package_applied, credit_applied, net_amount, status, paid_claimed_at, tenant_id, tenants(display_name)")
    .eq("parent_id", parentId)
    .order("billing_month", { ascending: false });

export const fetchCreditNotes = (parentId: string) =>
  supabase
    .from("credit_notes")
    .select("id, reference_number, amount, issued_at, original_status, corrected_status, reason, applied_to_invoice_id")
    // A 'reversed' note was voided (the lesson was un-corrected back to
    // billable, 20260818000100). It is no longer real credit, so it must
    // never render as "Available" here — filter it out (the badge below
    // then only ever sees available/applied).
    .eq("parent_id", parentId)
    .neq("status", "reversed")
    .order("issued_at", { ascending: false });

// RLS scopes these to this parent's own packages.
export const fetchPackages = () =>
  supabase
    .from("parent_packages")
    .select("id, name, lesson_count, rate_per_lesson, total_value, amount_payable, discount_amount, status, offered_by, expires_on, requested_at, holiday_extension_days, cancel_extension_days, class_categories(name), tenants(display_name)")
    .in("status", ["pending", "active"])
    .order("requested_at", { ascending: false });

// Products of every business this parent has joined (RLS).
//
// ⚠ BOTH FKs ARE NAMED ON PURPOSE. Bare `class_categories(name)` and
// bare `tenants(display_name)` are each AMBIGUOUS from
// package_products, and PostgREST answers PGRST201 — refusing the WHOLE
// query, not the one embed. 20260815000600_default_packages added a
// reverse FK on each side (class_categories.default_product_id and
// tenants.default_package_product_id, both → package_products.id) next
// to the forward ones used here. The bare form worked until that
// migration and then silently returned NOTHING, so every parent's
// "Buy a package" list was empty from 2026-08-15.
//
// Fixing only the first one still fails on the second — check the whole
// query, not the first error. `pg_constraint` is the fact; four pairs
// involving these two tables are ambiguous today (§7.176).
export const fetchProducts = () =>
  supabase
    .from("package_products")
    .select("id, name, lesson_count, rate_per_lesson, validity_weeks, class_categories!package_products_category_id_fkey(name), tenants!package_products_tenant_id_fkey(display_name)")
    .eq("is_active", true)
    .order("name");

export const insertPackageRequest = (parentId: string, productId: string) =>
  supabase
    .from("parent_packages")
    .insert({ parent_id: parentId, product_id: productId })
    .select("id")
    .single();

export const cancelPackageRequest = (pkgId: string) =>
  supabase
    .from("parent_packages")
    .update({ status: "cancelled" })
    .eq("id", pkgId)
    .eq("status", "pending");

// ── The referral card (moved from components/ReferralSection.tsx) ──────────
export const fetchReferralMemberships = () =>
  supabase
    .from("parent_tenants")
    .select("id, referral_code, referral_code_disabled_at, tenant_id, tenants(display_name)")
    .eq("is_active", true);

export const fetchReferralRewards = () =>
  supabase.from("referral_rewards").select("tenant_id, status");
