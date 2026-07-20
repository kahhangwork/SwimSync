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
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { todayInSg } from "@/lib/lessonDates";

type Category = { id: string; name: string; class_count: number };

type Product = {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  lesson_count: number;
  rate_per_lesson: number;
  validity_months: number;
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
  requested_at: string;
  expires_on: string | null;
};

type ParentOption = { id: string; name: string };

const money = (n: number) => `S$${Number(n).toFixed(2)}`;

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
  const [pMonths, setPMonths] = useState("12");
  const [formError, setFormError] = useState<string | null>(null);
  // Record-sale form
  const [saleModal, setSaleModal] = useState(false);
  const [saleParent, setSaleParent] = useState("");
  const [saleProduct, setSaleProduct] = useState("");
  // Confirm/cancel/cancel-active confirmations
  const [confirming, setConfirming] = useState<Purchase | null>(null);
  const [cancelling, setCancelling] = useState<Purchase | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);

    // RLS scopes every query here to the caller's own business.
    const [catRes, prodRes, purRes, liveRes, ptRes] = await Promise.all([
      supabase
        .from("class_categories")
        .select("id, name, classes(id)")
        .order("name"),
      supabase
        .from("package_products")
        .select(
          "id, name, category_id, lesson_count, rate_per_lesson, validity_months, is_active, class_categories(name), parent_packages(id, status)"
        )
        .order("is_active", { ascending: false })
        .order("name"),
      supabase
        .from("parent_packages")
        .select(
          "id, parent_id, name, lesson_count, rate_per_lesson, total_value, value_remaining, status, requested_at, expires_on, class_categories(name), parents(profiles(full_name, email))"
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
        validity_months: p.validity_months,
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
        requested_at: p.requested_at,
        expires_on: p.expires_on,
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
    setPMonths("12");
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
    if (pMonths.trim() === "" || !Number.isInteger(Number(pMonths)) || Number(pMonths) <= 0)
      return setFormError("Validity must be a whole number of months.");

    setBusy(true);
    setFormError(null);
    const { error: err } = await supabase.from("package_products").insert({
      name,
      category_id: pCategory || null,
      lesson_count: Number(pLessons),
      rate_per_lesson: Number(pRate),
      validity_months: Number(pMonths),
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

  async function recordSale() {
    if (!saleParent || !saleProduct) return;
    setBusy(true);
    // Directly active: the admin recording an offline sale IS the
    // confirmation. The DB snapshots the product's terms and dates expiry.
    const { error: err } = await supabase.from("parent_packages").insert({
      parent_id: saleParent,
      product_id: saleProduct,
      status: "active",
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
    load();
  }

  async function confirmPurchase(p: Purchase) {
    setBusy(true);
    // WHERE status='pending' makes a double-click (or two admins) collapse to
    // one confirmation — the second update matches zero rows and is a no-op.
    const { error: err } = await supabase
      .from("parent_packages")
      .update({ status: "active" })
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
  const activeProducts = products.filter((p) => p.is_active);

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
              <Th>Parent</Th>
              <Th>Package</Th>
              <Th>Price</Th>
              <Th>Requested</Th>
              <Th>&nbsp;</Th>
            </Thead>
            <Tbody>
              {pending.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium text-gray-900">{p.parent_name}</Td>
                  <Td className="text-gray-600">
                    {p.name}
                    <span className="text-gray-400">
                      {" "}
                      · {p.lesson_count} × {money(p.rate_per_lesson)}
                    </span>
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
              S$40, valid 12 months. Parents request one from the app and pay
              by PayNow; families without one simply stay on monthly invoices.
            </p>
          </div>
        ) : (
          <Table>
            <Thead>
              <Th>Package</Th>
              <Th>Valid for</Th>
              <Th>Lessons</Th>
              <Th>Rate</Th>
              <Th>Price</Th>
              <Th>Validity</Th>
              <Th>Held by</Th>
              <Th>&nbsp;</Th>
            </Thead>
            <Tbody>
              {products.map((p) => (
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
                  <Td className="text-gray-500">{p.validity_months} months</Td>
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
          <Button variant="outline" onClick={() => setSaleModal(true)}>
            Record a sale
          </Button>
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
              <Th>Parent</Th>
              <Th>Package</Th>
              <Th>Remaining</Th>
              <Th>Expires</Th>
              <Th>Status</Th>
              <Th>&nbsp;</Th>
            </Thead>
            <Tbody>
              {held.map((p) => {
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
                    <Td className="text-gray-500">
                      {p.expires_on ?? "—"}
                      {expired && (
                        <span className="ml-1 text-xs text-red-600">
                          expired
                        </span>
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
                        <Button
                          variant="outline"
                          onClick={() => setCancelling(p)}
                          disabled={busy}
                        >
                          Cancel
                        </Button>
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
                Months valid
              </label>
              <input
                value={pMonths}
                onChange={(e) => setPMonths(e.target.value)}
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
              activates the package and starts its{" "}
              {/* validity from today, not from the request date */}
              validity period from today.
            </>
          )}
        </p>
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
    </div>
  );
}
