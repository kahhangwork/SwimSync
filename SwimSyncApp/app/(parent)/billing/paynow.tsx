import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Image,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";

type CoachQR = {
  coach_name: string;
  paynow_qr_url: string | null;
};

export default function PayNowScreen() {
  const { invoiceId, coachId } = useLocalSearchParams<{
    invoiceId: string;
    coachId: string;
  }>();

  const [netAmount, setNetAmount] = useState<number | null>(null);
  const [billingMonth, setBillingMonth] = useState<string | null>(null);
  const [coachQR, setCoachQR] = useState<CoachQR | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // The QR comes from the invoice's BUSINESS, not the coach who taught the
      // lesson. A school with three coaches has one bank account; showing an
      // individual coach's QR would send a parent's money to the wrong person.
      // For a private coach the tenant is theirs, so nothing changes for them.
      const invoiceRes = invoiceId
        ? await supabase
            .from("invoices")
            .select("net_amount, billing_month, tenants(display_name, paynow_qr_url)")
            .eq("id", invoiceId)
            .single()
        : { data: null as any };

      if (invoiceRes.data) {
        setNetAmount(Number(invoiceRes.data.net_amount));
        const [year, month] = invoiceRes.data.billing_month.split("-");
        const date = new Date(parseInt(year), parseInt(month) - 1, 1);
        setBillingMonth(
          date.toLocaleDateString("en-SG", { month: "long", year: "numeric" })
        );

        const t: any = Array.isArray((invoiceRes.data as any).tenants)
          ? (invoiceRes.data as any).tenants[0]
          : (invoiceRes.data as any).tenants;
        if (t) {
          setCoachQR({
            coach_name: t.display_name ?? "Your coach",
            paynow_qr_url: t.paynow_qr_url ?? null,
          });
        }
      }

      setLoading(false);
    }

    load();
    // coachId is still accepted in the route params for backwards
    // compatibility with existing links, but is no longer used to resolve the
    // payee — the invoice's tenant is authoritative.
  }, [invoiceId]);

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">PayNow Payment</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0ea5e9" />
        </View>
      ) : (
        <View className="flex-1 items-center px-6 pt-4">
          {/* Amount banner */}
          {netAmount !== null && (
            <View className="w-full bg-red-50 border border-red-100 rounded-2xl p-4 mb-6 items-center">
              <Text className="text-sm text-red-500 mb-1">Amount to Pay</Text>
              <Text className="text-3xl font-bold text-red-600">
                S${netAmount.toFixed(2)}
              </Text>
              {billingMonth && (
                <Text className="text-xs text-red-400 mt-1">{billingMonth}</Text>
              )}
            </View>
          )}

          {/* QR Code */}
          <View className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 items-center mb-6 w-full">
            <Text className="text-sm font-medium text-gray-500 mb-4">
              {coachQR?.coach_name ?? "Coach"}'s PayNow QR Code
            </Text>

            {coachQR?.paynow_qr_url ? (
              <Image
                source={{ uri: coachQR.paynow_qr_url }}
                className="w-52 h-52 rounded-2xl mb-4"
                resizeMode="contain"
              />
            ) : (
              <View className="w-52 h-52 bg-gray-100 rounded-2xl items-center justify-center mb-4">
                <Ionicons name="qr-code-outline" size={80} color="#9ca3af" />
                <Text className="text-xs text-gray-400 mt-2 text-center px-4">
                  QR not uploaded yet. Contact your coach directly.
                </Text>
              </View>
            )}

            <Text className="text-xs text-gray-400 text-center leading-relaxed">
              Scan the QR code above with your banking app to make a PayNow
              transfer. The amount shown above is for reference only.
            </Text>
          </View>

          {/* Instructions */}
          <View className="w-full bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <Text className="text-sm font-bold text-gray-900 mb-3">
              Payment Instructions
            </Text>
            {[
              "Open your banking app",
              "Tap Scan to Pay or QR",
              "Scan the QR code above",
              "Enter the exact amount shown",
              "Complete the transfer",
            ].map((step, i) => (
              <View key={i} className="flex-row gap-3 mb-2 items-start">
                <View className="w-5 h-5 rounded-full bg-sky-100 items-center justify-center mt-0.5">
                  <Text className="text-xs font-bold text-sky-600">{i + 1}</Text>
                </View>
                <Text className="text-sm text-gray-600 flex-1">{step}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
