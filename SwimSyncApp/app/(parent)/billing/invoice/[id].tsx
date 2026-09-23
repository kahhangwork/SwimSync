import React from "react";
import { ScrollView, SafeAreaView } from "react-native";
import { useInvoiceDetail } from "@/features/invoice-detail/domain/useInvoiceDetail";
import { LoadingView } from "@/features/invoice-detail/ui/LoadingView";
import { NotFoundView } from "@/features/invoice-detail/ui/NotFoundView";
import { Header } from "@/features/invoice-detail/ui/Header";
import { SummaryCard } from "@/features/invoice-detail/ui/SummaryCard";
import { LineItemsCard } from "@/features/invoice-detail/ui/LineItemsCard";
import { CreditNotesCard } from "@/features/invoice-detail/ui/CreditNotesCard";
import { PayActions } from "@/features/invoice-detail/ui/PayActions";

// The parent Invoice Detail screen — composition only (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). The load and the "I've paid" claim live in
// features/invoice-detail/domain/useInvoiceDetail, markup in …/ui. The two early
// returns keep their order: loading first, then not-found.
export default function InvoiceDetailScreen() {
  const { invoice, loading, claiming, claimPaid } = useInvoiceDetail();

  if (loading) {
    return <LoadingView />;
  }

  if (!invoice) {
    return <NotFoundView />;
  }

  const statusLabel = invoice.status === "outstanding" ? "Outstanding" : "Paid";

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <Header statusLabel={statusLabel} />

      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-4"
        showsVerticalScrollIndicator={false}
      >
        <SummaryCard invoice={invoice} />

        <LineItemsCard invoice={invoice} />

        <CreditNotesCard invoice={invoice} />

        <PayActions invoice={invoice} claiming={claiming} claimPaid={claimPaid} />
      </ScrollView>
    </SafeAreaView>
  );
}
