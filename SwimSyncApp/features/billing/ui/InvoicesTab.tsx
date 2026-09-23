// The Invoices tab: the empty state, or one card per invoice with Pay and I've paid.
// Moved VERBATIM from app/(parent)/billing/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import { invoiceLabel } from "@/lib/invoiceLabel";
import { formatBillingMonth } from "../domain/billingFormat";
import type { useBilling } from "../domain/useBilling";

type Billing = ReturnType<typeof useBilling>;

export function InvoicesTab(p: Pick<Billing, "invoices" | "claimPaid" | "claimingId">) {
  const { invoices, claimPaid, claimingId } = p;
  return (
    <>
      {
        invoices.length === 0 ? (
          <View className="items-center py-16">
            <Ionicons name="receipt-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3">No invoices yet</Text>
          </View>
        ) : (
          invoices.map((inv) => (
            /* `Card` is the OUTER element and the action row below is a
               SIBLING of the touchable, not nested inside it — so the
               buttons cannot depend on responder semantics to work.

               ⚠ AND THE FEARED BUG DOES NOT EXIST — MEASURED, 2026-08-08.
               This was built to prevent a double-fire: `confirmAction` is a
               synchronous, blocking `window.confirm` on RN-web
               (lib/confirm.ts), so a press that ALSO bubbled to the card
               would run the RPC and then navigate, landing the parent on
               the detail screen while the optimistic patch and success
               toast applied to a screen they just left. The nesting was
               then deliberately reintroduced and driven:
               verify-parent-pay-claim.mjs still scored 16/16. React
               Native's responder system grants the responder to the
               INNERMOST view and does not propagate to ancestor
               Touchables, so nested presses do not double-fire here.
               This layout is kept because it reads honestly and does not
               rely on that behaviour surviving an RN-web upgrade — but do
               not repeat the double-fire claim as fact. */
            <Card key={inv.id}>
              <TouchableOpacity
                onPress={() => router.push(`/(parent)/billing/invoice/${inv.id}`)}
                activeOpacity={0.8}
              >
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
                    {/* The reference the QR, the WhatsApp reminder and the
                        bank statement all carry — not a UUID fragment, which
                        gave the parent a different number to the one on their
                        own payment. */}
                    <Text selectable className="text-xs text-gray-500 mt-0.5">
                      {invoiceLabel(inv)}
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
                  {inv.package_applied > 0 && (
                    <View className="flex-row justify-between">
                      <Text className="text-sm text-blue-500">Package Applied</Text>
                      <Text className="text-sm text-blue-500">
                        −S${inv.package_applied.toFixed(2)}
                      </Text>
                    </View>
                  )}
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
              </TouchableOpacity>

              {/* Paying is the single action this product most wants a
                  parent to take, and until now it was two taps deep behind
                  "View Details" — while the public tokenized page the
                  WhatsApp reminder links to put both controls in front of
                  them immediately. The parent who opened the APP got the
                  slower path; this removes that inversion. */}
              {inv.status === "outstanding" && (
                <View className="mt-3 border-t border-gray-100 pt-3 gap-2">
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() =>
                        router.push(
                          `/(parent)/billing/paynow?invoiceId=${inv.id}`
                        )
                      }
                      className="flex-1 bg-sky-500 rounded-xl py-2.5 items-center"
                    >
                      <Text className="text-sm font-semibold text-white">
                        Pay via PayNow
                      </Text>
                    </TouchableOpacity>
                    {/* A claim is one-way and idempotent, so once made the
                        button is replaced rather than disabled. Pay stays
                        available either way — a claimed invoice is still
                        unpaid until the coach confirms it. */}
                    {!inv.paid_claimed_at && (
                      <TouchableOpacity
                        onPress={() => claimPaid(inv)}
                        className="flex-1 border border-gray-200 rounded-xl py-2.5 items-center"
                      >
                        <Text className="text-sm font-semibold text-gray-500">
                          {claimingId === inv.id ? "Saving…" : "I've paid"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {inv.paid_claimed_at && (
                    <Text className="text-xs text-sky-700 text-center">
                      You&apos;ve told your coach this is paid — they&apos;ll
                      confirm it.
                    </Text>
                  )}
                </View>
              )}
            </Card>
          ))
        )
      }
    </>
  );
}
