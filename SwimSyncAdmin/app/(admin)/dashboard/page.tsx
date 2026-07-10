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
          .eq("assignment_status", "unassigned"),
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
  }, []);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Welcome back, Superadmin — here's your SwimSync overview"
      />

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
                <Th>Ability</Th>
              </tr>
            </Thead>
            <Tbody>
              {loading ? (
                <Tr>
                  <Td className="text-center text-gray-400 py-6" colSpan={3}>
                    Loading…
                  </Td>
                </Tr>
              ) : unassigned.length === 0 ? (
                <Tr>
                  <Td className="text-center text-gray-400 py-6" colSpan={3}>
                    No unassigned children
                  </Td>
                </Tr>
              ) : (
                unassigned.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium">{s.full_name}</Td>
                    <Td className="text-gray-500">{s.parent_name}</Td>
                    <Td>{s.swimming_ability ?? "—"}</Td>
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
