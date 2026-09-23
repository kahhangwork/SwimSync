// The Packages tab: the family's packages, the ones for sale, and the referral card.
// Moved VERBATIM from app/(parent)/billing/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import { formatDate } from "../domain/billingFormat";
import { ReferralSection } from "./ReferralSection";
import type { useBilling } from "../domain/useBilling";

type Billing = ReturnType<typeof useBilling>;

export function PackagesTab(p: Pick<Billing, "packageError" | "packages" | "products" | "requestingId" | "requestPackage" | "cancelRequest">) {
  const { packageError, packages, products, requestingId, requestPackage, cancelRequest } = p;
  return (
    <>
      <>
        {packageError && (
          <View className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <Text className="text-sm text-red-600">{packageError}</Text>
          </View>
        )}

        {packages.length === 0 && products.length === 0 && (
          <View className="items-center py-16">
            <Ionicons name="cube-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3 text-center px-8">
              Your coach doesn&apos;t offer prepaid packages yet.
            </Text>
          </View>
        )}

        {packages.map((pkg) => (
          <Card key={pkg.id}>
            <View className="flex-row items-start justify-between mb-2">
              <View className="flex-1 pr-2">
                <Text className="text-base font-bold text-gray-900">
                  {pkg.name}
                </Text>
                <Text className="text-xs font-medium text-sky-600 mt-0.5">
                  {pkg.business_name}
                  {pkg.category_name ? ` · ${pkg.category_name} classes` : ""}
                </Text>
              </View>
              <StatusBadge
                status={pkg.status === "active" ? "Active" : "Pending"}
                size="sm"
              />
            </View>

            {pkg.status === "active" ? (
              <>
                <View className="items-center py-3">
                  <Text className="text-3xl font-bold text-gray-900">
                    {pkg.live_lessons_remaining ??
                      Math.floor(pkg.total_value / pkg.rate_per_lesson)}
                  </Text>
                  <Text className="text-sm text-gray-500">
                    lessons remaining
                  </Text>
                  <Text className="text-xs text-gray-400 mt-1">
                    S$
                    {(pkg.live_value_remaining ?? pkg.total_value).toFixed(2)}{" "}
                    of S${pkg.total_value.toFixed(2)}
                  </Text>
                </View>
                {/* Lessons your child has attended show here the same
                    day; the money itself moves on the monthly invoice. */}
                {pkg.expires_on && (
                  <View className="flex-row justify-between pt-2 border-t border-gray-100">
                    <Text className="text-xs text-gray-500">Valid until</Text>
                    <Text className="text-xs text-gray-700">
                      {formatDate(pkg.expires_on)}
                    </Text>
                  </View>
                )}
                {pkg.holiday_extension_days > 0 && (
                  <Text className="mt-1 text-xs text-gray-400">
                    Includes +{pkg.holiday_extension_days} day
                    {pkg.holiday_extension_days === 1 ? "" : "s"} for public
                    holidays
                  </Text>
                )}
                {pkg.cancel_extension_days > 0 && (
                  <Text className="mt-1 text-xs text-gray-400">
                    Includes +{pkg.cancel_extension_days} day
                    {pkg.cancel_extension_days === 1 ? "" : "s"} for cancelled
                    lessons
                  </Text>
                )}
              </>
            ) : (
              <>
                {pkg.offered_by ? (
                  <Text className="text-sm text-gray-600 mb-3">
                    {pkg.business_name} has prepared your next package —{" "}
                    {pkg.lesson_count} lessons ·{" "}
                    S${pkg.amount_payable.toFixed(2)}. Pay via PayNow to
                    activate it.
                  </Text>
                ) : (
                  <Text className="text-sm text-gray-600 mb-3">
                    {pkg.lesson_count} lessons ·{" "}
                    S${pkg.amount_payable.toFixed(2)}. Waiting for{" "}
                    {pkg.business_name} to confirm your PayNow payment.
                  </Text>
                )}
                {pkg.discount_amount > 0 && (
                  <Text className="text-xs font-medium text-emerald-600 -mt-2 mb-3">
                    Referral discount: −S${pkg.discount_amount.toFixed(2)}{" "}
                    off S${pkg.total_value.toFixed(2)}
                  </Text>
                )}
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() =>
                      router.push(
                        `/(parent)/billing/paynow?packageId=${pkg.id}`
                      )
                    }
                    className="flex-1 bg-sky-500 rounded-xl py-2.5 items-center"
                  >
                    <Text className="text-sm font-semibold text-white">
                      Pay via PayNow
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => cancelRequest(pkg)}
                    className="px-4 rounded-xl py-2.5 items-center border border-gray-200"
                  >
                    <Text className="text-sm font-semibold text-gray-500">
                      Cancel
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Card>
        ))}

        {products.length > 0 && (
          <>
            <Text className="text-sm font-bold text-gray-700 mt-3 mb-1">
              Buy a package
            </Text>
            {products.map((p) => (
              <Card key={p.id}>
                <Text className="text-base font-bold text-gray-900">
                  {p.name}
                </Text>
                <Text className="text-xs font-medium text-sky-600 mt-0.5 mb-2">
                  {p.business_name}
                  {p.category_name ? ` · ${p.category_name} classes` : ""}
                </Text>
                <Text className="text-sm text-gray-600 mb-3">
                  {p.lesson_count} lessons at S$
                  {p.rate_per_lesson.toFixed(2)} each —{" "}
                  <Text className="font-bold text-gray-900">
                    S${(p.lesson_count * p.rate_per_lesson).toFixed(2)}
                  </Text>
                  , valid {p.validity_weeks} week
                  {p.validity_weeks === 1 ? "" : "s"} from its start date.
                </Text>
                <TouchableOpacity
                  onPress={() => requestPackage(p)}
                  disabled={requestingId !== null}
                  className="bg-sky-500 rounded-xl py-2.5 items-center"
                  style={requestingId !== null ? { opacity: 0.6 } : undefined}
                >
                  <Text className="text-sm font-semibold text-white">
                    {requestingId === p.id ? "Requesting…" : "Request & pay"}
                  </Text>
                </TouchableOpacity>
              </Card>
            ))}
            <Text className="text-xs text-gray-400 px-1">
              You pay by PayNow; the package becomes active once your
              coach confirms the money arrived. Lessons then use the
              package automatically, and anything it doesn&apos;t cover
              appears on your monthly invoice as usual.
            </Text>
          </>
        )}

        <ReferralSection />
      </>
    </>
  );
}
