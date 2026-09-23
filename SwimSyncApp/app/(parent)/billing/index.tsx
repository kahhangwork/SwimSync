import React, { useCallback } from "react";
import { View, ScrollView, SafeAreaView, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { useBilling } from "@/features/billing/domain/useBilling";
import { Header } from "@/features/billing/ui/Header";
import { Tabs } from "@/features/billing/ui/Tabs";
import { InvoicesTab } from "@/features/billing/ui/InvoicesTab";
import { PackagesTab } from "@/features/billing/ui/PackagesTab";
import { CreditNotesTab } from "@/features/billing/ui/CreditNotesTab";

// The parent Billing tab — composition only (docs/refactor/BATCH_FGH_PLAN.md, App L-G).
// The load, the list-card claim and the package request / cancel live in
// features/billing/domain/useBilling (queries in …/dao, the row mappings in
// …/billingFormat), markup in …/ui. The referral card is mounted by the Packages
// tab and loads itself (…/useReferral) — never hoisted here (plan ⚠ R4).
export default function BillingScreen() {
  const {
    activeTab,
    setActiveTab,
    invoices,
    creditNotes,
    packages,
    products,
    requestingId,
    packageError,
    loading,
    claimingId,
    claimPaid,
    loadData,
    requestPackage,
    cancelRequest,
  } = useBilling();

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <Header />

      <Tabs activeTab={activeTab} setActiveTab={setActiveTab} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="px-5 pb-10 gap-3"
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "Invoices" ? (
            <InvoicesTab invoices={invoices} claimPaid={claimPaid} claimingId={claimingId} />
          ) : activeTab === "Packages" ? (
            <PackagesTab packageError={packageError} packages={packages} products={products} requestingId={requestingId} requestPackage={requestPackage} cancelRequest={cancelRequest} />
          ) : (
            <CreditNotesTab creditNotes={creditNotes} />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
