import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import { invoiceLabel } from "@/lib/invoiceLabel";
import { confirmAction } from "@/lib/confirm";
import { packageExtensionState } from "@/lib/packageExtension";
import ReferralSection from "@/components/ReferralSection";

type Tab = "Invoices" | "Packages" | "Credit Notes";

type Invoice = {
  id: string;
  /** `INV-YYYY-NNNN` — what the QR, the reminder and the bank statement say.
   *  Null only for rows written before the reference trigger existed. */
  reference_number: string | null;
  billing_month: string;
  gross_amount: number;
  package_applied: number;
  credit_applied: number;
  net_amount: number;
  status: "outstanding" | "paid";
  /** When the parent said they had paid. A timestamped STATEMENT, never a
   *  status change (PRD §7.21) — the coach confirms against their bank.
   *  Fetched here, not only on the detail screen, because the list now
   *  carries the claim control too. */
  paid_claimed_at: string | null;
  /** Which business issued it. A parent may deal with several, and an
   *  ungrouped list gives no way to tell whose bill is whose. */
  tenant_id: string;
  business_name: string;
};

type ParentPackage = {
  id: string;
  name: string;
  business_name: string;
  category_name: string | null;
  lesson_count: number;
  rate_per_lesson: number;
  total_value: number;
  /** What the family PAYS: total_value − discount_amount (referral). Distinct
   *  from total_value / value_remaining, which never move (D14). */
  amount_payable: number;
  discount_amount: number;
  status: "pending" | "active" | "cancelled";
  /** Set ⇒ the business prepared this as a renewal OFFER, not a parent request. */
  offered_by: string | null;
  expires_on: string | null;
  /** LIVE numbers from package_live_balances() — the stored balance minus
   *  lessons already attended but not yet invoiced. Never recomputed here:
   *  the RPC is the single derivation (PACKAGES_DESIGN.md ⚠ RISK 4). */
  live_lessons_remaining: number | null;
  live_value_remaining: number | null;
  ph_extension_weeks: number;
  ph_ack_weeks_parent: number;
};

type PackageProduct = {
  id: string;
  name: string;
  business_name: string;
  category_name: string | null;
  lesson_count: number;
  rate_per_lesson: number;
  validity_weeks: number;
};

type CreditNote = {
  id: string;
  reference_number: string;
  amount: number;
  issued_at: string;
  original_status: string;
  corrected_status: string;
  reason: string | null;
  applied_to_invoice_id: string | null;
};

function formatBillingMonth(ym: string): string {
  const [year, month] = ym.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("en-SG", { month: "long", year: "numeric" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");
}

export default function BillingScreen() {
  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);
  const [activeTab, setActiveTab] = useState<Tab>("Invoices");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [packages, setPackages] = useState<ParentPackage[]>([]);
  const [products, setProducts] = useState<PackageProduct[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [acking, setAcking] = useState<string | null>(null);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** PER-INVOICE, not a single boolean like the detail screen's `claiming` —
   *  a list can have several outstanding invoices and one in flight must not
   *  disable the rest. The re-entrancy guard below is scoped to the SAME row
   *  for that reason: a global `if (claimingId) return` would make a tap on a
   *  second invoice do nothing at all — no dialog, no toast — which is
   *  indistinguishable from a dead button. */
  const [claimingId, setClaimingId] = useState<string | null>(null);

  /** Mirrors `claimPaid` on the invoice detail screen, verbatim copy included:
   *  three surfaces (list, detail, the public tokenized page) must word this
   *  identically or the parent reads three different promises. */
  function claimPaid(inv: Invoice) {
    if (claimingId === inv.id) return; // this row only — see the state comment
    confirmAction(
      "Mark as paid?",
      "This tells your coach you've made the PayNow transfer. They'll confirm it against their bank account.",
      async () => {
        setClaimingId(inv.id);
        const { data, error } = await supabase.rpc("claim_invoice_paid", {
          p_invoice_id: inv.id,
        });
        setClaimingId(null);
        if (error) {
          showToast("Couldn't record that — please try again.", "error");
          return;
        }
        // Patch only the row that was claimed. The RPC returns the stored
        // timestamp, and it is IDEMPOTENT — a second press returns the first
        // one unchanged rather than moving it.
        setInvoices((prev) =>
          prev.map((row) =>
            row.id === inv.id
              ? { ...row, paid_claimed_at: data as string }
              : row
          )
        );
        showToast("Noted — your coach will confirm the payment.", "success");
      },
      "I've paid"
    );
  }

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    const { data: parent } = await supabase
      .from("parents")
      .select("id")
      .eq("profile_id", session.id)
      .single();

    if (!parent) {
      setLoading(false);
      return;
    }
    setParentId(parent.id);

    // On-load recompute of holiday extensions for this parent's own packages
    // (⚠ RISK 4 — idempotent; best-effort so a failure never blocks the page).
    try {
      await supabase.rpc("recompute_package_extensions", { p_parent: parent.id });
    } catch {
      /* ignore — the read below still shows the last computed state */
    }

    const [invoicesRes, creditNotesRes, packagesRes, liveRes, productsRes] =
      await Promise.all([
        supabase
          .from("invoices")
          .select("id, reference_number, billing_month, gross_amount, package_applied, credit_applied, net_amount, status, paid_claimed_at, tenant_id, tenants(display_name)")
          .eq("parent_id", parent.id)
          .order("billing_month", { ascending: false }),

        supabase
          .from("credit_notes")
          .select("id, reference_number, amount, issued_at, original_status, corrected_status, reason, applied_to_invoice_id")
          // A 'reversed' note was voided (the lesson was un-corrected back to
          // billable, 20260818000100). It is no longer real credit, so it must
          // never render as "Available" here — filter it out (the badge below
          // then only ever sees available/applied).
          .eq("parent_id", parent.id)
          .neq("status", "reversed")
          .order("issued_at", { ascending: false }),

        // RLS scopes these to this parent's own packages.
        supabase
          .from("parent_packages")
          .select("id, name, lesson_count, rate_per_lesson, total_value, amount_payable, discount_amount, status, offered_by, expires_on, requested_at, ph_extension_weeks, ph_ack_weeks_parent, class_categories(name), tenants(display_name)")
          .in("status", ["pending", "active"])
          .order("requested_at", { ascending: false }),

        supabase.rpc("package_live_balances"),

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
        supabase
          .from("package_products")
          .select("id, name, lesson_count, rate_per_lesson, validity_weeks, class_categories!package_products_category_id_fkey(name), tenants!package_products_tenant_id_fkey(display_name)")
          .eq("is_active", true)
          .order("name"),
      ]);

    setInvoices(
      (invoicesRes.data ?? []).map((inv: any) => {
        const t = Array.isArray(inv.tenants) ? inv.tenants[0] : inv.tenants;
        return {
          ...inv,
          gross_amount: Number(inv.gross_amount),
          package_applied: Number(inv.package_applied ?? 0),
          credit_applied: Number(inv.credit_applied),
          net_amount: Number(inv.net_amount),
          business_name: t?.display_name ?? "Your coach",
        };
      })
    );
    setCreditNotes(creditNotesRes.data ?? []);

    const liveById = new Map<string, any>(
      ((liveRes.data as any[]) ?? []).map((r) => [r.parent_package_id, r])
    );
    setPackages(
      (packagesRes.data ?? []).map((p: any) => {
        const t = Array.isArray(p.tenants) ? p.tenants[0] : p.tenants;
        const c = Array.isArray(p.class_categories)
          ? p.class_categories[0]
          : p.class_categories;
        const live = liveById.get(p.id);
        return {
          id: p.id,
          name: p.name,
          business_name: t?.display_name ?? "Your coach",
          category_name: c?.name ?? null,
          lesson_count: p.lesson_count,
          rate_per_lesson: Number(p.rate_per_lesson),
          total_value: Number(p.total_value),
          amount_payable: Number(p.amount_payable),
          discount_amount: Number(p.discount_amount),
          status: p.status,
          offered_by: p.offered_by ?? null,
          expires_on: p.expires_on,
          live_lessons_remaining: live ? Number(live.live_lessons_remaining) : null,
          live_value_remaining: live ? Number(live.live_value_remaining) : null,
          ph_extension_weeks: p.ph_extension_weeks ?? 0,
          ph_ack_weeks_parent: p.ph_ack_weeks_parent ?? 0,
        };
      })
    );

    // A FAILED products fetch and "this business sells nothing" render
    // IDENTICALLY — `?? []` collapses both to an empty Buy-a-package list with
    // no signal at all. That is how the PGRST201 break above survived three
    // nightlies. Say something instead of degrading quietly.
    if (productsRes.error) {
      console.error("package_products fetch failed", productsRes.error);
      showToast("Couldn't load the packages for sale — please try again.", "error");
    }
    setProducts(
      (productsRes.data ?? []).map((p: any) => {
        const t = Array.isArray(p.tenants) ? p.tenants[0] : p.tenants;
        const c = Array.isArray(p.class_categories)
          ? p.class_categories[0]
          : p.class_categories;
        return {
          id: p.id,
          name: p.name,
          business_name: t?.display_name ?? "Your coach",
          category_name: c?.name ?? null,
          lesson_count: p.lesson_count,
          rate_per_lesson: Number(p.rate_per_lesson),
          validity_weeks: p.validity_weeks,
        };
      })
    );

    setLoading(false);
  }, [session]);

  /** Request a package: a PENDING row (the DB snapshots the product's terms
   *  and forces pending for parents), then straight to the PayNow screen. */
  const acknowledgeExtension = useCallback(
    async (packageId: string) => {
      setAcking(packageId);
      const { error } = await supabase.rpc("acknowledge_package_extension", {
        p_package_id: packageId,
        p_as: "parent",
      });
      setAcking(null);
      if (error) {
        setPackageError("Could not acknowledge that. Please try again.");
        return;
      }
      loadData();
    },
    [loadData]
  );

  const requestPackage = useCallback(
    async (product: PackageProduct) => {
      if (!parentId) return;
      setRequestingId(product.id);
      setPackageError(null);
      const { data, error } = await supabase
        .from("parent_packages")
        .insert({ parent_id: parentId, product_id: product.id })
        .select("id")
        .single();
      setRequestingId(null);
      if (error || !data) {
        setPackageError("Could not request that package. Please try again.");
        return;
      }
      // Best-effort email with the amount + PayNow instructions. Fire and
      // forget: the parent is already being shown the PayNow screen, so a
      // failed email must never fail the request.
      supabase.functions
        .invoke("package-emails", {
          body: { type: "requested", package_id: data.id },
        })
        .catch(() => {});
      await loadData();
      router.push(`/(parent)/billing/paynow?packageId=${data.id}`);
    },
    [parentId, loadData]
  );

  const cancelRequest = useCallback(
    async (pkg: ParentPackage) => {
      setPackageError(null);
      const { error } = await supabase
        .from("parent_packages")
        .update({ status: "cancelled" })
        .eq("id", pkg.id)
        .eq("status", "pending");
      if (error) {
        setPackageError("Could not cancel that request.");
        return;
      }
      loadData();
    },
    [loadData]
  );

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="px-5 pt-5 pb-3">
        <Text className="text-2xl font-bold text-gray-900">Billing</Text>
        <Text className="text-sm text-gray-500 mt-0.5">
          Invoices and credit notes
        </Text>
      </View>

      {/* Tabs */}
      <View className="flex-row mx-5 mb-4 bg-gray-100 rounded-xl p-1">
        {(["Invoices", "Packages", "Credit Notes"] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-lg items-center ${
              activeTab === tab ? "bg-white shadow-sm" : ""
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                activeTab === tab ? "text-gray-900" : "text-gray-500"
              }`}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="px-5 pb-10 gap-3"
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "Invoices" ? (
            invoices.length === 0 ? (
              <View className="items-center py-16">
                <Ionicons name="receipt-outline" size={40} color="#d1d5db" />
                <Text className="text-gray-400 mt-3">No invoices yet</Text>
              </View>
            ) : (
              invoices.map((inv) => (
                /* `Card` is the OUTER element and the action row below is a
                   SIBLING of the touchable, not nested inside it — so the
                   buttons cannot depend on responder semantics to work.

                   ⚠ AND THE FEARED BUG DOES NOT EXIST — MEASURED, 2026-08-08.
                   This was built to prevent a double-fire: `confirmAction` is a
                   synchronous, blocking `window.confirm` on RN-web
                   (lib/confirm.ts), so a press that ALSO bubbled to the card
                   would run the RPC and then navigate, landing the parent on
                   the detail screen while the optimistic patch and success
                   toast applied to a screen they just left. The nesting was
                   then deliberately reintroduced and driven:
                   verify-parent-pay-claim.mjs still scored 16/16. React
                   Native's responder system grants the responder to the
                   INNERMOST view and does not propagate to ancestor
                   Touchables, so nested presses do not double-fire here.
                   This layout is kept because it reads honestly and does not
                   rely on that behaviour surviving an RN-web upgrade — but do
                   not repeat the double-fire claim as fact. */
                <Card key={inv.id}>
                  <TouchableOpacity
                    onPress={() => router.push(`/(parent)/billing/invoice/${inv.id}`)}
                    activeOpacity={0.8}
                  >
                    <View className="flex-row items-start justify-between mb-3">
                      <View>
                        <Text className="text-base font-bold text-gray-900">
                          {formatBillingMonth(inv.billing_month)}
                        </Text>
                        {/* WHO is asking for money. With children at two
                            businesses a parent gets two invoices in the same
                            month, and without this they are indistinguishable. */}
                        <Text className="text-xs font-medium text-sky-600 mt-0.5">
                          {inv.business_name}
                        </Text>
                        {/* The reference the QR, the WhatsApp reminder and the
                            bank statement all carry — not a UUID fragment, which
                            gave the parent a different number to the one on their
                            own payment. */}
                        <Text selectable className="text-xs text-gray-500 mt-0.5">
                          {invoiceLabel(inv)}
                        </Text>
                      </View>
                      <StatusBadge
                        status={inv.status === "outstanding" ? "Outstanding" : "Paid"}
                        size="sm"
                      />
                    </View>

                    <View className="gap-1">
                      <View className="flex-row justify-between">
                        <Text className="text-sm text-gray-500">Gross</Text>
                        <Text className="text-sm text-gray-700">
                          S${inv.gross_amount.toFixed(2)}
                        </Text>
                      </View>
                      {inv.package_applied > 0 && (
                        <View className="flex-row justify-between">
                          <Text className="text-sm text-blue-500">Package Applied</Text>
                          <Text className="text-sm text-blue-500">
                            −S${inv.package_applied.toFixed(2)}
                          </Text>
                        </View>
                      )}
                      {inv.credit_applied > 0 && (
                        <View className="flex-row justify-between">
                          <Text className="text-sm text-blue-500">Credit Applied</Text>
                          <Text className="text-sm text-blue-500">
                            −S${inv.credit_applied.toFixed(2)}
                          </Text>
                        </View>
                      )}
                      <View className="flex-row justify-between pt-1 border-t border-gray-100 mt-1">
                        <Text className="text-sm font-bold text-gray-900">Net Amount</Text>
                        <Text
                          className={`text-sm font-bold ${
                            inv.status === "outstanding"
                              ? "text-red-600"
                              : "text-green-600"
                          }`}
                        >
                          S${inv.net_amount.toFixed(2)}
                        </Text>
                      </View>
                    </View>

                    <View className="flex-row items-center justify-end mt-3 gap-1">
                      <Text className="text-xs text-sky-500">View Details</Text>
                      <Ionicons name="chevron-forward" size={13} color="#0ea5e9" />
                    </View>
                  </TouchableOpacity>

                  {/* Paying is the single action this product most wants a
                      parent to take, and until now it was two taps deep behind
                      "View Details" — while the public tokenized page the
                      WhatsApp reminder links to put both controls in front of
                      them immediately. The parent who opened the APP got the
                      slower path; this removes that inversion. */}
                  {inv.status === "outstanding" && (
                    <View className="mt-3 border-t border-gray-100 pt-3 gap-2">
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() =>
                            router.push(
                              `/(parent)/billing/paynow?invoiceId=${inv.id}`
                            )
                          }
                          className="flex-1 bg-sky-500 rounded-xl py-2.5 items-center"
                        >
                          <Text className="text-sm font-semibold text-white">
                            Pay via PayNow
                          </Text>
                        </TouchableOpacity>
                        {/* A claim is one-way and idempotent, so once made the
                            button is replaced rather than disabled. Pay stays
                            available either way — a claimed invoice is still
                            unpaid until the coach confirms it. */}
                        {!inv.paid_claimed_at && (
                          <TouchableOpacity
                            onPress={() => claimPaid(inv)}
                            className="flex-1 border border-gray-200 rounded-xl py-2.5 items-center"
                          >
                            <Text className="text-sm font-semibold text-gray-500">
                              {claimingId === inv.id ? "Saving…" : "I've paid"}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {inv.paid_claimed_at && (
                        <Text className="text-xs text-sky-700 text-center">
                          You&apos;ve told your coach this is paid — they&apos;ll
                          confirm it.
                        </Text>
                      )}
                    </View>
                  )}
                </Card>
              ))
            )
          ) : activeTab === "Packages" ? (
            <>
              {packageError && (
                <View className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  <Text className="text-sm text-red-600">{packageError}</Text>
                </View>
              )}

              {packages.length === 0 && products.length === 0 && (
                <View className="items-center py-16">
                  <Ionicons name="cube-outline" size={40} color="#d1d5db" />
                  <Text className="text-gray-400 mt-3 text-center px-8">
                    Your coach doesn&apos;t offer prepaid packages yet.
                  </Text>
                </View>
              )}

              {packages.map((pkg) => (
                <Card key={pkg.id}>
                  <View className="flex-row items-start justify-between mb-2">
                    <View className="flex-1 pr-2">
                      <Text className="text-base font-bold text-gray-900">
                        {pkg.name}
                      </Text>
                      <Text className="text-xs font-medium text-sky-600 mt-0.5">
                        {pkg.business_name}
                        {pkg.category_name ? ` · ${pkg.category_name} classes` : ""}
                      </Text>
                    </View>
                    <StatusBadge
                      status={pkg.status === "active" ? "Active" : "Pending"}
                      size="sm"
                    />
                  </View>

                  {pkg.status === "active" ? (
                    <>
                      <View className="items-center py-3">
                        <Text className="text-3xl font-bold text-gray-900">
                          {pkg.live_lessons_remaining ??
                            Math.floor(pkg.total_value / pkg.rate_per_lesson)}
                        </Text>
                        <Text className="text-sm text-gray-500">
                          lessons remaining
                        </Text>
                        <Text className="text-xs text-gray-400 mt-1">
                          S$
                          {(pkg.live_value_remaining ?? pkg.total_value).toFixed(2)}{" "}
                          of S${pkg.total_value.toFixed(2)}
                        </Text>
                      </View>
                      {/* Lessons your child has attended show here the same
                          day; the money itself moves on the monthly invoice. */}
                      {pkg.expires_on && (
                        <View className="flex-row justify-between pt-2 border-t border-gray-100">
                          <Text className="text-xs text-gray-500">Valid until</Text>
                          <Text className="text-xs text-gray-700">
                            {formatDate(pkg.expires_on)}
                          </Text>
                        </View>
                      )}
                      {/* Loud while the holiday extension exceeds what this
                          parent has acknowledged; a quiet note once acked. */}
                      {(() => {
                        const st = packageExtensionState(
                          pkg.ph_extension_weeks,
                          pkg.ph_ack_weeks_parent
                        );
                        return st === "loud" ? (
                          <View className="mt-2 rounded-xl bg-amber-50 p-3">
                            <Text className="text-xs font-semibold text-amber-800">
                              Good news — your package was extended by{" "}
                              {pkg.ph_extension_weeks} week
                              {pkg.ph_extension_weeks === 1 ? "" : "s"} for public
                              holidays.
                            </Text>
                            <TouchableOpacity
                              onPress={() => acknowledgeExtension(pkg.id)}
                              disabled={acking !== null}
                              className="mt-2 self-start rounded-lg bg-amber-500 px-3 py-1.5"
                            >
                              <Text className="text-xs font-bold text-white">
                                {acking === pkg.id ? "…" : "Got it"}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : st === "quiet" ? (
                          <Text className="mt-1 text-xs text-gray-400">
                            Includes +{pkg.ph_extension_weeks} week
                            {pkg.ph_extension_weeks === 1 ? "" : "s"} for public
                            holidays
                          </Text>
                        ) : null;
                      })()}
                    </>
                  ) : (
                    <>
                      {pkg.offered_by ? (
                        <Text className="text-sm text-gray-600 mb-3">
                          {pkg.business_name} has prepared your next package —{" "}
                          {pkg.lesson_count} lessons ·{" "}
                          S${pkg.amount_payable.toFixed(2)}. Pay via PayNow to
                          activate it.
                        </Text>
                      ) : (
                        <Text className="text-sm text-gray-600 mb-3">
                          {pkg.lesson_count} lessons ·{" "}
                          S${pkg.amount_payable.toFixed(2)}. Waiting for{" "}
                          {pkg.business_name} to confirm your PayNow payment.
                        </Text>
                      )}
                      {pkg.discount_amount > 0 && (
                        <Text className="text-xs font-medium text-emerald-600 -mt-2 mb-3">
                          Referral discount: −S${pkg.discount_amount.toFixed(2)}{" "}
                          off S${pkg.total_value.toFixed(2)}
                        </Text>
                      )}
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() =>
                            router.push(
                              `/(parent)/billing/paynow?packageId=${pkg.id}`
                            )
                          }
                          className="flex-1 bg-sky-500 rounded-xl py-2.5 items-center"
                        >
                          <Text className="text-sm font-semibold text-white">
                            Pay via PayNow
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => cancelRequest(pkg)}
                          className="px-4 rounded-xl py-2.5 items-center border border-gray-200"
                        >
                          <Text className="text-sm font-semibold text-gray-500">
                            Cancel
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </Card>
              ))}

              {products.length > 0 && (
                <>
                  <Text className="text-sm font-bold text-gray-700 mt-3 mb-1">
                    Buy a package
                  </Text>
                  {products.map((p) => (
                    <Card key={p.id}>
                      <Text className="text-base font-bold text-gray-900">
                        {p.name}
                      </Text>
                      <Text className="text-xs font-medium text-sky-600 mt-0.5 mb-2">
                        {p.business_name}
                        {p.category_name ? ` · ${p.category_name} classes` : ""}
                      </Text>
                      <Text className="text-sm text-gray-600 mb-3">
                        {p.lesson_count} lessons at S$
                        {p.rate_per_lesson.toFixed(2)} each —{" "}
                        <Text className="font-bold text-gray-900">
                          S${(p.lesson_count * p.rate_per_lesson).toFixed(2)}
                        </Text>
                        , valid {p.validity_weeks} week
                        {p.validity_weeks === 1 ? "" : "s"} from its start date.
                      </Text>
                      <TouchableOpacity
                        onPress={() => requestPackage(p)}
                        disabled={requestingId !== null}
                        className="bg-sky-500 rounded-xl py-2.5 items-center"
                        style={requestingId !== null ? { opacity: 0.6 } : undefined}
                      >
                        <Text className="text-sm font-semibold text-white">
                          {requestingId === p.id ? "Requesting…" : "Request & pay"}
                        </Text>
                      </TouchableOpacity>
                    </Card>
                  ))}
                  <Text className="text-xs text-gray-400 px-1">
                    You pay by PayNow; the package becomes active once your
                    coach confirms the money arrived. Lessons then use the
                    package automatically, and anything it doesn&apos;t cover
                    appears on your monthly invoice as usual.
                  </Text>
                </>
              )}

              <ReferralSection />
            </>
          ) : creditNotes.length === 0 ? (
            <View className="items-center py-16">
              <Ionicons name="document-outline" size={40} color="#d1d5db" />
              <Text className="text-gray-400 mt-3">No credit notes</Text>
            </View>
          ) : (
            creditNotes.map((cn) => (
              <Card key={cn.id}>
                <View className="flex-row items-start justify-between mb-2">
                  <View>
                    <Text className="text-base font-bold text-gray-900">
                      {cn.reference_number}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-0.5">
                      {formatDate(cn.issued_at)}
                    </Text>
                  </View>
                  <StatusBadge
                    status={cn.applied_to_invoice_id ? "Applied" : "Available"}
                    size="sm"
                  />
                </View>
                <Text className="text-xs text-gray-500 mb-1">
                  {capitalize(cn.original_status)} → {capitalize(cn.corrected_status)}
                </Text>
                {cn.reason ? (
                  <Text className="text-sm text-gray-600 mb-2">{cn.reason}</Text>
                ) : null}
                <View className="flex-row justify-between pt-2 border-t border-gray-100">
                  <Text className="text-sm text-gray-500">Credit Amount</Text>
                  <Text className="text-sm font-bold text-blue-600">
                    S${Number(cn.amount).toFixed(2)}
                  </Text>
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
