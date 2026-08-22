"use client";

// Families at this business.
//
// There was no admin Parents page at all before this — ten admin pages and none
// of them listed the people who actually pay. That is why marking a family
// inactive needed a screen rather than a button.
//
// "Inactive" here means inactive AT THIS BUSINESS, not globally: parents are
// deliberately global (a family may have one child at a school and another with
// a private coach), so activity lives on parent_tenants. Nothing here can lock
// anyone out of the app — that is a platform power and this page does not have
// it.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { setFamilyActive } from "@/lib/studentStatus";
import { familyLessonsByParent, familyLabel } from "@/lib/packageCoverage";
import { PackageChip } from "@/components/PackageChip";
import { todayInSg } from "@/lib/lessonDates";

type Child = { id: string; full_name: string; is_active: boolean };

type FamilyRow = {
  parent_id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  inactivated_at: string | null;
  children: Child[];
};

export default function ParentsPage() {
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Defaults to SHOWING everything. A hide-by-default filter that is subtly
  // wrong looks exactly like data loss to the admin, so the safe default ships
  // first and the default flips once this page has been seen against real data.
  const [showInactive, setShowInactive] = useState(true);
  const [pending, setPending] = useState<FamilyRow | null>(null);
  const [pkgByParent, setPkgByParent] = useState<Map<string, number>>(
    new Map()
  );
  const [takeChildren, setTakeChildren] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    // RLS scopes this to the caller's own business — parent_tenants_select
    // hides other businesses' memberships, which is why no tenant filter is
    // written here.
    const { data } = await supabase
      .from("parent_tenants")
      .select(
        "parent_id, tenant_id, is_active, inactivated_at, parents(profiles(full_name, email, phone))"
      );

    const rows = (data ?? []) as any[];
    const parentIds = rows.map((r) => r.parent_id);

    // Family-grain payment method: this page's rows are parents, so the
    // question is "does this family hold a live package here", not the
    // per-child category match (that is the Students page's chip).
    const { data: live } = await supabase.rpc("package_live_balances");
    setPkgByParent(familyLessonsByParent(live ?? [], todayInSg()));

    const { data: kids } = await supabase
      .from("parent_students")
      .select("parent_id, students(id, full_name, is_active, tenant_id)")
      .in("parent_id", parentIds.length ? parentIds : ["00000000-0000-0000-0000-000000000000"]);

    setFamilies(
      rows.map((r) => {
        const profile = r.parents?.profiles ?? {};
        return {
          parent_id: r.parent_id,
          tenant_id: r.tenant_id,
          full_name: profile.full_name ?? "—",
          email: profile.email ?? "—",
          phone: profile.phone ?? null,
          is_active: r.is_active,
          inactivated_at: r.inactivated_at,
          // Only children AT THIS BUSINESS. A sibling elsewhere is another
          // admin's concern and must not be actionable from here.
          children: (kids ?? [])
            .filter(
              (k: any) => k.parent_id === r.parent_id && k.students?.tenant_id === r.tenant_id
            )
            .map((k: any) => ({
              id: k.students.id,
              full_name: k.students.full_name,
              is_active: k.students.is_active,
            })),
        };
      })
    );
    setLoading(false);
  }

  function openModal(f: FamilyRow) {
    setTakeChildren(true);
    setActionError(null);
    setPending(f);
  }

  async function apply() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    const activeKids = pending.children.filter((c) => c.is_active).map((c) => c.id);
    const { error } = await setFamilyActive(
      supabase,
      pending.parent_id,
      pending.tenant_id,
      !pending.is_active,
      // Reactivating never touches children: status only, and the admin places
      // them deliberately. Deactivating cascades to the children shown.
      pending.is_active && takeChildren ? activeKids : []
    );
    setBusy(false);
    if (error) {
      setActionError(error);
      return;
    }
    setPending(null);
    await load();
  }

  const filtered = families.filter((f) => {
    const matchSearch =
      f.full_name.toLowerCase().includes(search.toLowerCase()) ||
      f.email.toLowerCase().includes(search.toLowerCase());
    return matchSearch && (showInactive || f.is_active);
  });

  const activeChildCount = (f: FamilyRow) => f.children.filter((c) => c.is_active).length;

  const sort = useTableSort<FamilyRow>({
    key: "full_name",
    accessors: {
      // Sort by the count, not by "1 of 1 active" — as text, 10 sorts before 2.
      children: (f) => activeChildCount(f),
      // Active first when ascending: `true` sorts after `false`, and the rows
      // an admin acts on are the active ones.
      is_active: (f) => !f.is_active,
    },
  });

  const visible = sort.apply(filtered);

  return (
    <div>
      <PageHeader
        title="Parents"
        subtitle={`${families.length} families at this business`}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by parent name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 w-72"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Include inactive
        </label>
      </div>

      <Table>
        <Thead>
          <Th sort={sort} sortKey="full_name">Parent</Th>
          <Th sort={sort} sortKey="email">Contact</Th>
          <Th sort={sort} sortKey="is_active">Status</Th>
          <Th>Payment</Th>
          <Th sort={sort} sortKey="children">Children here</Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={6}>
                Loading…
              </Td>
            </Tr>
          ) : visible.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={6}>
                No families found.
              </Td>
            </Tr>
          ) : (
            visible.map((f) => (
              <Tr key={`${f.parent_id}:${f.tenant_id}`}>
                <Td className="font-medium text-gray-900">{f.full_name}</Td>
                <Td className="text-gray-500">
                  <div>{f.email}</div>
                  {f.phone && <div className="text-xs">{f.phone}</div>}
                </Td>
                <Td>
                  <StatusBadge status={f.is_active ? "Active" : "Inactive"} />
                </Td>
                <Td>
                  <PackageChip
                    coverage={familyLabel(pkgByParent, f.parent_id)}
                    title={
                      pkgByParent.has(f.parent_id)
                        ? "The family's prepaid lessons remaining at your business, counting attended-but-uninvoiced lessons"
                        : "No prepaid package — this family is billed per lesson by invoice"
                    }
                  />
                </Td>
                <Td className="text-gray-500">
                  {f.children.length === 0 ? (
                    "—"
                  ) : (
                    <span>
                      {activeChildCount(f)} of {f.children.length} active
                      {/* An active family with no active children is the state
                          the prompted cascade can legitimately create. Surfaced
                          rather than prevented — a trigger enforcing it would
                          undo join-code reactivation. */}
                      {f.is_active && activeChildCount(f) === 0 && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                          none active
                        </span>
                      )}
                    </span>
                  )}
                </Td>
                <Td>
                  <button
                    onClick={() => openModal(f)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                      f.is_active
                        ? "border-red-200 text-red-600 hover:bg-red-50"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {f.is_active ? "Set inactive" : "Reactivate"}
                  </button>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      <Modal
        title={
          pending?.is_active
            ? `Mark ${pending.full_name} inactive?`
            : `Reactivate ${pending?.full_name}?`
        }
        open={pending !== null}
        onClose={() => setPending(null)}
      >
        {pending && (
          <div className="space-y-4">
            {pending.is_active ? (
              <>
                <p className="text-sm text-gray-600">
                  They stop appearing in your lists and stop counting toward
                  attendance here. This only affects{" "}
                  <strong>your business</strong> — if they also have a child with
                  another coach, that is untouched.
                </p>
                {activeChildCount(pending) > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <p className="text-sm font-medium text-amber-900">
                      They have {activeChildCount(pending)} active{" "}
                      {activeChildCount(pending) === 1 ? "child" : "children"}{" "}
                      here.
                    </p>
                    <label className="flex items-start gap-2 text-sm text-amber-900">
                      <input
                        type="radio"
                        className="mt-1"
                        checked={takeChildren}
                        onChange={() => setTakeChildren(true)}
                      />
                      <span>
                        Mark{" "}
                        {pending.children
                          .filter((c) => c.is_active)
                          .map((c) => c.full_name)
                          .join(", ")}{" "}
                        inactive too
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm text-amber-900">
                      <input
                        type="radio"
                        className="mt-1"
                        checked={!takeChildren}
                        onChange={() => setTakeChildren(false)}
                      />
                      <span>Just the parent — leave the children attending</span>
                    </label>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-600">
                They reappear in your lists. Their{" "}
                <strong>children stay inactive</strong> — reactivate and assign
                each one deliberately, so nobody lands on the wrong roster.
              </p>
            )}

            <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Nothing is deleted. Attendance, invoices and any credit balance are
              kept exactly as they are.
              {pending.is_active && (
                <>
                  {" "}
                  A <strong>pending charge</strong> (money the family owes) must be
                  settled or written off — on the Invoices page — before they can be
                  set inactive.
                </>
              )}
            </p>

            {actionError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {actionError}
              </p>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button className="flex-1" disabled={busy} onClick={apply}>
                {busy
                  ? "Saving…"
                  : pending.is_active
                    ? "Set inactive"
                    : "Reactivate"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
