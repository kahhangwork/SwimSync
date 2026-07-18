import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import { confirmAction } from "@/lib/confirm";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";

type Filter = "All" | "Outstanding" | "Paid";

/** What this coach is owed. Read-only, and only ever their OWN — a colleague's
 *  earnings must not be inferable. RLS scopes it to their coaches.id. */
type MyPayout = {
  id: string;
  period_month: string;
  gross_amount: number;
  status: "draft" | "paid";
};

type Invoice = {
  id: string;
  billing_month: string;
  net_amount: number;
  status: "outstanding" | "paid";
  parent_name: string;
  student_names: string;
};

function formatBillingMonth(ym: string): string {
  const [year, month] = ym.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("en-SG", { month: "long", year: "numeric" });
}

export default function CoachBillingScreen() {
  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);
  const [filter, setFilter] = useState<Filter>("All");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [myPayouts, setMyPayouts] = useState<MyPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    // RLS scopes this to invoices for parents the coach serves.
    const { data, error } = await supabase
      .from("invoices")
      .select(
        "id, billing_month, net_amount, status, parents(profiles(full_name)), invoice_items(students(full_name))"
      )
      .order("billing_month", { ascending: false });

    if (error) {
      showToast("Could not load invoices", "error");
      setLoading(false);
      return;
    }

    // RLS returns only THIS coach's payouts (coach_payouts_select scopes to
    // current_coach_id()), so no filter is needed here — and a colleague's pay
    // is not reachable even by asking for it.
    const { data: payoutRows } = await supabase
      .from("coach_payouts")
      .select("id, period_month, gross_amount, status")
      .order("period_month", { ascending: false })
      .limit(6);
    setMyPayouts(
      (payoutRows ?? []).map((p: any) => ({
        id: p.id,
        period_month: p.period_month,
        gross_amount: Number(p.gross_amount),
        status: p.status,
      }))
    );

    setInvoices(
      (data ?? []).map((inv: any) => {
        const studentNames = [
          ...new Set(
            (inv.invoice_items ?? [])
              .map((item: any) => item.students?.full_name)
              .filter(Boolean)
          ),
        ].join(", ");
        return {
          id: inv.id,
          billing_month: inv.billing_month,
          net_amount: Number(inv.net_amount),
          status: inv.status,
          parent_name: inv.parents?.profiles?.full_name ?? "—",
          student_names: studentNames || "—",
        };
      })
    );
    setLoading(false);
  }, [showToast]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  async function markPaid(invoiceId: string) {
    if (!session) return;
    setMarkingPaid(invoiceId);
    const now = new Date().toISOString();

    const { error: invErr } = await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: now, paid_marked_by: session.id })
      .eq("id", invoiceId);

    if (invErr) {
      setMarkingPaid(null);
      showToast("Could not mark as paid", "error");
      return;
    }

    // Record the manual payment confirmation (PRD §9.13). Non-fatal if it fails.
    const { error: payErr } = await supabase
      .from("payment_records")
      .insert({ invoice_id: invoiceId, marked_by: session.id, paid_at: now });

    setMarkingPaid(null);
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === invoiceId ? { ...inv, status: "paid" } : inv
      )
    );
    showToast(
      payErr ? "Marked paid (record not logged)" : "Invoice marked as paid",
      payErr ? "info" : "success"
    );
  }

  function confirmMarkPaid(inv: Invoice) {
    confirmAction(
      "Mark as paid?",
      `Confirm you have received S$${inv.net_amount.toFixed(2)} for ${
        inv.parent_name
      } (${formatBillingMonth(inv.billing_month)}).`,
      () => markPaid(inv.id),
      "Mark Paid"
    );
  }

  const filtered =
    filter === "All"
      ? invoices
      : invoices.filter((i) =>
          filter === "Outstanding"
            ? i.status === "outstanding"
            : i.status === "paid"
        );

  const outstandingCount = invoices.filter(
    (i) => i.status === "outstanding"
  ).length;
  const paidCount = invoices.filter((i) => i.status === "paid").length;

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="mb-5">
          <Text className="text-2xl font-bold text-gray-900">Billing</Text>
          <Text className="text-sm text-gray-500 mt-0.5">
            Invoices for your students
          </Text>
        </View>

        {/* What YOU are paid. Only rendered when a payout exists — a private
            coach has no rate and no payouts, and showing them an empty "your
            pay" card would imply their own invoices are somehow incomplete. */}
        {myPayouts.length > 0 && (
          <View className="mb-5">
            <Text className="text-sm font-semibold text-gray-900 mb-2">
              Your pay
            </Text>
            {myPayouts.map((p) => (
              <Card key={p.id}>
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-base font-bold text-gray-900">
                      {formatBillingMonth(p.period_month)}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-0.5">
                      {p.status === "paid"
                        ? "Paid"
                        : "Draft — may still change until it's paid"}
                    </Text>
                  </View>
                  <Text
                    className={`text-lg font-bold ${
                      p.status === "paid" ? "text-green-600" : "text-gray-900"
                    }`}
                  >
                    S${p.gross_amount.toFixed(2)}
                  </Text>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Summary */}
        <View className="flex-row gap-3 mb-5">
          <View className="flex-1 bg-red-50 rounded-2xl p-3 border border-red-100 items-center">
            <Text className="text-2xl font-bold text-red-600">
              {outstandingCount}
            </Text>
            <Text className="text-xs text-red-400 mt-0.5">Outstanding</Text>
          </View>
          <View className="flex-1 bg-green-50 rounded-2xl p-3 border border-green-100 items-center">
            <Text className="text-2xl font-bold text-green-600">{paidCount}</Text>
            <Text className="text-xs text-green-400 mt-0.5">Paid</Text>
          </View>
        </View>

        {/* Filter tabs */}
        <View className="flex-row bg-gray-100 rounded-xl p-1 mb-4">
          {(["All", "Outstanding", "Paid"] as Filter[]).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              className={`flex-1 py-2 rounded-lg items-center ${
                filter === f ? "bg-white shadow-sm" : ""
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  filter === f ? "text-gray-900" : "text-gray-500"
                }`}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Invoice list */}
        {loading ? (
          <View className="items-center justify-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : filtered.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="receipt-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3">No invoices</Text>
          </View>
        ) : (
          <View className="gap-3">
            {filtered.map((inv) => (
              <Card key={inv.id}>
                <View className="flex-row items-start justify-between mb-2">
                  <View className="flex-1 pr-2">
                    <Text className="text-sm font-bold text-gray-900">
                      {inv.parent_name}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {inv.student_names}
                    </Text>
                    <Text className="text-xs text-gray-400 mt-0.5">
                      {formatBillingMonth(inv.billing_month)}
                    </Text>
                  </View>
                  <StatusBadge
                    status={inv.status === "outstanding" ? "Outstanding" : "Paid"}
                    size="sm"
                  />
                </View>

                <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <Text className="text-base font-bold text-gray-900">
                    S${inv.net_amount.toFixed(2)}
                  </Text>
                  {inv.status === "outstanding" ? (
                    <TouchableOpacity
                      disabled={markingPaid === inv.id}
                      onPress={() => confirmMarkPaid(inv)}
                      className="flex-row items-center gap-1.5 bg-green-500 px-3 py-1.5 rounded-full disabled:opacity-50"
                    >
                      <Ionicons name="checkmark" size={14} color="white" />
                      <Text className="text-white text-xs font-semibold">
                        {markingPaid === inv.id ? "Saving…" : "Mark Paid"}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View className="flex-row items-center gap-1">
                      <Ionicons
                        name="checkmark-circle"
                        size={16}
                        color="#16a34a"
                      />
                      <Text className="text-xs text-green-600 font-medium">
                        Paid
                      </Text>
                    </View>
                  )}
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
