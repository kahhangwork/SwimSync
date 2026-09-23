import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMyPay } from "@/features/coach-pay/domain/useMyPay";
import { PayoutCards } from "@/features/coach-pay/ui/PayoutCards";

// ⚠ THIS SCREEN DELIBERATELY SHOWS NO INVOICES.
//
// Until 2026-08-02 it was a full invoice list with Outstanding/Paid counts, a
// filter and a Mark Paid button — written before payment collection existed
// (PRD §7.21). Everything that makes an invoice actionable now lives on the
// admin panel: the `INV-YYYY-NNNN` reference, the dynamic PayNow QR, the
// WhatsApp reminder queue, the "parent says paid" badge and the Claimed
// filter. A second, poorer invoice list on the coach's phone is not a
// convenience — it is a place to make a money decision with less information
// than the admin panel would have given.
//
// Mark-paid is gone for the same reason. The one converged path,
// `confirm_invoice_paid()` (audit row included), is now reached only from the
// admin panel and the public invoice page. Do not re-add a caller here.
//
// What remains is the one billing fact that is genuinely the coach's own and
// has nowhere else to live: what they are paid.
//
// The load lives in features/coach-pay/domain/useMyPay (docs/refactor/BATCH_FGH_PLAN.md,
// app fence), the payout cards in …/ui/PayoutCards; the rest of the markup stays here.

export default function CoachPayScreen() {
  const { myPayouts, breakdowns, loading, loadData, totalPaid } = useMyPay();

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-5">
          <Text className="text-2xl font-bold text-gray-900">My Pay</Text>
          <Text className="text-sm text-gray-500 mt-0.5">
            What you&apos;re paid for teaching
          </Text>
        </View>

        {loading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : myPayouts.length === 0 ? (
          // Reachable only in a narrow window — the tab is hidden entirely
          // until a payout exists (lib/useCoachHasPayouts.ts) — but a payout
          // can be removed while the app is open, and a blank screen reads as
          // broken.
          <View className="items-center py-16">
            <Ionicons name="wallet-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3 text-center px-8">
              No pay periods yet. Your business&apos;s admin prepares these.
            </Text>
          </View>
        ) : (
          <>
            {totalPaid > 0 && (
              <View className="bg-green-50 rounded-2xl p-4 border border-green-100 items-center mb-5">
                <Text className="text-xs text-green-500">Paid to you so far</Text>
                <Text className="text-2xl font-bold text-green-600 mt-0.5">
                  S${totalPaid.toFixed(2)}
                </Text>
              </View>
            )}

            <Text className="text-sm font-semibold text-gray-900 mb-2">
              Your pay
            </Text>
            <PayoutCards myPayouts={myPayouts} breakdowns={breakdowns} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
