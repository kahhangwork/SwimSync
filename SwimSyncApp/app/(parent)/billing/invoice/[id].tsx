import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";

type InvoiceItem = {
  id: string;
  student_name: string;
  class_title: string;
  session_date: string;
  attendance_status: string;
  amount: number;
};

type CreditNoteApplied = {
  id: string;
  reference_number: string;
  amount: number;
  reason: string | null;
};

type InvoiceDetail = {
  id: string;
  billing_month: string;
  gross_amount: number;
  credit_applied: number;
  net_amount: number;
  status: "outstanding" | "paid";
  generated_at: string;
  paid_at: string | null;
  items: InvoiceItem[];
  credit_notes: CreditNoteApplied[];
  coach_id: string | null;
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

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const { data: inv } = await supabase
        .from("invoices")
        .select(`
          id,
          billing_month,
          gross_amount,
          credit_applied,
          net_amount,
          status,
          generated_at,
          paid_at,
          invoice_items(
            id,
            lesson_session_id,
            amount,
            class_title,
            session_date,
            attendance_status,
            students(full_name)
          )
        `)
        .eq("id", id)
        .single();

      if (!inv) {
        setLoading(false);
        return;
      }

      // Fetch credit notes applied to this invoice
      const { data: cns } = await supabase
        .from("credit_notes")
        .select("id, reference_number, amount, reason")
        .eq("applied_to_invoice_id", id);

      // Get coach id via first invoice item's lesson session.
      // NB: look up by lesson_session_id (not the invoice_item id).
      let coachId: string | null = null;
      if (inv.invoice_items?.length > 0) {
        const firstItem = inv.invoice_items[0];
        const { data: ls } = await supabase
          .from("lesson_sessions")
          .select("classes(coach_id)")
          .eq("id", firstItem.lesson_session_id)
          .single();
        coachId = (ls as any)?.classes?.coach_id ?? null;
      }

      setInvoice({
        id: inv.id,
        billing_month: inv.billing_month,
        gross_amount: Number(inv.gross_amount),
        credit_applied: Number(inv.credit_applied),
        net_amount: Number(inv.net_amount),
        status: inv.status,
        generated_at: inv.generated_at,
        paid_at: inv.paid_at,
        items: (inv.invoice_items ?? [])
          .map((item: any) => ({
            id: item.id,
            student_name: item.students?.full_name ?? "—",
            class_title: item.class_title,
            session_date: item.session_date,
            attendance_status: item.attendance_status,
            amount: Number(item.amount),
          }))
          .sort((a: InvoiceItem, b: InvoiceItem) =>
            a.session_date.localeCompare(b.session_date)
          ),
        credit_notes: (cns ?? []).map((cn: any) => ({
          ...cn,
          amount: Number(cn.amount),
        })),
        coach_id: coachId,
      });

      setLoading(false);
    }

    load();
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  if (!invoice) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center px-6">
        <Ionicons name="alert-circle-outline" size={40} color="#d1d5db" />
        <Text className="text-gray-400 mt-3 text-center">
          Could not load invoice.
        </Text>
        <TouchableOpacity onPress={() => router.back()} className="mt-4">
          <Text className="text-sky-500 font-semibold">Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const statusLabel = invoice.status === "outstanding" ? "Outstanding" : "Paid";

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900 flex-1">Invoice Detail</Text>
        <StatusBadge status={statusLabel} size="sm" />
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-4"
        showsVerticalScrollIndicator={false}
      >
        {/* Summary card */}
        <Card>
          <Text className="text-base font-bold text-gray-900 mb-1">
            {formatBillingMonth(invoice.billing_month)}
          </Text>
          <Text className="text-xs text-gray-500 mb-1">
            Generated {formatDate(invoice.generated_at)}
          </Text>
          {invoice.paid_at && (
            <Text className="text-xs text-green-600 mb-3">
              Paid {formatDate(invoice.paid_at)}
            </Text>
          )}

          <View className="gap-2 mt-2">
            <View className="flex-row justify-between">
              <Text className="text-sm text-gray-500">Gross Amount</Text>
              <Text className="text-sm text-gray-700">
                S${invoice.gross_amount.toFixed(2)}
              </Text>
            </View>
            {invoice.credit_applied > 0 && (
              <View className="flex-row justify-between">
                <Text className="text-sm text-blue-500">Credit Applied</Text>
                <Text className="text-sm text-blue-500">
                  −S${invoice.credit_applied.toFixed(2)}
                </Text>
              </View>
            )}
            <View className="flex-row justify-between pt-2 border-t border-gray-100">
              <Text className="text-base font-bold text-gray-900">Net Payable</Text>
              <Text
                className={`text-base font-bold ${
                  invoice.status === "outstanding"
                    ? "text-red-600"
                    : "text-green-600"
                }`}
              >
                S${invoice.net_amount.toFixed(2)}
              </Text>
            </View>
          </View>
        </Card>

        {/* Line items */}
        <Card>
          <Text className="text-base font-bold text-gray-900 mb-3">
            Lesson Breakdown
          </Text>
          <View className="gap-2">
            {invoice.items.map((item) => (
              <View
                key={item.id}
                className="flex-row justify-between py-2 border-b border-gray-50"
              >
                <View className="flex-1">
                  <Text className="text-sm text-gray-700">{item.class_title}</Text>
                  <Text className="text-xs text-gray-400">
                    {formatDate(item.session_date)} · {item.student_name}
                  </Text>
                  <Text className="text-xs text-gray-400">
                    {capitalize(item.attendance_status)}
                  </Text>
                </View>
                <Text className="text-sm font-medium text-gray-800">
                  S${item.amount.toFixed(2)}
                </Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Credit notes applied */}
        {invoice.credit_notes.length > 0 && (
          <Card>
            <Text className="text-base font-bold text-gray-900 mb-3">
              Credit Notes Applied
            </Text>
            {invoice.credit_notes.map((cn) => (
              <View
                key={cn.id}
                className="flex-row justify-between py-2 border-b border-gray-50"
              >
                <View className="flex-1">
                  <Text className="text-sm text-gray-700">{cn.reference_number}</Text>
                  {cn.reason ? (
                    <Text className="text-xs text-gray-400">{cn.reason}</Text>
                  ) : null}
                </View>
                <Text className="text-sm font-medium text-blue-600">
                  −S${cn.amount.toFixed(2)}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* PayNow CTA */}
        {invoice.status === "outstanding" && (
          <PrimaryButton
            label="Pay via PayNow QR"
            onPress={() =>
              router.push(
                `/(parent)/billing/paynow?invoiceId=${invoice.id}&coachId=${invoice.coach_id ?? ""}`
              )
            }
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
