// The Packages tab: the family's packages, the ones for sale, and the referral card.
// Moved from app/(parent)/billing/index.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-G).
// UI restyle step 3.8: flat cards, money and counts in Ink (tabular), a pending
// package Info. Pay-First on a pending package (Pay via PayNow the primary, Cancel a
// link under it); the products for sale are equal choices, so each "Request & pay"
// is a secondary button, not a row of primaries. Every figure, condition and
// handler is the one this file already had — nothing is recomputed (plan ⚠ RISK 2).
import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import StatusBadge from "@/components/StatusBadge";
import { Surface } from "@/components/ui/Surface";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { formatDate, childrenForProduct, requestStudentFor } from "../domain/billingFormat";
import { ReferralSection } from "./ReferralSection";
import { PackageUsageList } from "./PackageUsageList";
import { usePackageUsage } from "../domain/usePackageUsage";
import type { useBilling } from "../domain/useBilling";
import { formatSgd } from "@/lib/money";

type Billing = ReturnType<typeof useBilling>;

const TABULAR = { fontVariant: ["tabular-nums" as const] };

export function PackagesTab(p: Pick<Billing, "packageError" | "packages" | "products" | "requestingId" | "requestPackage" | "cancelRequest" | "familyChildren">) {
  const { packageError, packages, products, requestingId, requestPackage, cancelRequest, familyChildren } = p;
  const usage = usePackageUsage();
  // Single-child packages (D7): the child chosen per one-child product.
  const [childChoice, setChildChoice] = useState<Record<string, string>>({});
  return (
    <>
      <>
        {packageError && (
          <View className="bg-status-danger-bg border border-status-danger-border rounded-card px-4 py-3">
            <Text className="text-body text-status-danger-text">{packageError}</Text>
          </View>
        )}

        {packages.length === 0 && products.length === 0 && (
          <View className="items-center py-16">
            <Ionicons name="cube-outline" size={40} color="#6b6b6b" />
            <Text className="text-body text-ink-secondary mt-3 text-center px-8">
              Your coach doesn&apos;t offer prepaid packages yet.
            </Text>
          </View>
        )}

        {packages.map((pkg) => (
          <Surface key={pkg.id}>
            <View className="flex-row items-start justify-between gap-3 mb-2">
              <View className="flex-1">
                <Text className="text-headline font-semibold text-ink">
                  {pkg.name}
                </Text>
                <Text className="text-body-secondary text-ink-secondary mt-0.5">
                  {pkg.business_name}
                  {pkg.category_name ? ` · ${pkg.category_name} classes` : ""}
                </Text>
                {pkg.child_name && (
                  <Text className="text-body-secondary font-semibold text-ink mt-0.5">
                    For {pkg.child_name} only
                  </Text>
                )}
              </View>
              <StatusBadge
                status={pkg.status === "active" ? "Active" : "Pending"}
                size="sm"
              />
            </View>

            {pkg.status === "active" ? (
              <>
                <View className="items-center py-3">
                  <Text className="text-display font-semibold text-ink" style={TABULAR}>
                    {pkg.live_lessons_remaining ??
                      Math.floor(pkg.total_value / pkg.rate_per_lesson)}
                  </Text>
                  <Text className="text-body text-ink-secondary">
                    lessons remaining
                  </Text>
                  <Text className="text-body-secondary text-ink-secondary mt-1" style={TABULAR}>
                    {formatSgd(pkg.live_value_remaining ?? pkg.total_value)}{" "}
                    of {formatSgd(pkg.total_value)}
                  </Text>
                </View>
                {/* Lessons your child has attended show here the same
                    day; the money itself moves on the monthly invoice. */}
                {pkg.expires_on && (
                  <View className="flex-row justify-between pt-2 border-t border-divider">
                    <Text className="text-body-secondary text-ink-secondary">Valid until</Text>
                    <Text className="text-body-secondary text-ink">
                      {formatDate(pkg.expires_on)}
                    </Text>
                  </View>
                )}
                {pkg.holiday_extension_days > 0 && (
                  <Text className="mt-1 text-body-secondary text-ink-secondary">
                    Includes +{pkg.holiday_extension_days} day
                    {pkg.holiday_extension_days === 1 ? "" : "s"} for public
                    holidays
                  </Text>
                )}
                {pkg.cancel_extension_days > 0 && (
                  <Text className="mt-1 text-body-secondary text-ink-secondary">
                    Includes +{pkg.cancel_extension_days} day
                    {pkg.cancel_extension_days === 1 ? "" : "s"} for cancelled
                    lessons
                  </Text>
                )}
                <PackageUsageList packageId={pkg.id} usage={usage} />
              </>
            ) : (
              <>
                {pkg.offered_by ? (
                  <Text className="text-body text-ink mb-3">
                    {pkg.business_name} has prepared your next package —{" "}
                    {pkg.lesson_count} lessons ·{" "}
                    {formatSgd(pkg.amount_payable)}. Pay via PayNow to
                    activate it.
                  </Text>
                ) : (
                  <Text className="text-body text-ink mb-3">
                    {pkg.lesson_count} lessons ·{" "}
                    {formatSgd(pkg.amount_payable)}. Waiting for{" "}
                    {pkg.business_name} to confirm your PayNow payment.
                  </Text>
                )}
                {pkg.discount_amount > 0 && (
                  <Text className="text-body-secondary text-ink-secondary -mt-2 mb-3" style={TABULAR}>
                    Referral discount: −{formatSgd(pkg.discount_amount)}{" "}
                    off {formatSgd(pkg.total_value)}
                  </Text>
                )}
                <View>
                  <TouchableOpacity
                    onPress={() =>
                      router.push(
                        `/(parent)/billing/paynow?packageId=${pkg.id}`
                      )
                    }
                    className="min-h-11 px-4 rounded-control items-center justify-center bg-primary"
                  >
                    <Text className="text-body font-semibold text-white">
                      Pay via PayNow
                    </Text>
                  </TouchableOpacity>
                  {/* Cancelling a request is the second decision, not an equal
                      one (Pay-First). ⚠ cancelRequest acts at once — it has no
                      confirmation (BACKLOG: *Cancelling a package request has no
                      confirmation*), so this link keeps a clear gap below Pay. */}
                  <TouchableOpacity
                    onPress={() => cancelRequest(pkg)}
                    className="mt-3 min-h-11 items-center justify-center"
                  >
                    <Text className="text-body font-semibold text-status-danger-text">
                      Cancel
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Surface>
        ))}

        {products.length > 0 && (
          <>
            <SectionHeading className="mt-3 mb-1">
              Buy a package
            </SectionHeading>
            {products.map((p) => {
              // D7 — which child a one-child product is for: shown when there is
              // one child at this business, asked when several, refused when none.
              const eligible = p.single_child ? childrenForProduct(familyChildren, p) : [];
              const studentId = requestStudentFor(p, eligible, childChoice[p.id]);
              const blocked = p.single_child && (eligible.length === 0 || !studentId);
              return (
              <Surface key={p.id}>
                <Text className="text-headline font-semibold text-ink">
                  {p.name}
                </Text>
                <Text className="text-body-secondary text-ink-secondary mt-0.5 mb-2">
                  {p.business_name}
                  {p.category_name ? ` · ${p.category_name} classes` : ""}
                </Text>
                <Text className="text-body text-ink mb-3">
                  {p.lesson_count} lessons at {formatSgd(p.rate_per_lesson)} each —{" "}
                  <Text className="font-semibold text-ink" style={TABULAR}>
                    {formatSgd(p.lesson_count * p.rate_per_lesson)}
                  </Text>
                  , valid {p.validity_weeks} week
                  {p.validity_weeks === 1 ? "" : "s"} from its start date.
                </Text>
                {p.single_child && (
                  <View className="mb-3" testID={`child-picker-${p.id}`}>
                    {eligible.length === 0 ? (
                      <Text className="text-body text-status-warning-text">
                        Add your child at this business first.
                      </Text>
                    ) : eligible.length === 1 ? (
                      <Text className="text-body text-ink">
                        For <Text className="font-semibold">{eligible[0].name}</Text>
                      </Text>
                    ) : (
                      <>
                        <Text className="text-body font-medium text-ink mb-1.5">
                          Which child is this for?
                        </Text>
                        <View className="flex-row flex-wrap gap-2">
                          {eligible.map((k) => {
                            const on = childChoice[p.id] === k.id;
                            return (
                              <TouchableOpacity
                                key={k.id}
                                onPress={() => setChildChoice((c) => ({ ...c, [p.id]: k.id }))}
                                className={`min-h-11 justify-center rounded-control px-4 border ${on ? "bg-selected border-border-strong" : "bg-surface border-border"}`}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: on }}
                                aria-checked={on}
                              >
                                <Text className={`text-body ${on ? "font-semibold text-ink" : "font-medium text-ink-secondary"}`}>
                                  {k.name}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </View>
                )}
                <TouchableOpacity
                  onPress={() => requestPackage(p, studentId)}
                  disabled={requestingId !== null || blocked}
                  className="min-h-11 px-4 rounded-control items-center justify-center bg-surface border border-border-strong"
                  style={requestingId !== null || blocked ? { opacity: 0.6 } : undefined}
                >
                  <Text className="text-body font-semibold text-ink">
                    {requestingId === p.id ? "Requesting…" : "Request & pay"}
                  </Text>
                </TouchableOpacity>
              </Surface>
              );
            })}
            <Text className="text-body-secondary text-ink-secondary px-1">
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
