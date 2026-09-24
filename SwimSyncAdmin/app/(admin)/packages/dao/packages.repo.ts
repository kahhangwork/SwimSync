// Packages page — PostgREST table access. Thin functions returning the raw
// { data, error }; no logic, no mapping (that lives in domain/). Extracted at
// Stage 2 of the full-track refactor (docs/refactor/PACKAGES_REFACTOR_PLAN.md);
// the .rpc()/functions.invoke/auth calls move to packages.rpc.ts at Stage 3.
//
// The insert helpers take the whole payload object the page builds, so the
// tenant_id lookup (still a nested profiles/getUser await on the page) travels
// unchanged into Stage 3, where it becomes myTenantId() (RISK 6).

import { supabase } from "@/lib/supabase";
import { ROW_LIMIT } from "../constants";

// ── Reads (the load() Promise.all + the tenant settings row) ─────────────────

export const loadTenantSettings = (tenantId: string) =>
  supabase
    .from("tenants")
    .select(
      "display_name, default_package_product_id, referral_enabled, referral_discount_type, referral_discount_value"
    )
    .eq("id", tenantId)
    .single();

// The two "running low" thresholds (moved from the Students page 2026-09-24).
export const loadLowSettings = (tenantId: string) =>
  supabase
    .from("tenants")
    .select("low_package_lessons, package_expiry_warning_days")
    .eq("id", tenantId)
    .single();

export const loadCategories = () =>
  supabase
    .from("class_categories")
    .select("id, name, default_product_id, default_capacity, classes(id)")
    .order("name");

// ⚠ THE FK IS NAMED ON PURPOSE. `class_categories(name)` is AMBIGUOUS
// from package_products — category_id → class_categories.id (this one)
// and class_categories.default_product_id → package_products.id, which
// 20260815000600_default_packages added. Bare, PostgREST refuses the
// whole query with PGRST201 and this catalogue renders EMPTY. Same trap
// on the parent app's products query. Never drop the `!fkey` qualifier.
export const loadProducts = () =>
  supabase
    .from("package_products")
    .select(
      "id, name, category_id, lesson_count, rate_per_lesson, validity_weeks, is_active, class_categories!package_products_category_id_fkey(name), parent_packages(id, status)"
    )
    .order("is_active", { ascending: false })
    .order("name");

export const loadPurchases = () =>
  supabase
    .from("parent_packages")
    .select(
      "id, parent_id, product_id, name, lesson_count, rate_per_lesson, total_value, amount_payable, discount_amount, value_remaining, status, requested_at, start_date, expires_on, holiday_extension_days, cancel_extension_days, manual_extension_days, reference_number, offered_by, paid_claimed_at, superseded_by, public_token, class_categories(name), parents(profiles(full_name, email))"
    )
    .order("status")
    .order("requested_at", { ascending: false })
    .limit(ROW_LIMIT);

export const loadParentOptions = () =>
  supabase
    .from("parent_tenants")
    .select("parents(id, profiles(full_name, email))")
    .order("joined_at");

// Children names per family, for the "Who holds one" rows (Decision 9).
export const loadChildren = () =>
  supabase.from("parent_students").select("parent_id, students(full_name, is_active)");

// ── Category writes ──────────────────────────────────────────────────────────

export const insertCategory = (row: { name: string; tenant_id: unknown }) =>
  supabase.from("class_categories").insert(row);

export const deleteCategory = (id: string) =>
  supabase.from("class_categories").delete().eq("id", id);

export const updateCategoryDefault = (
  categoryId: string,
  defaultProductId: string | null
) =>
  supabase
    .from("class_categories")
    .update({ default_product_id: defaultProductId })
    .eq("id", categoryId);

export const updateCategoryCapacity = (
  categoryId: string,
  capacity: number | null
) =>
  supabase
    .from("class_categories")
    .update({ default_capacity: capacity })
    .eq("id", categoryId);

export const updateTenantDefaultProduct = (
  tenantId: string,
  defaultProductId: string | null
) =>
  supabase
    .from("tenants")
    .update({ default_package_product_id: defaultProductId })
    .eq("id", tenantId);

export const updateLowPackageLessons = (tenantId: string, value: number) =>
  supabase.from("tenants").update({ low_package_lessons: value }).eq("id", tenantId);

export const updatePackageExpiryDays = (tenantId: string, value: number) =>
  supabase.from("tenants").update({ package_expiry_warning_days: value }).eq("id", tenantId);

// ── Product writes ───────────────────────────────────────────────────────────

export const insertProduct = (row: Record<string, unknown>) =>
  supabase.from("package_products").insert(row);

export const updateProductActive = (id: string, active: boolean) =>
  supabase.from("package_products").update({ is_active: active }).eq("id", id);

// ── Purchase writes + the confirm/offer read-backs ───────────────────────────

export const insertPurchase = (row: Record<string, unknown>) =>
  supabase.from("parent_packages").insert(row);

// WHERE status='pending' makes a double-click (or two admins) collapse to
// one confirmation — the second update matches zero rows and is a no-op.
// The start date (editable, defaulted) anchors the validity period.
export const activatePendingPurchase = (id: string, startDate: string) =>
  supabase
    .from("parent_packages")
    .update({ status: "active", start_date: startDate })
    .eq("id", id)
    .eq("status", "pending");

export const cancelPurchase = (id: string) =>
  supabase
    .from("parent_packages")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["pending", "active"]);

export const findConvertedReferral = (packageId: string) =>
  supabase
    .from("referrals")
    .select("id")
    .eq("converted_package_id", packageId)
    .eq("status", "converted")
    .maybeSingle();

export const findReferrerReward = (referralId: string) =>
  supabase
    .from("referral_rewards")
    .select("id")
    .eq("referral_id", referralId)
    .eq("kind", "referrer")
    .maybeSingle();

// Read back the minted token + terms for the email and the WhatsApp link.
export const loadOfferRow = (offerId: string) =>
  supabase
    .from("parent_packages")
    .select(
      "public_token, reference_number, name, lesson_count, total_value, amount_payable, discount_amount"
    )
    .eq("id", offerId)
    .single();
