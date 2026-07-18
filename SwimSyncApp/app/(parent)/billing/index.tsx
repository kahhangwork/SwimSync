import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";

type Tab = "Invoices" | "Credit Notes";

type Invoice = {
  id: string;
  billing_month: string;
  gross_amount: number;
  credit_applied: number;
  net_amount: number;
  status: "outstanding" | "paid";
  /** Which business issued it. A parent may deal with several, and an
   *  ungrouped list gives no way to tell whose bill is whose. */
  tenant_id: string;
  business_name: string;
};

type CreditNote = {
  id: string;
  reference_number: string;
  amount: number;
  issued_at: string;
  original_status: string;
  corrected_status: string;
  reason: string | null;
  applied_to_invoice_id: string | null;
};

function formatBillingMonth(ym: string): string {
  const [year, month] = ym.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("en-SG", { month: "long", year: "numeric" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");
}

export default function BillingScreen() {
  const session = useAppStore((s) => s.session);
  const [activeTab, setActiveTab] = useState<Tab>("Invoices");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    const { data: parent } = await supabase
      .from("parents")
      .select("id")
      .eq("profile_id", session.id)
      .single();

    if (!parent) {
      setLoading(false);
      return;
    }

    const [invoicesRes, creditNotesRes] = await Promise.all([
      supabase
        .from("invoices")
        .select("id, billing_month, gross_amount, credit_applied, net_amount, status, tenant_id, tenants(display_name)")
        .eq("parent_id", parent.id)
        .order("billing_month", { ascending: false }),

      supabase
        .from("credit_notes")
        .select("id, reference_number, amount, issued_at, original_status, corrected_status, reason, applied_to_invoice_id")
        .eq("parent_id", parent.id)
        .order("issued_at", { ascending: false }),
    ]);

    setInvoices(
      (invoicesRes.data ?? []).map((inv: any) => {
        const t = Array.isArray(inv.tenants) ? inv.tenants[0] : inv.tenants;
        return {
          ...inv,
          gross_amount: Number(inv.gross_amount),
          credit_applied: Number(inv.credit_applied),
          net_amount: Number(inv.net_amount),
          business_name: t?.display_name ?? "Your coach",
        };
      })
    );
    setCreditNotes(creditNotesRes.data ?? []);
    setLoading(false);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="px-5 pt-5 pb-3">
        <Text className="text-2xl font-bold text-gray-900">Billing</Text>
        <Text className="text-sm text-gray-500 mt-0.5">
          Invoices and credit notes
        </Text>
      </View>

      {/* Tabs */}
      <View className="flex-row mx-5 mb-4 bg-gray-100 rounded-xl p-1">
        {(["Invoices", "Credit Notes"] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-lg items-center ${
              activeTab === tab ? "bg-white shadow-sm" : ""
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                activeTab === tab ? "text-gray-900" : "text-gray-500"
              }`}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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
            invoices.length === 0 ? (
              <View className="items-center py-16">
                <Ionicons name="receipt-outline" size={40} color="#d1d5db" />
                <Text className="text-gray-400 mt-3">No invoices yet</Text>
              </View>
            ) : (
              invoices.map((inv) => (
                <TouchableOpacity
                  key={inv.id}
                  onPress={() => router.push(`/(parent)/billing/invoice/${inv.id}`)}
                  activeOpacity={0.8}
                >
                  <Card>
                    <View className="flex-row items-start justify-between mb-3">
                      <View>
                        <Text className="text-base font-bold text-gray-900">
                          {formatBillingMonth(inv.billing_month)}
                        </Text>
                        {/* WHO is asking for money. With children at two
                            businesses a parent gets two invoices in the same
                            month, and without this they are indistinguishable. */}
                        <Text className="text-xs font-medium text-sky-600 mt-0.5">
                          {inv.business_name}
                        </Text>
                        <Text className="text-xs text-gray-500 mt-0.5">
                          Invoice #{inv.id.slice(0, 8).toUpperCase()}
                        </Text>
                      </View>
                      <StatusBadge
                        status={inv.status === "outstanding" ? "Outstanding" : "Paid"}
                        size="sm"
                      />
                    </View>

                    <View className="gap-1">
                      <View className="flex-row justify-between">
                        <Text className="text-sm text-gray-500">Gross</Text>
                        <Text className="text-sm text-gray-700">
                          S${inv.gross_amount.toFixed(2)}
                        </Text>
                      </View>
                      {inv.credit_applied > 0 && (
                        <View className="flex-row justify-between">
                          <Text className="text-sm text-blue-500">Credit Applied</Text>
                          <Text className="text-sm text-blue-500">
                            −S${inv.credit_applied.toFixed(2)}
                          </Text>
                        </View>
                      )}
                      <View className="flex-row justify-between pt-1 border-t border-gray-100 mt-1">
                        <Text className="text-sm font-bold text-gray-900">Net Amount</Text>
                        <Text
                          className={`text-sm font-bold ${
                            inv.status === "outstanding"
                              ? "text-red-600"
                              : "text-green-600"
                          }`}
                        >
                          S${inv.net_amount.toFixed(2)}
                        </Text>
                      </View>
                    </View>

                    <View className="flex-row items-center justify-end mt-3 gap-1">
                      <Text className="text-xs text-sky-500">View Details</Text>
                      <Ionicons name="chevron-forward" size={13} color="#0ea5e9" />
                    </View>
                  </Card>
                </TouchableOpacity>
              ))
            )
          ) : creditNotes.length === 0 ? (
            <View className="items-center py-16">
              <Ionicons name="document-outline" size={40} color="#d1d5db" />
              <Text className="text-gray-400 mt-3">No credit notes</Text>
            </View>
          ) : (
            creditNotes.map((cn) => (
              <Card key={cn.id}>
                <View className="flex-row items-start justify-between mb-2">
                  <View>
                    <Text className="text-base font-bold text-gray-900">
                      {cn.reference_number}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-0.5">
                      {formatDate(cn.issued_at)}
                    </Text>
                  </View>
                  <StatusBadge
                    status={cn.applied_to_invoice_id ? "Applied" : "Available"}
                    size="sm"
                  />
                </View>
                <Text className="text-xs text-gray-500 mb-1">
                  {capitalize(cn.original_status)} → {capitalize(cn.corrected_status)}
                </Text>
                {cn.reason ? (
                  <Text className="text-sm text-gray-600 mb-2">{cn.reason}</Text>
                ) : null}
                <View className="flex-row justify-between pt-2 border-t border-gray-100">
                  <Text className="text-sm text-gray-500">Credit Amount</Text>
                  <Text className="text-sm font-bold text-blue-600">
                    S${Number(cn.amount).toFixed(2)}
                  </Text>
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
