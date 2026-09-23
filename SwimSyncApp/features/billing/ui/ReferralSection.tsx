// "Your referral code" — one card PER BUSINESS the family belongs to (⚠ RISK 9:
// a family at a school AND a private coach has two codes; one shared card would
// send friends to the wrong business). Each card carries the code, Copy + Share
// on WhatsApp, the family's waiting rewards, and the friends they've brought
// (first names only — my_referrals(), RISK 5).
//
// Moved VERBATIM from components/ReferralSection.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G) — it had one importer, the Billing tab. Still a self-contained section:
// it calls useReferral itself, so its load runs when the Packages tab mounts it,
// exactly as before (plan ⚠ R4).

import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Card from "@/components/Card";
import { useReferral } from "../domain/useReferral";
import { rewardSummary } from "../domain/referralShare";

export function ReferralSection() {
  const { memberships, rewardsByTenant, referrals, copy, share } = useReferral();

  const withCode = memberships.filter((m) => m.referral_code);
  if (withCode.length === 0) return null;

  return (
    <View className="mt-6">
      <Text className="text-lg font-bold text-gray-900 mb-1">Your referral code</Text>
      <Text className="text-sm text-gray-500 mb-3">
        Share it with a friend — they get a discount on their first package, and
        you get one on your next.
      </Text>

      {withCode.map((m) => {
        const disabled = !!m.referral_code_disabled_at;
        const brought = referrals.filter((r) => r.tenant_id === m.tenant_id);
        return (
          <Card key={m.id}>
            <Text className="text-xs font-medium text-sky-600 mb-1">
              {m.business_name}
            </Text>

            {disabled ? (
              <Text className="text-sm text-gray-500">
                This code has been turned off by {m.business_name}. Ask them for a
                new one.
              </Text>
            ) : (
              <>
                <View className="flex-row items-center justify-between">
                  <Text selectable className="text-2xl font-bold tracking-widest text-gray-900">
                    {m.referral_code}
                  </Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => copy(m.referral_code!)}
                      className="flex-row items-center px-3 py-2 rounded-xl border border-gray-200"
                    >
                      <Ionicons name="copy-outline" size={16} color="#0f172a" />
                      <Text className="ml-1 text-sm font-semibold text-gray-700">Copy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => share(m.business_name, m.referral_code!)}
                      className="flex-row items-center px-3 py-2 rounded-xl bg-emerald-500"
                    >
                      <Ionicons name="logo-whatsapp" size={16} color="#fff" />
                      <Text className="ml-1 text-sm font-semibold text-white">Share</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text className="mt-3 text-sm font-medium text-emerald-700">
                  {rewardSummary(rewardsByTenant[m.tenant_id] ?? 0)}
                </Text>

                {brought.length > 0 && (
                  <View className="mt-3 border-t border-gray-100 pt-3">
                    <Text className="text-xs font-semibold text-gray-500 mb-1">
                      Friends you&rsquo;ve referred
                    </Text>
                    {brought.map((r, i) => (
                      <Text key={i} className="text-sm text-gray-700">
                        {r.referee_first_name ?? "A friend"} ·{" "}
                        {r.status === "converted"
                          ? "joined & started — reward earned"
                          : r.status === "void"
                            ? "not eligible"
                            : "joined, not started yet"}
                      </Text>
                    ))}
                  </View>
                )}
              </>
            )}
          </Card>
        );
      })}
    </View>
  );
}
