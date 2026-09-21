import { Users, UserX, Receipt, FileText, UserCog, Layers } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { inactiveNote } from "@/lib/studentCounts";
import type { Metrics } from "../types";

type Props = { metrics: Metrics | null; loading: boolean };

export function MetricGrid({ metrics, loading }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
      <MetricCard
        title="Active Students"
        value={loading ? "—" : metrics?.activeStudents ?? 0}
        icon={Users}
        color="blue"
        // "Across all coaches" is kept because it is real information — the
        // count is business-wide, not per-coach. The inactive note APPENDS to
        // it rather than replacing it, and is empty at zero.
        subtitle={`Across all coaches${inactiveNote(metrics?.inactiveStudents ?? 0)}`}
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
  );
}
