// "Your referral code" — one card PER BUSINESS the family belongs to (⚠ RISK 9:
// a family at a school AND a private coach has two codes; one shared card would
// send friends to the wrong business). Each card carries the code, Copy + Share
// on WhatsApp, the family's waiting rewards, and the friends they've brought
// (first names only — my_referrals(), RISK 5).

import React, { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/store/useAppStore";
import Card from "@/components/Card";
import {
  buildReferralShareText,
  buildWhatsAppUrl,
  rewardSummary,
} from "@/lib/referralShare";

type Membership = {
  id: string;
  referral_code: string | null;
  referral_code_disabled_at: string | null;
  tenant_id: string;
  business_name: string;
};

type Referral = {
  tenant_id: string;
  business_name: string;
  referee_first_name: string | null;
  status: string;
};

export default function ReferralSection() {
  const showToast = useAppStore((s) => s.showToast);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [rewardsByTenant, setRewardsByTenant] = useState<Record<string, number>>({});
  const [referrals, setReferrals] = useState<Referral[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [mRes, rwRes, refRes] = await Promise.all([
        supabase
          .from("parent_tenants")
          .select("id, referral_code, referral_code_disabled_at, tenant_id, tenants(display_name)")
          .eq("is_active", true),
        supabase.from("referral_rewards").select("tenant_id, status"),
        supabase.rpc("my_referrals"),
      ]);
      if (cancelled) return;

      setMemberships(
        ((mRes.data as any[]) ?? []).map((m) => {
          const t = Array.isArray(m.tenants) ? m.tenants[0] : m.tenants;
          return {
            id: m.id,
            referral_code: m.referral_code ?? null,
            referral_code_disabled_at: m.referral_code_disabled_at ?? null,
            tenant_id: m.tenant_id,
            business_name: t?.display_name ?? "Your coach",
          };
        }),
      );

      const counts: Record<string, number> = {};
      for (const r of ((rwRes.data as any[]) ?? [])) {
        if (r.status === "available") counts[r.tenant_id] = (counts[r.tenant_id] ?? 0) + 1;
      }
      setRewardsByTenant(counts);

      setReferrals(
        ((refRes.data as any[]) ?? []).map((r) => ({
          tenant_id: r.tenant_id,
          business_name: r.business_name,
          referee_first_name: r.referee_first_name ?? null,
          status: r.status,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = useCallback(
    async (code: string) => {
      // Web only (the deployed surface). navigator.clipboard is the admin
      // precedent; no expo-clipboard for one button. Native: the code is
      // selectable text, so long-press copies.
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(code);
          showToast("Referral code copied.", "success");
          return;
        } catch {
          // fall through
        }
      }
      showToast("Long-press the code to copy it.", "info");
    },
    [showToast],
  );

  const share = useCallback((businessName: string, code: string) => {
    const url = buildWhatsAppUrl(buildReferralShareText(businessName, code));
    Linking.openURL(url);
  }, []);

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
