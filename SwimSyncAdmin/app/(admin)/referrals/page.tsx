"use client";

// Referrals — configure the double-sided package discount, and see who brought
// whom. Four blocks: SETTINGS (enable + type + value + expiry), REFERRALS (the
// relationships), REWARDS (the queue; "expired" is computed here from
// expires_at — RISK 14, no DEFINER write on load), and FAMILY CODES (disable a
// leaked REF- code — RISK 15). Admin actions: Grant a goodwill reward, Void an
// unused one (refused on a claimed package — RISK 6).
//
// The discount is a PRICE concept: it changes what a family pays, never a
// package's value (D14). Nothing here recomputes a price — the pay flow lives
// on the Packages page and uses preview_package_price (RISK 7).
//
// Composition only (Admin L-C): state + loads + writes in domain/useReferrals,
// the row mapping + derived "expired" in domain/referralRows, data in
// dao/referrals.{repo,rpc}, markup in ui/. See docs/refactor/BATCH_C_PLAN.md.

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { useReferrals } from "./domain/useReferrals";
import { SettingsSection } from "./ui/SettingsSection";
import { ReferralsSection } from "./ui/ReferralsSection";
import { RewardsSection } from "./ui/RewardsSection";
import { CodesSection } from "./ui/CodesSection";
import { GrantModal } from "./ui/GrantModal";

export default function ReferralsPage() {
  const r = useReferrals();

  if (r.loading) return <div className="p-6 text-gray-500">Loading…</div>;

  return (
    <div className="p-6">
      <PageHeader
        title="Referrals"
        subtitle="A double-sided package discount: a friend saves on their first package, and the family who referred them saves on their next."
        action={<Button onClick={() => r.setGrantModal(true)}>Grant a reward</Button>}
      />

      {r.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {r.error}
        </div>
      )}

      {/* ── Settings ─────────────────────────────────────────────────── */}
      {r.settings && (
        <SettingsSection
          settings={r.settings}
          setSettings={r.setSettings}
          saving={r.saving}
          onSave={r.saveSettings}
        />
      )}

      {/* ── Referrals ────────────────────────────────────────────────── */}
      <ReferralsSection referrals={r.referrals} />

      {/* ── Rewards queue ────────────────────────────────────────────── */}
      <RewardsSection rewards={r.rewards} busy={r.busy} onVoid={r.voidReward} />

      {/* ── Family codes ─────────────────────────────────────────────── */}
      <CodesSection memberships={r.memberships} busy={r.busy} onToggle={r.toggleCode} />

      <GrantModal
        open={r.grantModal}
        onClose={() => r.setGrantModal(false)}
        memberships={r.memberships}
        grantParent={r.grantParent}
        setGrantParent={r.setGrantParent}
        grantReason={r.grantReason}
        setGrantReason={r.setGrantReason}
        busy={r.busy}
        onGrant={r.grant}
      />
    </div>
  );
}
