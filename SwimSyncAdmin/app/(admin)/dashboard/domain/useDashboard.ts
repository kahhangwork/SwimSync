import { useEffect, useState } from "react";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import {
  countMetrics,
  loadOutstandingInvoices,
  loadUnassigned,
} from "../dao/dashboard.repo";
import { studentPackageCoverage } from "../dao/dashboard.rpc";
import type { InvoiceRow, Metrics, UnassignedRow } from "../types";

export function useDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedRow[]>([]);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(new Map());
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [
        { count: activeStudents },
        { count: unassignedCount },
        { count: outstandingInvoices },
        { count: totalCreditNotes },
        { count: totalCoaches },
        { count: totalClasses },
        { count: inactiveStudents },
      ] = await countMetrics();

      setMetrics({
        activeStudents: activeStudents ?? 0,
        inactiveStudents: inactiveStudents ?? 0,
        unassignedCount: unassignedCount ?? 0,
        outstandingInvoices: outstandingInvoices ?? 0,
        totalCreditNotes: totalCreditNotes ?? 0,
        totalCoaches: totalCoaches ?? 0,
        totalClasses: totalClasses ?? 0,
      });

      const { data: unassignedData } = await loadUnassigned();

      setUnassigned(
        (unassignedData ?? []).map((s: any) => ({
          id: s.id,
          full_name: s.full_name,
          parent_name:
            s.parent_students?.[0]?.parents?.profiles?.full_name ?? "—",
        }))
      );

      // Payment-method chip for the mini-table. Fire-and-forget: a failed RPC
      // means no chips, never a broken dashboard.
      studentPackageCoverage().then(({ data: cov }) =>
        setCovMap(coverageByStudent(cov ?? []))
      );

      const { data: invoiceData } = await loadOutstandingInvoices();

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

  return { metrics, unassigned, covMap, invoices, loading };
}
