import React from "react";
import { View, SafeAreaView, ActivityIndicator } from "react-native";
import { usePayNow } from "@/features/paynow/domain/usePayNow";
import { Header } from "@/features/paynow/ui/Header";
import { AmountBanner } from "@/features/paynow/ui/AmountBanner";
import { QrCard } from "@/features/paynow/ui/QrCard";
import { Instructions } from "@/features/paynow/ui/Instructions";

// The parent PayNow screen — composition only (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G). The load, the dynamic QR (built inside its original try — plan ⚠ R2)
// and the three derived flags live in features/paynow/domain/usePayNow, markup
// in …/ui.
export default function PayNowScreen() {
  const {
    netAmount,
    billingMonth,
    packageName,
    payee,
    loading,
    dynamicQr,
    reference,
    proxy,
    businessName,
    showPayableId,
    unconfigured,
  } = usePayNow();

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <Header />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : (
        <View className="flex-1 items-center px-6 pt-4">
          <AmountBanner netAmount={netAmount} billingMonth={billingMonth} packageName={packageName} />

          <QrCard businessName={businessName} dynamicQr={dynamicQr} payee={payee} showPayableId={showPayableId} proxy={proxy} netAmount={netAmount} reference={reference} unconfigured={unconfigured} />

          <Instructions unconfigured={unconfigured} showPayableId={showPayableId} reference={reference} dynamicQr={dynamicQr} />
        </View>
      )}
    </SafeAreaView>
  );
}
