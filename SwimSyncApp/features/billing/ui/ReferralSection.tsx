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
//
// UI restyle step 3.8: flat cards, Copy and Share both secondary (one blue — no
// WhatsApp green button), the reward line in Ink.

import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import { useReferral } from "../domain/useReferral";
import { rewardSummary } from "../domain/referralShare";

export function ReferralSection() {
  const { memberships, rewardsByTenant, referrals, copy, share } = useReferral();

  const withCode = memberships.filter((m) => m.referral_code);
  if (withCode.length === 0) return null;

  return (
    <View className="mt-6">
      <Text className="text-headline font-semibold text-ink mb-1">Your referral code</Text>
      <Text className="text-body-secondary text-ink-secondary mb-3">
        Share it with a friend — they get a discount on their first package, and
        you get one on your next.
      </Text>

      {withCode.map((m) => {
        const disabled = !!m.referral_code_disabled_at;
        const brought = referrals.filter((r) => r.tenant_id === m.tenant_id);
        return (
          <Surface key={m.id}>
            <Text className="text-body-secondary text-ink-secondary mb-1">
              {m.business_name}
            </Text>

            {disabled ? (
              <Text className="text-body text-ink-secondary">
                This code has been turned off by {m.business_name}. Ask them for a
                new one.
              </Text>
            ) : (
              <>
                <View className="flex-row items-center justify-between">
                  <Text selectable className="text-display font-semibold tracking-widest text-ink">
                    {m.referral_code}
                  </Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => copy(m.referral_code!)}
                      className="min-h-11 flex-row items-center px-3 rounded-control border border-border-strong bg-surface"
                    >
                      <Ionicons name="copy-outline" size={16} color="#0a0a0a" />
                      <Text className="ml-1 text-body font-semibold text-ink">Copy</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => share(m.business_name, m.referral_code!)}
                      className="min-h-11 flex-row items-center px-3 rounded-control border border-border-strong bg-surface"
                    >
                      <Ionicons name="logo-whatsapp" size={16} color="#0a0a0a" />
                      <Text className="ml-1 text-body font-semibold text-ink">Share</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text className="mt-3 text-body font-medium text-ink">
                  {rewardSummary(rewardsByTenant[m.tenant_id] ?? 0)}
                </Text>

                {brought.length > 0 && (
                  <View className="mt-3 border-t border-divider pt-3">
                    <Text className="text-label font-semibold text-ink-muted mb-1">
                      Friends you&rsquo;ve referred
                    </Text>
                    {brought.map((r, i) => (
                      <Text key={i} className="text-body text-ink">
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
          </Surface>
        );
      })}
    </View>
  );
}
