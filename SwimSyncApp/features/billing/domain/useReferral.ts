// The referral card's load, Copy and Share (docs/refactor/BATCH_FGH_PLAN.md, App L-G)
// — moved VERBATIM from components/ReferralSection.tsx, whose builders are dao
// calls now.
//
// ⚠ CALLED INSIDE ReferralSection, NEVER HOISTED INTO THE ROUTE (plan ⚠ R4). The
// section mounts only on the Packages tab, so this mount-only effect ([] deps)
// runs on each switch to that tab — exactly as it did as a component. Hoisting it
// would change when it fetches.
import { useCallback, useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import { useAppStore } from "@/store/useAppStore";
import {
  fetchReferralMemberships,
  fetchReferralRewards,
} from "../dao/billing.repo";
import { fetchMyReferrals } from "../dao/billing.rpc";
import type { Membership, Referral } from "../types";
import { buildReferralShareText, buildWhatsAppUrl } from "./referralShare";

export function useReferral() {
  const showToast = useAppStore((s) => s.showToast);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [rewardsByTenant, setRewardsByTenant] = useState<Record<string, number>>({});
  const [referrals, setReferrals] = useState<Referral[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [mRes, rwRes, refRes] = await Promise.all([
        fetchReferralMemberships(),
        fetchReferralRewards(),
        fetchMyReferrals(),
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

  return { memberships, rewardsByTenant, referrals, copy, share };
}
