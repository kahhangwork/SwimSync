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
import { Surface } from "@/components/ui/Surface";

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
  const { myPayouts, breakdowns, loading, loadData, totalPaid, totalPaidLabel } = useMyPay();

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <SafeAreaView className="flex-1 bg-ground">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-5">
          <Text className="text-display font-semibold text-ink">My Pay</Text>
          <Text className="text-body-secondary text-ink-secondary mt-0.5">
            What you&apos;re paid for teaching
          </Text>
        </View>

        {loading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator size="large" color="#2563eb" />
          </View>
        ) : myPayouts.length === 0 ? (
          // Reachable only in a narrow window — the tab is hidden entirely
          // until a payout exists (lib/useCoachHasPayouts.ts) — but a payout
          // can be removed while the app is open, and a blank screen reads as
          // broken.
          <View className="items-center py-16">
            <Ionicons name="wallet-outline" size={40} color="#6b6b6b" />
            <Text className="text-body text-ink-secondary mt-3 text-center px-8">
              No pay periods yet. Your business&apos;s admin prepares these.
            </Text>
          </View>
        ) : (
          <>
            {totalPaid > 0 && (
              // Money is Ink, never green (DESIGN.md: status lives in the
              // tag, not in the amount's colour). The figure is the hook's.
              <Surface className="items-center mb-5">
                <Text className="text-body-secondary text-ink-secondary">Paid to you so far</Text>
                <Text className="text-display font-semibold text-ink mt-0.5" style={{ fontVariant: ["tabular-nums"] }}>
                  {totalPaidLabel}
                </Text>
              </Surface>
            )}

            <Text className="text-headline font-semibold text-ink mb-2">
              Your pay
            </Text>
            <PayoutCards myPayouts={myPayouts} breakdowns={breakdowns} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
