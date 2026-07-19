"use client";

import { useEffect, useState } from "react";
import { Users, UserX, Receipt, FileText, UserCog, Layers } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";

type Metrics = {
  totalStudents: number;
  unassignedCount: number;
  outstandingInvoices: number;
  totalCreditNotes: number;
  totalCoaches: number;
  totalClasses: number;
};

type TenantInfo = {
  id: string;
  display_name: string;
  join_code: string;
};

type UnassignedRow = {
  id: string;
  full_name: string;
  swimming_ability: string | null;
  parent_name: string;
};

type InvoiceRow = {
  id: string;
  billing_month: string;
  net_amount: number;
  parent_name: string;
};

function formatBillingMonth(ym: string): string {
  const [year, month] = ym.split("-");
  return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString(
    "en-SG",
    { month: "short", year: "numeric" }
  );
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  /**
   * Rename the business.
   *
   * The tenant's name is seeded from the COACH's name by the migration that
   * created it, which is right for a private coach and wrong for anyone who
   * trades under a different name ("Coach Kah Hang" vs "Coach Kah Hang Swimming
   * Lessons"). It also appears on invoices and invoice emails, so it needs to
   * be the business's own name, not an operator's.
   */
  async function handleSaveName() {
    if (!tenant) return;
    const next = nameDraft.trim();
    if (!next) return;
    setSavingName(true);
    const { error } = await supabase
      .from("tenants")
      .update({ display_name: next, updated_at: new Date().toISOString() })
      .eq("id", tenant.id);
    setSavingName(false);
    if (!error) {
      setTenant({ ...tenant, display_name: next });
      setEditingName(false);
    }
  }

  /**
   * Rotate the join code. Existing families keep their access — the code is an
   * invitation, not an ongoing credential — so this is safe to offer without a
   * scary confirmation.
   */
  async function handleRegenerate() {
    if (!tenant) return;
    setRegenerating(true);
    const { data, error } = await supabase.rpc("regenerate_join_code", {
      p_tenant_id: tenant.id,
    });
    setRegenerating(false);
    if (!error && data) setTenant({ ...tenant, join_code: data as string });
  }

  useEffect(() => {
    async function load() {
      const [
        { count: totalStudents },
        { count: unassignedCount },
        { count: outstandingInvoices },
        { count: totalCreditNotes },
        { count: totalCoaches },
        { count: totalClasses },
      ] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("assignment_status", "unassigned")
        .eq("is_active", true),
        supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("status", "outstanding"),
        supabase
          .from("credit_notes")
          .select("id", { count: "exact", head: true }),
        supabase.from("coaches").select("id", { count: "exact", head: true }),
        supabase
          .from("classes")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
      ]);

      setMetrics({
        totalStudents: totalStudents ?? 0,
        unassignedCount: unassignedCount ?? 0,
        outstandingInvoices: outstandingInvoices ?? 0,
        totalCreditNotes: totalCreditNotes ?? 0,
        totalCoaches: totalCoaches ?? 0,
        totalClasses: totalClasses ?? 0,
      });

      const { data: unassignedData } = await supabase
        .from("students")
        .select(
          "id, full_name, swimming_ability, parent_students(parents(profiles(full_name)))"
        )
        .eq("assignment_status", "unassigned")
        .eq("is_active", true)
        .order("full_name")
        .limit(5);

      setUnassigned(
        (unassignedData ?? []).map((s: any) => ({
          id: s.id,
          full_name: s.full_name,
          swimming_ability: s.swimming_ability,
          parent_name:
            s.parent_students?.[0]?.parents?.profiles?.full_name ?? "—",
        }))
      );

      const { data: invoiceData } = await supabase
        .from("invoices")
        .select(
          "id, billing_month, net_amount, parents(profiles(full_name))"
        )
        .eq("status", "outstanding")
        .order("generated_at", { ascending: false })
        .limit(5);

      setInvoices(
        (invoiceData ?? []).map((inv: any) => ({
          id: inv.id,
          billing_month: inv.billing_month,
          net_amount: Number(inv.net_amount),
          parent_name: inv.parents?.profiles?.full_name ?? "—",
        }))
      );

      setLoading(false);
    }

    load();

    // The admin's own business. A platform admin has no tenant, so the card
    // simply does not render for them.
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (!profile?.tenant_id) return;
      const { data: t } = await supabase
        .from("tenants")
        .select("id, display_name, join_code")
        .eq("id", profile.tenant_id)
        .maybeSingle();
      if (t) setTenant(t as TenantInfo);
    })();
  }, []);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          tenant
            ? `${tenant.display_name} — your SwimSync overview`
            : "Your SwimSync overview"
        }
      />

      {/* The join code is how families reach this business. There is no public
          directory of coaches, so without the code a parent cannot add a child
          here at all — which makes this the most operationally important thing
          on the page for a new school. */}
      {tenant && (
        <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2">
                {editingName ? (
                  <>
                    <input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      className="rounded-lg border border-sky-300 px-2 py-1 text-sm"
                      placeholder="Business name"
                    />
                    <button
                      onClick={handleSaveName}
                      disabled={savingName}
                      className="text-sm font-medium text-sky-800 underline disabled:opacity-50"
                    >
                      {savingName ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="text-sm text-sky-700"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-sky-900">
                      {tenant.display_name}
                    </span>
                    <button
                      onClick={() => {
                        setNameDraft(tenant.display_name);
                        setEditingName(true);
                      }}
                      className="text-xs font-medium text-sky-700 underline"
                    >
                      Rename
                    </button>
                  </>
                )}
              </div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                Parent join code
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tracking-widest text-sky-900">
                {tenant.join_code}
              </p>
              <p className="mt-1 text-sm text-sky-800">
                Share this with parents so they can add their children to your
                classes.
              </p>
            </div>
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="rounded-xl border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
            >
              {regenerating ? "Generating…" : "Generate a new code"}
            </button>
          </div>
          <p className="mt-3 text-xs text-sky-700">
            Generating a new code does not remove families who have already
            joined — it only stops the old code working for new ones.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <MetricCard
          title="Total Students"
          value={loading ? "—" : metrics?.totalStudents ?? 0}
          icon={Users}
          color="blue"
          subtitle="Across all coaches"
        />
        <MetricCard
          title="Unassigned Children"
          value={loading ? "—" : metrics?.unassignedCount ?? 0}
          icon={UserX}
          color="yellow"
          subtitle="Awaiting class assignment"
        />
        <MetricCard
          title="Outstanding Invoices"
          value={loading ? "—" : metrics?.outstandingInvoices ?? 0}
          icon={Receipt}
          color="red"
          subtitle="Unpaid"
        />
        <MetricCard
          title="Credit Notes"
          value={loading ? "—" : metrics?.totalCreditNotes ?? 0}
          icon={FileText}
          color="purple"
          subtitle="Total issued"
        />
        <MetricCard
          title="Active Coaches"
          value={loading ? "—" : metrics?.totalCoaches ?? 0}
          icon={UserCog}
          color="green"
        />
        <MetricCard
          title="Active Classes"
          value={loading ? "—" : metrics?.totalClasses ?? 0}
          icon={Layers}
          color="blue"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900">
              Unassigned Children
            </h2>
            <Link
              href="/unassigned"
              className="text-sm text-sky-500 hover:text-sky-600 font-medium"
            >
              View all →
            </Link>
          </div>
          <Table>
            <Thead>
              <tr>
                <Th>Student</Th>
                <Th>Parent</Th>
              </tr>
            </Thead>
            <Tbody>
              {loading ? (
                <Tr>
                  <Td className="text-center text-gray-400 py-6" colSpan={2}>
                    Loading…
                  </Td>
                </Tr>
              ) : unassigned.length === 0 ? (
                <Tr>
                  <Td className="text-center text-gray-400 py-6" colSpan={2}>
                    No unassigned children
                  </Td>
                </Tr>
              ) : (
                unassigned.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium">{s.full_name}</Td>
                    <Td className="text-gray-500">{s.parent_name}</Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900">
              Outstanding Invoices
            </h2>
            <Link
              href="/invoices"
              className="text-sm text-sky-500 hover:text-sky-600 font-medium"
            >
              View all →
            </Link>
          </div>
          <Table>
            <Thead>
              <tr>
                <Th>Parent</Th>
                <Th>Month</Th>
                <Th>Net</Th>
                <Th>Status</Th>
              </tr>
            </Thead>
            <Tbody>
              {loading ? (
                <Tr>
                  <Td className="text-center text-gray-400 py-6" colSpan={4}>
                    Loading…
                  </Td>
                </Tr>
              ) : invoices.length === 0 ? (
                <Tr>
                  <Td className="text-center text-gray-400 py-6" colSpan={4}>
                    No outstanding invoices
                  </Td>
                </Tr>
              ) : (
                invoices.map((inv) => (
                  <Tr key={inv.id}>
                    <Td className="font-medium">{inv.parent_name}</Td>
                    <Td className="text-gray-500">
                      {formatBillingMonth(inv.billing_month)}
                    </Td>
                    <Td className="font-semibold text-red-600">
                      S${inv.net_amount.toFixed(2)}
                    </Td>
                    <Td>
                      <StatusBadge status="Outstanding" />
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}
