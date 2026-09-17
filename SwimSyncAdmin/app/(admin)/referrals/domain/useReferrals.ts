import { useEffect, useState } from "react";
import { toMemberships, toReferrals, toRewards } from "./referralRows";
import * as repo from "../dao/referrals.repo";
import * as rpc from "../dao/referrals.rpc";
import type { Membership, Referral, Reward, Settings } from "../types";

// All Referrals state, loads and writes. load() re-reads after every write so
// the tables never drift from the server.
export function useReferrals() {
  const [tenant, setTenant] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);

  const [grantModal, setGrantModal] = useState(false);
  const [grantParent, setGrantParent] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    const t = await repo.myTenantId();
    setTenant(t);
    if (!t) {
      setError("No business found for this account.");
      setLoading(false);
      return;
    }

    const [tenantRes, memRes, refRes, rwRes] = await Promise.all([
      repo.loadSettings(t),
      repo.loadMemberships(t),
      repo.loadReferrals(t),
      repo.loadRewards(t),
    ]);

    if (tenantRes.data) setSettings(tenantRes.data as Settings);

    const mems: Membership[] = toMemberships(memRes.data as any[]);
    setMemberships(mems);
    const nameById = new Map(mems.map((m) => [m.parent_id, m.name]));

    setReferrals(toReferrals(refRes.data as any[], nameById));

    setRewards(toRewards(rwRes.data as any[], nameById));

    setLoading(false);
  }

  async function saveSettings() {
    if (!tenant || !settings) return;
    setSaving(true);
    setError(null);
    const { error } = await repo.saveSettings(tenant, settings);
    setSaving(false);
    if (error) setError(error.message);
    else load();
  }

  async function toggleCode(m: Membership) {
    setBusy(true);
    const { error } = await rpc.setReferralCodeDisabled({
      p_parent_tenant_id: m.membership_id,
      p_disabled: !m.disabled_at,
    });
    setBusy(false);
    if (error) setError(error.message);
    else load();
  }

  async function grant() {
    if (!grantParent) return;
    setBusy(true);
    const { error } = await rpc.grantReferralReward({
      p_parent_id: grantParent,
      p_reason: grantReason.trim() || "Goodwill",
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setGrantModal(false);
    setGrantParent("");
    setGrantReason("");
    load();
  }

  async function voidReward(id: string) {
    const reason = window.prompt("Reason for voiding this reward?");
    if (reason === null) return;
    setBusy(true);
    const { error } = await rpc.voidReferralReward({
      p_reward_id: id,
      p_reason: reason.trim() || "Voided",
    });
    setBusy(false);
    // RISK 6 — a reward on a paid package cannot be voided; surface that message.
    if (error) setError(error.message);
    else load();
  }

  return {
    loading, error,
    settings, setSettings, saving, saveSettings,
    memberships, referrals, rewards,
    grantModal, setGrantModal, grantParent, setGrantParent, grantReason, setGrantReason,
    busy, toggleCode, grant, voidReward,
  };
}
