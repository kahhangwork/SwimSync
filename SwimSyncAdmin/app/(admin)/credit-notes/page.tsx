"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";

type CreditNoteRow = {
  id: string;
  reference_number: string;
  student_name: string;
  parent_name: string;
  amount: number;
  reason: string | null;
  linked_invoice_id: string | null;
  created_at: string;
  status: string; // "applied" | "available"
};

const STATUS_FILTERS = ["All", "Applied", "Available"];

export default function CreditNotesPage() {
  const [notes, setNotes] = useState<CreditNoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("credit_notes")
        .select(
          "id, reference_number, amount, reason, status, applied_to_invoice_id, issued_at, student_name, students(full_name), parents(profiles(full_name))"
        )
        .order("issued_at", { ascending: false });

      setNotes(
        (data ?? []).map((cn: any) => ({
          id: cn.id,
          reference_number: cn.reference_number,
          student_name: cn.student_name ?? cn.students?.full_name ?? "—",
          parent_name: cn.parents?.profiles?.full_name ?? "—",
          amount: Number(cn.amount),
          reason: cn.reason,
          linked_invoice_id: cn.applied_to_invoice_id,
          created_at: cn.issued_at?.split("T")[0] ?? "—",
          status: cn.status,
        }))
      );
      setLoading(false);
    }

    load();
  }, []);

  const filtered = notes.filter((cn) => {
    const matchSearch =
      cn.student_name.toLowerCase().includes(search.toLowerCase()) ||
      cn.parent_name.toLowerCase().includes(search.toLowerCase()) ||
      cn.reference_number.toLowerCase().includes(search.toLowerCase());
    const label =
      cn.status === "applied" ? "Applied" : "Available";
    const matchStatus = statusFilter === "All" || label === statusFilter;
    return matchSearch && matchStatus;
  });

  const sort = useTableSort<CreditNoteRow>({
    key: "created_at",
    dir: "desc",
    accessors: {
      status: (cn) => (cn.status === "applied" ? "Applied" : "Available"),
    },
  });
  const visible = sort.apply(filtered);

  return (
    <div>
      <PageHeader
        title="Credit Notes"
        subtitle="Read-only — auto-issued when attendance is corrected post-invoice"
      />

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by student, parent or ref..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 w-64"
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
          <Th sort={sort} sortKey="reference_number">Reference</Th>
          <Th sort={sort} sortKey="student_name">Student</Th>
          <Th sort={sort} sortKey="parent_name">Parent</Th>
          <Th sort={sort} sortKey="amount" firstDir="desc">Amount</Th>
          <Th sort={sort} sortKey="reason" wrap>Reason</Th>
          <Th sort={sort} sortKey="linked_invoice_id">Linked Invoice</Th>
          <Th sort={sort} sortKey="created_at" firstDir="desc">Date</Th>
          <Th sort={sort} sortKey="status">Status</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={8}>
                Loading…
              </Td>
            </Tr>
          ) : visible.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={8}>
                No credit notes found.
              </Td>
            </Tr>
          ) : (
            visible.map((cn) => (
              <Tr key={cn.id}>
                <Td className="font-mono text-xs text-gray-700">
                  {cn.reference_number}
                </Td>
                <Td className="font-medium text-gray-900">{cn.student_name}</Td>
                <Td className="text-gray-500">{cn.parent_name}</Td>
                <Td className="font-semibold text-blue-600">
                  S${cn.amount.toFixed(2)}
                </Td>
                <Td className="text-gray-500" wrap>
                  {cn.reason ?? "—"}
                </Td>
                <Td className="font-mono text-xs text-gray-500">
                  {cn.linked_invoice_id
                    ? cn.linked_invoice_id.slice(0, 8) + "…"
                    : "—"}
                </Td>
                <Td className="text-gray-500">{cn.created_at}</Td>
                <Td>
                  <StatusBadge
                    status={cn.status === "applied" ? "Applied" : "Available"}
                  />
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
