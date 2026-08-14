"use client";

// Prepaid lesson packages — what this business sells, and who holds one.
//
// THREE SECTIONS, one page, because they are one feature:
//   • Class categories — the business's own vocabulary for "what kind of
//     class" (Group, Private…). A package is sold against ONE category, or
//     against every class (no category). Categories exist FOR packages, so
//     they live here rather than as their own nav item.
//   • Products — what is offered: N lessons at a locked rate, valid M months.
//     Money terms are IMMUTABLE by database trigger — a price change is
//     retire + create new, never an edit, so no change can reprice a package
//     a family already holds (the class_rates philosophy).
//   • Purchases — pending requests to confirm (the admin's proof-of-payment
//     step, PRD §7.9's manual-verification model), plus every package held.
//
// Balances shown here are LIVE: package_live_balances() subtracts lessons
// already attended but not yet invoiced. Do NOT recompute that in TS — the
// RPC is the single derivation (PACKAGES_DESIGN.md ⚠ RISK 4).

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { todayInSg } from "@/lib/lessonDates";
import { packageExtensionState } from "@/lib/packageExtension";

type Category = { id: string; name: string; class_count: number };

type Product = {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  lesson_count: number;
  rate_per_lesson: number;
  validity_weeks: number;
  is_active: boolean;
  holder_count: number;
};

type Purchase = {
  id: string;
  parent_id: string;
  parent_name: string;
  name: string;
  category_name: string | null;
  lesson_count: number;
  rate_per_lesson: number;
  total_value: number;
  value_remaining: number;
  live_value_remaining: number | null;
  live_lessons_remaining: number | null;
  status: string;
  product_id: string;
  requested_at: string;
  start_date: string | null;
  expires_on: string | null;
  ph_extension_weeks: number;
  ph_ack_weeks_admin: number;
  manual_extension_days: number;
  /** PKG-YYYY-NNNN (20260809000100). What an incoming PayNow line is matched
   *  back to — the parent's QR carries it as the bill reference. NOT NULL in
   *  the database; typed nullable only so a stale cached row cannot crash the
   *  page. */
  reference_number: string | null;
};

type ParentOption = { id: string; name: string };

const money = (n: number) => `S$${Number(n).toFixed(2)}`;

async function myTenantId(): Promise<string | null> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.user.id)
    .single();
  return (data?.tenant_id as string | null) ?? null;
}

export default function PackagesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [parents, setParents] = useState<ParentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Category form
  const [newCategory, setNewCategory] = useState("");
  // Product form
  const [productModal, setProductModal] = useState(false);
  const [pName, setPName] = useState("");
  const [pCategory, setPCategory] = useState("");
  const [pLessons, setPLessons] = useState("");
  const [pRate, setPRate] = useState("");
  const [pWeeks, setPWeeks] = useState("12");
  const [formError, setFormError] = useState<string | null>(null);
  // Record-sale form
  const [saleModal, setSaleModal] = useState(false);
  const [saleParent, setSaleParent] = useState("");
  const [saleProduct, setSaleProduct] = useState("");
  // Start date — pre-filled from suggest_package_start, always editable, and
  // failing open to today (⚠ RISK 7: the RPC must never block a sale).
  const [saleStart, setSaleStart] = useState("");
  const [confirmStart, setConfirmStart] = useState("");
  // Confirm/cancel/cancel-active confirmations
  const [confirming, setConfirming] = useState<Purchase | null>(null);
  const [cancelling, setCancelling] = useState<Purchase | null>(null);
  // Manual extension
  const [extending, setExtending] = useState<Purchase | null>(null);
  const [extendWeeks, setExtendWeeks] = useState("1");
  const [extendReason, setExtendReason] = useState("");
  const [extendError, setExtendError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);

    // On-load recompute so holiday extensions reflect the current calendar and
    // enrolments (⚠ RISK 4 — idempotent, so this is cheap and safe to call every
    // load). Best-effort: a failure must not stop the page rendering.
    const tenant = await myTenantId();
    if (tenant) {
      try {
        await supabase.rpc("recompute_package_extensions", { p_tenant: tenant });
      } catch {
        /* best-effort: a failed recompute must not stop the page rendering */
      }
    }

    // RLS scopes every query here to the caller's own business.
    const [catRes, prodRes, purRes, liveRes, ptRes] = await Promise.all([
      supabase
        .from("class_categories")
        .select("id, name, classes(id)")
        .order("name"),
      supabase
        .from("package_products")
        .select(
          "id, name, category_id, lesson_count, rate_per_lesson, validity_weeks, is_active, class_categories(name), parent_packages(id, status)"
        )
        .order("is_active", { ascending: false })
        .order("name"),
      supabase
        .from("parent_packages")
        .select(
          "id, parent_id, product_id, name, lesson_count, rate_per_lesson, total_value, value_remaining, status, requested_at, start_date, expires_on, ph_extension_weeks, ph_ack_weeks_admin, manual_extension_days, reference_number, class_categories(name), parents(profiles(full_name, email))"
        )
        .order("status")
        .order("requested_at", { ascending: false }),
      supabase.rpc("package_live_balances"),
      supabase
        .from("parent_tenants")
        .select("parents(id, profiles(full_name, email))")
        .order("joined_at"),
    ]);

    setCategories(
      (catRes.data ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        class_count: (c.classes ?? []).length,
      }))
    );

    setProducts(
      (prodRes.data ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        category_id: p.category_id,
        category_name: p.class_categories?.name ?? null,
        lesson_count: p.lesson_count,
        rate_per_lesson: Number(p.rate_per_lesson),
        validity_weeks: p.validity_weeks,
        is_active: p.is_active,
        holder_count: (p.parent_packages ?? []).filter(
          (x: any) => x.status !== "cancelled"
        ).length,
      }))
    );

    // Live balances by package id — the RPC's number, never recomputed here.
    const liveById = new Map<string, any>(
      ((liveRes.data as any[]) ?? []).map((r) => [r.parent_package_id, r])
    );

    setPurchases(
      (purRes.data ?? []).map((p: any) => ({
        id: p.id,
        parent_id: p.parent_id,
        parent_name:
          p.parents?.profiles?.full_name ??
          p.parents?.profiles?.email ??
          "Unknown",
        name: p.name,
        category_name: p.class_categories?.name ?? null,
        lesson_count: p.lesson_count,
        rate_per_lesson: Number(p.rate_per_lesson),
        total_value: Number(p.total_value),
        value_remaining: Number(p.value_remaining),
        live_value_remaining: liveById.has(p.id)
          ? Number(liveById.get(p.id).live_value_remaining)
          : null,
        live_lessons_remaining: liveById.has(p.id)
          ? Number(liveById.get(p.id).live_lessons_remaining)
          : null,
        status: p.status,
        product_id: p.product_id,
        requested_at: p.requested_at,
        start_date: p.start_date,
        expires_on: p.expires_on,
        ph_extension_weeks: p.ph_extension_weeks ?? 0,
        ph_ack_weeks_admin: p.ph_ack_weeks_admin ?? 0,
        manual_extension_days: p.manual_extension_days ?? 0,
        reference_number: p.reference_number ?? null,
      }))
    );

    setParents(
      (ptRes.data ?? [])
        .map((r: any) => ({
          id: r.parents?.id,
          name:
            r.parents?.profiles?.full_name ?? r.parents?.profiles?.email ?? "",
        }))
        .filter((p: ParentOption) => p.id)
    );

    setLoading(false);
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  async function addCategory() {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    setBusy(true);
    const { error: err } = await supabase.from("class_categories").insert({
      name: trimmed,
      tenant_id: (
        await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("id", (await supabase.auth.getUser()).data.user?.id)
          .single()
      ).data?.tenant_id,
    });
    setBusy(false);
    if (err) {
      setError(
        err.code === "23505"
          ? `You already have a category called "${trimmed}".`
          : "Could not add that category."
      );
      return;
    }
    setNewCategory("");
    setError(null);
    load();
  }

  async function removeCategory(c: Category) {
    setBusy(true);
    const { error: err } = await supabase
      .from("class_categories")
      .delete()
      .eq("id", c.id);
    setBusy(false);
    if (err) {
      // 23503: a product is sold against it — deleting would silently widen
      // that product's scope to all classes, which the FK forbids.
      setError(
        err.code === "23503"
          ? `"${c.name}" has packages sold against it. Retire those products first.`
          : "Could not remove that category."
      );
      return;
    }
    setError(null);
    load();
  }

  // ── Products ───────────────────────────────────────────────────────────────

  function openProductModal() {
    setPName("");
    setPCategory("");
    setPLessons("");
    setPRate("");
    setPWeeks("12");
    setFormError(null);
    setProductModal(true);
  }

  async function saveProduct() {
    const name = pName.trim();
    // Empty BEFORE coercing — Number("") is 0, which has saved a $0 wage rate
    // and an invoice run day of 1 in this codebase (§7.22, §7.14). The DB
    // CHECKs would refuse anyway; validating here gives a usable message.
    if (!name) return setFormError("The package needs a name.");
    if (pLessons.trim() === "" || !Number.isInteger(Number(pLessons)) || Number(pLessons) <= 0)
      return setFormError("Lessons must be a whole number above zero.");
    if (pRate.trim() === "" || !Number.isFinite(Number(pRate)) || Number(pRate) <= 0)
      return setFormError("The rate per lesson must be above zero.");
    if (pWeeks.trim() === "" || !Number.isInteger(Number(pWeeks)) || Number(pWeeks) <= 0)
      return setFormError("Validity must be a whole number of weeks.");

    setBusy(true);
    setFormError(null);
    const { error: err } = await supabase.from("package_products").insert({
      name,
      category_id: pCategory || null,
      lesson_count: Number(pLessons),
      rate_per_lesson: Number(pRate),
      validity_weeks: Number(pWeeks),
      tenant_id: (
        await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("id", (await supabase.auth.getUser()).data.user?.id)
          .single()
      ).data?.tenant_id,
    });
    setBusy(false);
    if (err) {
      setFormError("Could not create the package.");
      return;
    }
    setProductModal(false);
    load();
  }

  async function setProductActive(p: Product, active: boolean) {
    setBusy(true);
    const { error: err } = await supabase
      .from("package_products")
      .update({ is_active: active })
      .eq("id", p.id);
    setBusy(false);
    if (err) setError("Could not update that package.");
    load();
  }

  // ── Purchases ──────────────────────────────────────────────────────────────

  // Pre-fill a start date from the smart default. ⚠ RISK 7: this is only a
  // suggestion — any failure falls back to today, never blocks the flow.
  async function fetchSuggestedStart(parentId: string, productId: string) {
    try {
      const { data, error: err } = await supabase.rpc("suggest_package_start", {
        p_parent_id: parentId,
        p_product_id: productId,
      });
      if (err || !data) return todayInSg();
      return String(data);
    } catch {
      return todayInSg();
    }
  }

  // Sale form: when both parent and product are chosen, suggest a start date.
  useEffect(() => {
    if (saleModal && saleParent && saleProduct) {
      fetchSuggestedStart(saleParent, saleProduct).then(setSaleStart);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleModal, saleParent, saleProduct]);

  // Confirm dialog: suggest a start date for the pending request being confirmed.
  useEffect(() => {
    if (confirming) {
      fetchSuggestedStart(confirming.parent_id, confirming.product_id).then(
        setConfirmStart
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming]);

  async function recordSale() {
    if (!saleParent || !saleProduct) return;
    setBusy(true);
    // Directly active: the admin recording an offline sale IS the
    // confirmation. The DB snapshots the product's terms and dates expiry from
    // the start date (defaulting to today if the admin cleared the field).
    const { error: err } = await supabase.from("parent_packages").insert({
      parent_id: saleParent,
      product_id: saleProduct,
      status: "active",
      start_date: saleStart || todayInSg(),
      tenant_id: (
        await supabase
          .from("profiles")
          .select("tenant_id")
          .eq("id", (await supabase.auth.getUser()).data.user?.id)
          .single()
      ).data?.tenant_id,
    });
    setBusy(false);
    if (err) {
      setError("Could not record the sale.");
      return;
    }
    setSaleModal(false);
    setSaleParent("");
    setSaleProduct("");
    setSaleStart("");
    load();
  }

  async function confirmPurchase(p: Purchase) {
    setBusy(true);
    // WHERE status='pending' makes a double-click (or two admins) collapse to
    // one confirmation — the second update matches zero rows and is a no-op.
    // The start date (editable, defaulted) anchors the validity period.
    const { error: err } = await supabase
      .from("parent_packages")
      .update({ status: "active", start_date: confirmStart || todayInSg() })
      .eq("id", p.id)
      .eq("status", "pending");
    setBusy(false);
    setConfirming(null);
    if (err) {
      setError("Could not confirm that purchase.");
      return;
    }
    // Best-effort "your package is active" email to the parent. Never blocks
    // or fails the confirmation — the package is already active.
    supabase.functions
      .invoke("package-emails", {
        body: { type: "confirmed", package_id: p.id },
      })
      .catch(() => {});
    load();
  }

  async function acknowledgeExtension(p: Purchase) {
    setBusy(true);
    const { error: err } = await supabase.rpc("acknowledge_package_extension", {
      p_package_id: p.id,
      p_as: "admin",
    });
    setBusy(false);
    if (err) {
      setError("Could not acknowledge that extension.");
      return;
    }
    load();
  }

  async function submitExtend() {
    if (!extending) return;
    const weeks = Number(extendWeeks);
    if (!Number.isInteger(weeks) || weeks <= 0) {
      setExtendError("Enter a whole number of weeks above zero.");
      return;
    }
    const days = weeks * 7;
    if (days > 365) {
      setExtendError("That is too long — 52 weeks is the most.");
      return;
    }
    setBusy(true);
    setExtendError(null);
    const { error: err } = await supabase.rpc("extend_package", {
      p_package_id: extending.id,
      p_days: days,
      p_reason: extendReason.trim(),
    });
    setBusy(false);
    if (err) {
      setExtendError("Could not extend that package.");
      return;
    }
    setExtending(null);
    setExtendWeeks("1");
    setExtendReason("");
    load();
  }

  async function acknowledgeAllExtensions() {
    const tenant = await myTenantId();
    if (!tenant) return;
    setBusy(true);
    const { error: err } = await supabase.rpc("acknowledge_all_extensions", {
      p_tenant: tenant,
    });
    setBusy(false);
    if (err) {
      setError("Could not acknowledge the extensions.");
      return;
    }
    load();
  }

  async function cancelPurchase(p: Purchase) {
    setBusy(true);
    const { error: err } = await supabase
      .from("parent_packages")
      .update({ status: "cancelled" })
      .eq("id", p.id)
      .in("status", ["pending", "active"]);
    setBusy(false);
    setCancelling(null);
    if (err) {
      setError("Could not cancel that package.");
      return;
    }
    load();
  }

  const pending = purchases.filter((p) => p.status === "pending");
  const held = purchases.filter((p) => p.status !== "pending");

  // Oldest request first: this queue is work waiting on the admin, and the
  // parent who has been waiting longest is the one to serve next.
  const pendingSort = useTableSort<Purchase>({ key: "requested_at" });
  const visiblePending = pendingSort.apply(pending);

  const productSort = useTableSort<Product>({
    key: "name",
    accessors: {
      category_name: (p) => p.category_name ?? "All classes",
      price: (p) => p.lesson_count * p.rate_per_lesson,
    },
  });
  const visibleProducts = productSort.apply(products);

  const heldSort = useTableSort<Purchase>({
    key: "parent_name",
    accessors: { remaining: (p) => p.live_lessons_remaining },
  });
  const visibleHeld = heldSort.apply(held);
  const activeProducts = products.filter((p) => p.is_active);
  // A package is LOUD for the admin while its holiday extension exceeds what
  // the admin has acknowledged.
  const loudCount = held.filter(
    (p) =>
      packageExtensionState(p.ph_extension_weeks, p.ph_ack_weeks_admin) ===
      "loud"
  ).length;

  return (
    <div>
      <PageHeader
        title="Packages"
        subtitle="Prepaid lesson packages — what you sell, and who holds one"
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Pending requests — the action queue, so it comes first ────────── */}
      {pending.length > 0 && (
        <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-1 text-sm font-bold text-amber-900">
            Awaiting confirmation ({pending.length})
          </h2>
          <p className="mb-3 text-xs text-amber-800">
            Confirm once the parent&rsquo;s PayNow transfer has landed in your
            account. Confirming starts the validity period.
          </p>
          <Table>
            <Thead>
              <Th sort={pendingSort} sortKey="parent_name">Parent</Th>
              <Th sort={pendingSort} sortKey="name">Package</Th>
              <Th sort={pendingSort} sortKey="reference_number">Reference</Th>
              <Th sort={pendingSort} sortKey="total_value" firstDir="desc">Price</Th>
              <Th sort={pendingSort} sortKey="requested_at">Requested</Th>
              <Th>&nbsp;</Th>
            </Thead>
            <Tbody>
              {visiblePending.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium text-gray-900">{p.parent_name}</Td>
                  <Td className="text-gray-600">
                    {p.name}
                    <span className="text-gray-400">
                      {" "}
                      · {p.lesson_count} × {money(p.rate_per_lesson)}
                    </span>
                  </Td>
                  {/* The whole point of the column: this string is what
                      appears on the bank statement, so it must be readable
                      and copyable, not summarised. */}
                  <Td className="font-mono text-xs text-gray-600">
                    {p.reference_number ?? "—"}
                  </Td>
                  <Td className="text-gray-900">{money(p.total_value)}</Td>
                  <Td className="text-gray-500">
                    {new Date(p.requested_at).toLocaleDateString("en-SG")}
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button onClick={() => setConfirming(p)} disabled={busy}>
                        Payment received
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setCancelling(p)}
                        disabled={busy}
                      >
                        Decline
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

      {/* ── Products ──────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">What you sell</h2>
          <Button onClick={openProductModal}>Add package</Button>
        </div>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : products.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="font-medium text-gray-900">No packages defined</p>
            <p className="mt-1 text-sm text-gray-500">
              A package is N lessons at a locked rate — e.g. 10 lessons at
              S$40, valid 12 weeks. Parents request one from the app and pay
              by PayNow; families without one simply stay on monthly invoices.
            </p>
          </div>
        ) : (
          <Table>
            <Thead>
              <Th sort={productSort} sortKey="name">Package</Th>
              <Th sort={productSort} sortKey="category_name">Valid for</Th>
              <Th sort={productSort} sortKey="lesson_count" firstDir="desc">Lessons</Th>
              <Th sort={productSort} sortKey="rate_per_lesson" firstDir="desc">Rate</Th>
              <Th sort={productSort} sortKey="price" firstDir="desc">Price</Th>
              <Th sort={productSort} sortKey="validity_weeks" firstDir="desc">Validity</Th>
              <Th sort={productSort} sortKey="holder_count" firstDir="desc">Held by</Th>
              <Th>&nbsp;</Th>
            </Thead>
            <Tbody>
              {visibleProducts.map((p) => (
                <Tr key={p.id} className={p.is_active ? "" : "opacity-50"}>
                  <Td className="font-medium text-gray-900">
                    {p.name}
                    {!p.is_active && (
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        retired
                      </span>
                    )}
                  </Td>
                  <Td className="text-gray-500">
                    {p.category_name ?? "All classes"}
                  </Td>
                  <Td className="text-gray-500">{p.lesson_count}</Td>
                  <Td className="text-gray-500">{money(p.rate_per_lesson)}</Td>
                  <Td className="text-gray-900">
                    {money(p.lesson_count * p.rate_per_lesson)}
                  </Td>
                  <Td className="text-gray-500">
                    {p.validity_weeks} week{p.validity_weeks === 1 ? "" : "s"}
                  </Td>
                  <Td className="text-gray-500">{p.holder_count}</Td>
                  <Td>
                    <Button
                      variant="outline"
                      onClick={() => setProductActive(p, !p.is_active)}
                      disabled={busy}
                    >
                      {p.is_active ? "Retire" : "Reoffer"}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-gray-500">
          A package&rsquo;s lessons, rate and validity can&rsquo;t be edited —
          families already hold them at those terms. To change the price,
          retire the package and create a new one; renewals then buy the new
          terms.
        </p>
      </div>

      {/* ── Held packages ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">Who holds one</h2>
          <div className="flex gap-2">
            {loudCount > 0 && (
              <Button
                variant="outline"
                onClick={acknowledgeAllExtensions}
                disabled={busy}
              >
                Acknowledge all ({loudCount})
              </Button>
            )}
            <Button variant="outline" onClick={() => setSaleModal(true)}>
              Record a sale
            </Button>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : held.length === 0 ? (
          <p className="text-sm text-gray-400">
            Nobody holds a package yet.
          </p>
        ) : (
          <Table>
            <Thead>
              <Th sort={heldSort} sortKey="parent_name">Parent</Th>
              <Th sort={heldSort} sortKey="name">Package</Th>
              <Th sort={heldSort} sortKey="reference_number">Reference</Th>
              <Th sort={heldSort} sortKey="remaining">Remaining</Th>
              <Th sort={heldSort} sortKey="start_date">Starts</Th>
              <Th sort={heldSort} sortKey="expires_on">Expires</Th>
              <Th sort={heldSort} sortKey="status">Status</Th>
              <Th>&nbsp;</Th>
            </Thead>
            <Tbody>
              {visibleHeld.map((p) => {
                // todayInSg(), never toISOString().slice — the UTC date is
                // yesterday in SGT before 08:00 (§7.7).
                const expired =
                  p.status === "active" &&
                  p.expires_on !== null &&
                  p.expires_on < todayInSg();
                return (
                  <Tr key={p.id}>
                    <Td className="font-medium text-gray-900">
                      {p.parent_name}
                    </Td>
                    <Td className="text-gray-600">
                      {p.name}
                      <span className="text-gray-400">
                        {" "}
                        · {p.category_name ?? "all classes"}
                      </span>
                    </Td>
                    {/* Kept here too so a payment can still be reconciled
                        after the request has been confirmed. */}
                    <Td className="font-mono text-xs text-gray-600">
                      {p.reference_number ?? "—"}
                    </Td>
                    <Td>
                      {p.status === "active" &&
                      p.live_lessons_remaining !== null ? (
                        <span
                          className="font-medium text-gray-900"
                          data-testid="live-remaining"
                        >
                          {p.live_lessons_remaining} lesson
                          {p.live_lessons_remaining === 1 ? "" : "s"}
                          <span className="font-normal text-gray-400">
                            {" "}
                            · {money(p.live_value_remaining ?? 0)}
                          </span>
                          {p.live_value_remaining !== p.value_remaining && (
                            <span
                              className="ml-1 font-normal text-gray-400"
                              title="Includes lessons attended but not yet invoiced"
                            >
                              *
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-500">
                          {money(p.value_remaining)}
                        </span>
                      )}
                    </Td>
                    <Td className="text-gray-500">{p.start_date ?? "—"}</Td>
                    <Td className="text-gray-500">
                      {p.expires_on ?? "—"}
                      {expired && (
                        <span className="ml-1 text-xs text-red-600">
                          expired
                        </span>
                      )}
                      {/* Loud while the extension exceeds the admin's ack; a
                          quiet permanent note once acknowledged. */}
                      {(() => {
                        const st = packageExtensionState(
                          p.ph_extension_weeks,
                          p.ph_ack_weeks_admin
                        );
                        return st === "loud" ? (
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                              Extended +{p.ph_extension_weeks} wk
                            </span>
                            <button
                              onClick={() => acknowledgeExtension(p)}
                              disabled={busy}
                              className="text-xs font-medium text-sky-600 hover:underline"
                            >
                              Acknowledge
                            </button>
                          </div>
                        ) : st === "quiet" ? (
                          <div className="mt-0.5 text-xs text-gray-400">
                            +{p.ph_extension_weeks} wk · public holidays
                          </div>
                        ) : null;
                      })()}
                      {p.manual_extension_days > 0 && (
                        <div className="mt-0.5 text-xs text-gray-400">
                          +{p.manual_extension_days} day
                          {p.manual_extension_days === 1 ? "" : "s"} · manual
                        </div>
                      )}
                    </Td>
                    <Td>
                      <StatusBadge
                        status={
                          p.status.charAt(0).toUpperCase() + p.status.slice(1)
                        }
                      />
                    </Td>
                    <Td>
                      {p.status === "active" && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setExtendWeeks("1");
                              setExtendReason("");
                              setExtendError(null);
                              setExtending(p);
                            }}
                            disabled={busy}
                          >
                            Extend
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setCancelling(p)}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-gray-500">
          * Remaining balances are live: lessons attended but not yet invoiced
          are already subtracted. The money itself moves when the month is
          billed.
        </p>
      </div>

      {/* ── Class categories ──────────────────────────────────────────────── */}
      <div className="mb-8">
        <h2 className="mb-1 text-sm font-bold text-gray-900">
          Class categories
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          Your own grouping of classes — &ldquo;Group&rdquo;,
          &ldquo;Private&rdquo;, whatever you price together. A package sold
          against a category is spendable at every class in it, including ones
          you add later. Assign a class its category on the Classes page.
        </p>
        <div className="mb-3 flex gap-2">
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCategory();
            }}
            placeholder="Group"
            className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <Button onClick={addCategory} disabled={busy || !newCategory.trim()}>
            Add category
          </Button>
        </div>
        {categories.length > 0 && (
          <ul className="space-y-1">
            {categories.map((c) => (
              <li
                key={c.id}
                className="flex w-96 items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-900">{c.name}</span>
                <span className="text-xs text-gray-500">
                  {c.class_count} class{c.class_count === 1 ? "" : "es"}
                  <button
                    onClick={() => removeCategory(c)}
                    disabled={busy}
                    className="ml-3 text-gray-400 hover:text-red-600"
                    aria-label={`Remove ${c.name}`}
                  >
                    &times;
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <Modal
        open={productModal}
        onClose={() => setProductModal(false)}
        title="Add package"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              value={pName}
              onChange={(e) => setPName(e.target.value)}
              placeholder="10 Group Lessons"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Valid for
            </label>
            <select
              value={pCategory}
              onChange={(e) => setPCategory(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All classes</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} classes only
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Lessons
              </label>
              <input
                value={pLessons}
                onChange={(e) => setPLessons(e.target.value)}
                inputMode="numeric"
                placeholder="10"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Rate (S$)
              </label>
              <input
                value={pRate}
                onChange={(e) => setPRate(e.target.value)}
                inputMode="decimal"
                placeholder="40"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Weeks valid
              </label>
              <input
                value={pWeeks}
                onChange={(e) => setPWeeks(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          {pLessons && pRate && Number(pLessons) > 0 && Number(pRate) > 0 && (
            <p className="text-sm text-gray-600">
              Sells for{" "}
              <strong>{money(Number(pLessons) * Number(pRate))}</strong> —{" "}
              {pLessons} lessons at {money(Number(pRate))} each.
            </p>
          )}
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setProductModal(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={saveProduct} disabled={busy}>
              {busy ? "Saving…" : "Create package"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={saleModal}
        onClose={() => setSaleModal(false)}
        title="Record a sale"
      >
        <p className="mb-4 text-sm text-gray-600">
          For a purchase arranged outside the app. The package becomes active
          immediately — record it only once the money has arrived.
        </p>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Parent
            </label>
            <select
              value={saleParent}
              onChange={(e) => setSaleParent(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Choose…</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Package
            </label>
            <select
              value={saleProduct}
              onChange={(e) => setSaleProduct(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Choose…</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {money(p.lesson_count * p.rate_per_lesson)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Start date
            </label>
            <input
              type="date"
              value={saleStart}
              onChange={(e) => setSaleStart(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-400">
              Suggested from when this parent&rsquo;s current coverage ends —
              adjust it freely.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setSaleModal(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={recordSale}
              disabled={busy || !saleParent || !saleProduct}
            >
              {busy ? "Saving…" : "Record sale"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Confirm payment received?"
      >
        <p className="text-sm text-gray-600">
          {confirming && (
            <>
              <strong>{confirming.parent_name}</strong> — {confirming.name} for{" "}
              <strong>{money(confirming.total_value)}</strong>. Confirming
              activates the package; its validity runs from the start date below.
            </>
          )}
        </p>
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Start date
          </label>
          <input
            type="date"
            value={confirmStart}
            onChange={(e) => setConfirmStart(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">
            Suggested from when this parent&rsquo;s current coverage ends —
            adjust it freely.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setConfirming(null)}
            disabled={busy}
          >
            Not yet
          </Button>
          <Button
            onClick={() => confirming && confirmPurchase(confirming)}
            disabled={busy}
          >
            {busy ? "Confirming…" : "Payment received"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={
          cancelling?.status === "pending"
            ? "Decline this request?"
            : "Cancel this package?"
        }
      >
        <p className="text-sm text-gray-600">
          {cancelling?.status === "pending" ? (
            "The request is withdrawn. Nothing was charged."
          ) : (
            <>
              <strong>{money(cancelling?.value_remaining ?? 0)}</strong>{" "}
              remains on this package. Cancelling freezes it at that amount —
              settle any refund with the family directly; SwimSync keeps the
              record but does not move the money.
            </>
          )}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setCancelling(null)}
            disabled={busy}
          >
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={() => cancelling && cancelPurchase(cancelling)}
            disabled={busy}
          >
            {busy ? "Working…" : cancelling?.status === "pending" ? "Decline" : "Cancel package"}
          </Button>
        </div>
      </Modal>

      {/* Manual extension */}
      <Modal
        open={extending !== null}
        onClose={() => setExtending(null)}
        title={`Extend ${extending?.name ?? "package"}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            A discretionary extension for{" "}
            <strong>{extending?.parent_name}</strong>, added on top of any
            public-holiday extension. Currently expires{" "}
            <strong>{extending?.expires_on ?? "—"}</strong>.
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Extra weeks
            </label>
            <input
              value={extendWeeks}
              onChange={(e) => setExtendWeeks(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Reason <span className="text-gray-400">(optional)</span>
            </label>
            <input
              value={extendReason}
              onChange={(e) => setExtendReason(e.target.value)}
              placeholder="Goodwill"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          {extendError && <p className="text-sm text-red-600">{extendError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setExtending(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={submitExtend} disabled={busy}>
              {busy ? "Extending…" : "Extend package"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
