"use client";

import { useEffect, useState } from "react";
import { CheckCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";

type InvoiceRow = {
  id: string;
  billing_month: string;
  gross_amount: number;
  credit_applied: number;
  net_amount: number;
  status: string;
  parent_name: string;
  student_names: string; // first invoice item's student name(s)
};

const STATUS_FILTERS = ["All", "Outstanding", "Paid"];

function formatBillingMonth(ym: string): string {
  const [year, month] = ym.split("-");
  return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString(
    "en-SG",
    { month: "short", year: "numeric" }
  );
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  // Invoice generation controls
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [genMonth, setGenMonth] = useState(currentMonth);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);
  const [autoEnabled, setAutoEnabled] = useState<boolean | null>(null);
  const [togglingAuto, setTogglingAuto] = useState(false);

  useEffect(() => {
    loadInvoices();
    loadAutoSetting();
  }, []);

  async function loadAutoSetting() {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "auto_invoice_enabled")
      .maybeSingle();
    setAutoEnabled(data ? data.value === true || data.value === "true" : true);
  }

  async function handleToggleAuto() {
    if (autoEnabled === null) return;
    setTogglingAuto(true);
    const next = !autoEnabled;
    const { error } = await supabase
      .from("app_settings")
      .update({ value: next, updated_at: new Date().toISOString() })
      .eq("key", "auto_invoice_enabled");
    if (!error) setAutoEnabled(next);
    setTogglingAuto(false);
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenResult(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    try {
      const res = await fetch("/api/generate-invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ billing_month: genMonth }),
      });
      const json = await res.json();
      if (!res.ok) {
        setGenResult(`Error: ${json.error ?? "generation failed"}`);
      } else {
        setGenResult(
          `Created ${json.invoices_created} invoice(s) for ${formatBillingMonth(
            genMonth
          )}.`
        );
        await loadInvoices();
      }
    } catch (e) {
      setGenResult(`Error: ${String(e)}`);
    }
    setGenerating(false);
  }

  async function loadInvoices() {
    setLoading(true);
    const { data } = await supabase
      .from("invoices")
      .select(
        "id, billing_month, gross_amount, credit_applied, net_amount, status, parents(profiles(full_name)), invoice_items(students(full_name))"
      )
      .order("generated_at", { ascending: false });

    setInvoices(
      (data ?? []).map((inv: any) => {
        const studentNames = [
          ...new Set(
            (inv.invoice_items ?? [])
              .map((item: any) => item.students?.full_name)
              .filter(Boolean)
          ),
        ].join(", ");
        return {
          id: inv.id,
          billing_month: inv.billing_month,
          gross_amount: Number(inv.gross_amount),
          credit_applied: Number(inv.credit_applied),
          net_amount: Number(inv.net_amount),
          status: inv.status,
          parent_name: inv.parents?.profiles?.full_name ?? "—",
          student_names: studentNames || "—",
        };
      })
    );
    setLoading(false);
  }

  async function handleMarkPaid(invoiceId: string) {
    setMarkingPaid(invoiceId);
    await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", invoiceId);
    setMarkingPaid(null);
    // Update state locally for instant feedback
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === invoiceId ? { ...inv, status: "paid" } : inv
      )
    );
  }

  const filtered = invoices.filter((inv) => {
    const matchSearch =
      inv.parent_name.toLowerCase().includes(search.toLowerCase()) ||
      inv.student_names.toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === "All" ||
      inv.status.toLowerCase() === statusFilter.toLowerCase();
    return matchSearch && matchStatus;
  });

  const totalOutstanding = invoices
    .filter((i) => i.status === "outstanding")
    .reduce((sum, i) => sum + i.net_amount, 0);

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={`Total outstanding: S$${totalOutstanding.toFixed(2)}`}
      />

      {/* Invoice generation panel */}
      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              Billing month
            </label>
            <input
              type="month"
              value={genMonth}
              onChange={(e) => setGenMonth(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
          <Button onClick={handleGenerate} disabled={generating}>
            <RefreshCw
              className={`h-4 w-4 ${generating ? "animate-spin" : ""}`}
            />
            {generating ? "Generating…" : "Generate Invoices"}
          </Button>

          {/* Auto-generation toggle */}
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs font-semibold text-gray-700">
                Automatic monthly generation
              </div>
              <div className="text-[11px] text-gray-400">
                Runs on the 1st for the previous month
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleAuto}
              disabled={togglingAuto || autoEnabled === null}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                autoEnabled ? "bg-sky-500" : "bg-gray-300"
              } disabled:opacity-50`}
              aria-pressed={!!autoEnabled}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  autoEnabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-500">
          Manual generation bills whatever attendance is marked for the chosen
          month (one invoice per parent, across all their children). It ignores
          the automatic on/off switch and never blocks the scheduled run.
        </p>
        {genResult && (
          <p
            className={`mt-2 text-sm font-medium ${
              genResult.startsWith("Error") ? "text-red-600" : "text-green-600"
            }`}
          >
            {genResult}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by parent or student..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 w-56"
        />
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                statusFilter === f
                  ? "bg-sky-500 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <Table>
        <Thead>
          <tr>
            <Th>Parent</Th>
            <Th>Student(s)</Th>
            <Th>Month</Th>
            <Th>Gross</Th>
            <Th>Credit</Th>
            <Th>Net</Th>
            <Th>Status</Th>
            <Th>Action</Th>
          </tr>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={8}>
                Loading…
              </Td>
            </Tr>
          ) : filtered.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={8}>
                No invoices found.
              </Td>
            </Tr>
          ) : (
            filtered.map((inv) => (
              <Tr key={inv.id}>
                <Td className="font-medium text-gray-900">{inv.parent_name}</Td>
                <Td className="text-gray-600 text-xs">{inv.student_names}</Td>
                <Td>{formatBillingMonth(inv.billing_month)}</Td>
                <Td>S${inv.gross_amount.toFixed(2)}</Td>
                <Td className="text-blue-600">
                  {inv.credit_applied > 0
                    ? `−S$${inv.credit_applied.toFixed(2)}`
                    : "—"}
                </Td>
                <Td
                  className={`font-semibold ${
                    inv.status === "outstanding"
                      ? "text-red-600"
                      : "text-green-600"
                  }`}
                >
                  S${inv.net_amount.toFixed(2)}
                </Td>
                <Td>
                  <StatusBadge
                    status={
                      inv.status === "outstanding" ? "Outstanding" : "Paid"
                    }
                  />
                </Td>
                <Td>
                  {inv.status === "outstanding" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={markingPaid === inv.id}
                      onClick={() => handleMarkPaid(inv.id)}
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      {markingPaid === inv.id ? "Saving…" : "Mark Paid"}
                    </Button>
                  )}
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
