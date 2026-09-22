"use client";

import { PageHeader } from "@/components/PageHeader";
import { useDashboard } from "./domain/useDashboard";
import { useTenantCard } from "./domain/useTenantCard";
import { useBillingAlert } from "./domain/useBillingAlert";
import { BillingAlert } from "./ui/BillingAlert";
import { MetricGrid } from "./ui/MetricGrid";
import { OutstandingMini } from "./ui/OutstandingMini";
import { TenantCard } from "./ui/TenantCard";
import { UnassignedMini } from "./ui/UnassignedMini";

export default function DashboardPage() {
  const { metrics, unassigned, covMap, invoices, loading } = useDashboard();
  const card = useTenantCard();
  const billing = useBillingAlert();

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          card.tenant
            ? `${card.tenant.display_name} — your SwimSync overview`
            : "Your SwimSync overview"
        }
      />

      <BillingAlert summary={billing.summary} />

      {card.tenant && (
        <TenantCard
          tenant={card.tenant}
          editingName={card.editingName}
          setEditingName={card.setEditingName}
          nameDraft={card.nameDraft}
          setNameDraft={card.setNameDraft}
          savingName={card.savingName}
          handleSaveName={card.handleSaveName}
          regenerating={card.regenerating}
          handleRegenerate={card.handleRegenerate}
        />
      )}

      <MetricGrid metrics={metrics} loading={loading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <UnassignedMini
          unassigned={unassigned}
          covMap={covMap}
          loading={loading}
        />
        <OutstandingMini invoices={invoices} loading={loading} />
      </div>
    </div>
  );
}
