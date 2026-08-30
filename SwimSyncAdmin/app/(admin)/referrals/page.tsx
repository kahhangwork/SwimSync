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

import { useEffect, useState } from "react";
import { formatSgStamp } from "@/lib/lessonDates";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { discountLabel, type DiscountType } from "@/lib/referralDiscount";

// The Singapore calendar date of a timestamptz, in the dd/mm/yyyy shape this
// page has always shown. `formatSgStamp` pins Asia/Singapore; the bare
// `toLocaleDateString("en-SG")` it replaced rendered the VIEWER's date, a day
// early west of Singapore for anything stamped before 08:00 SGT.
const DMY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

type Settings = {
  referral_enabled: boolean;
  referral_discount_type: DiscountType | null;
  referral_discount_value: number | null;
  referral_reward_expiry_days: number | null;
};

type Membership = {
  membership_id: string;
  parent_id: string;
  name: string;
  code: string | null;
  disabled_at: string | null;
};

type Referral = {
  id: string;
  referrer: string;
  referee: string;
  status: string;
  void_reason: string | null;
  created_at: string;
  converted_at: string | null;
};

type Reward = {
  id: string;
  beneficiary: string;
  kind: string;
  status: string;
  earned_at: string;
  expires_at: string | null;
  void_reason: string | null;
};

async function myTenantId(): Promise<string | null> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { data } = await supabase
    .from("profiles").select("tenant_id").eq("id", user.user.id).single();
  return (data?.tenant_id as string | null) ?? null;
}

/** A reward is usable only while available AND unexpired; the admin table shows
 *  "expired" derived here, without any write (RISK 14). */
function displayStatus(r: Reward): string {
  if (r.status === "available" && r.expires_at && new Date(r.expires_at) <= new Date()) {
    return "expired";
  }
  return r.status;
}

export default function ReferralsPage() {
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
    const t = await myTenantId();
    setTenant(t);
    if (!t) {
      setError("No business found for this account.");
      setLoading(false);
      return;
    }

    const [tenantRes, memRes, refRes, rwRes] = await Promise.all([
      supabase.from("tenants")
        .select("referral_enabled, referral_discount_type, referral_discount_value, referral_reward_expiry_days")
        .eq("id", t).single(),
      supabase.from("parent_tenants")
        .select("id, parent_id, referral_code, referral_code_disabled_at, parents(profiles(full_name))")
        .eq("tenant_id", t),
      supabase.from("referrals")
        .select("id, referrer_parent_id, referee_parent_id, status, void_reason, created_at, converted_at")
        .eq("tenant_id", t).order("created_at", { ascending: false }),
      supabase.from("referral_rewards")
        .select("id, parent_id, kind, status, earned_at, expires_at, void_reason")
        .eq("tenant_id", t).order("earned_at", { ascending: false }),
    ]);

    if (tenantRes.data) setSettings(tenantRes.data as Settings);

    const mems: Membership[] = ((memRes.data as any[]) ?? []).map((m) => {
      const p = Array.isArray(m.parents) ? m.parents[0] : m.parents;
      const pr = Array.isArray(p?.profiles) ? p.profiles[0] : p?.profiles;
      return {
        membership_id: m.id,
        parent_id: m.parent_id,
        name: pr?.full_name ?? "—",
        code: m.referral_code ?? null,
        disabled_at: m.referral_code_disabled_at ?? null,
      };
    });
    setMemberships(mems);
    const nameById = new Map(mems.map((m) => [m.parent_id, m.name]));

    setReferrals(((refRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      referrer: nameById.get(r.referrer_parent_id) ?? "—",
      referee: nameById.get(r.referee_parent_id) ?? "—",
      status: r.status,
      void_reason: r.void_reason ?? null,
      created_at: r.created_at,
      converted_at: r.converted_at ?? null,
    })));

    setRewards(((rwRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      beneficiary: nameById.get(r.parent_id) ?? "—",
      kind: r.kind,
      status: r.status,
      earned_at: r.earned_at,
      expires_at: r.expires_at ?? null,
      void_reason: r.void_reason ?? null,
    })));

    setLoading(false);
  }

  async function saveSettings() {
    if (!tenant || !settings) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("tenants").update({
      referral_enabled: settings.referral_enabled,
      referral_discount_type: settings.referral_discount_type,
      referral_discount_value: settings.referral_discount_value,
      referral_reward_expiry_days: settings.referral_reward_expiry_days,
    }).eq("id", tenant);
    setSaving(false);
    if (error) setError(error.message);
    else load();
  }

  async function toggleCode(m: Membership) {
    setBusy(true);
    const { error } = await supabase.rpc("set_referral_code_disabled", {
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
    const { error } = await supabase.rpc("grant_referral_reward", {
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
    const { error } = await supabase.rpc("void_referral_reward", {
      p_reward_id: id,
      p_reason: reason.trim() || "Voided",
    });
    setBusy(false);
    // RISK 6 — a reward on a paid package cannot be voided; surface that message.
    if (error) setError(error.message);
    else load();
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;

  return (
    <div className="p-6">
      <PageHeader
        title="Referrals"
        subtitle="A double-sided package discount: a friend saves on their first package, and the family who referred them saves on their next."
        action={<Button onClick={() => setGrantModal(true)}>Grant a reward</Button>}
      />

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Settings ─────────────────────────────────────────────────── */}
      {settings && (
        <section className="mb-8 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-bold text-gray-900 mb-3">Programme settings</h2>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.referral_enabled}
                onChange={(e) => setSettings({ ...settings, referral_enabled: e.target.checked })}
              />
              <span className="font-medium text-gray-700">Referrals enabled</span>
            </label>

            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">Discount type</div>
              <select
                value={settings.referral_discount_type ?? ""}
                onChange={(e) => setSettings({
                  ...settings,
                  referral_discount_type: (e.target.value || null) as DiscountType | null,
                })}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">—</option>
                <option value="percent">Percent (%)</option>
                <option value="amount">Fixed (S$)</option>
              </select>
            </div>

            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">Value</div>
              <input
                type="number"
                min={0}
                value={settings.referral_discount_value ?? ""}
                onChange={(e) => setSettings({
                  ...settings,
                  referral_discount_value: e.target.value === "" ? null : Number(e.target.value),
                })}
                className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">
                Referrer reward expires (days)
              </div>
              <input
                type="number"
                min={1}
                placeholder="never"
                value={settings.referral_reward_expiry_days ?? ""}
                onChange={(e) => setSettings({
                  ...settings,
                  referral_reward_expiry_days: e.target.value === "" ? null : Number(e.target.value),
                })}
                className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>

            <Button onClick={saveSettings} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            The referrer&rsquo;s reward can expire; a friend&rsquo;s first-package
            discount never does. A per-product override lives on each product
            (Packages page).
          </p>
        </section>
      )}

      {/* ── Referrals ────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-gray-900 mb-2">Referrals</h2>
        {referrals.length === 0 ? (
          <p className="text-sm text-gray-500">No referrals yet.</p>
        ) : (
          <Table>
            <Thead>
              <Th>Referrer</Th><Th>Friend</Th><Th>Joined</Th><Th>Status</Th><Th>Converted</Th>
            </Thead>
            <Tbody>
              {referrals.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.referrer}</Td>
                  <Td>{r.referee}</Td>
                  <Td>{formatSgStamp(r.created_at, DMY)}</Td>
                  <Td>
                    <StatusBadge status={r.status === "converted" ? "Converted"
                      : r.status === "void" ? `Void${r.void_reason ? ` · ${r.void_reason}` : ""}`
                      : "Pending"} />
                  </Td>
                  <Td>{r.converted_at ? formatSgStamp(r.converted_at, DMY) : "—"}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </section>

      {/* ── Rewards queue ────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-gray-900 mb-2">Rewards</h2>
        {rewards.length === 0 ? (
          <p className="text-sm text-gray-500">No rewards yet.</p>
        ) : (
          <Table>
            <Thead>
              <Th>Beneficiary</Th><Th>Kind</Th><Th>Status</Th><Th>Earned</Th><Th>Expires</Th><Th>{""}</Th>
            </Thead>
            <Tbody>
              {rewards.map((r) => {
                const st = displayStatus(r);
                return (
                  <Tr key={r.id}>
                    <Td>{r.beneficiary}</Td>
                    <Td>{r.kind === "referee_first" ? "Friend's first"
                       : r.kind === "referrer" ? "Referrer" : "Manual"}</Td>
                    <Td><StatusBadge status={st[0].toUpperCase() + st.slice(1)} /></Td>
                    <Td>{formatSgStamp(r.earned_at, DMY)}</Td>
                    <Td>{r.expires_at ? formatSgStamp(r.expires_at, DMY) : "never"}</Td>
                    <Td>
                      {(r.status === "available" || r.status === "reserved") && (
                        <Button variant="ghost" onClick={() => voidReward(r.id)} disabled={busy}>
                          Void
                        </Button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </section>

      {/* ── Family codes ─────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-gray-900 mb-2">Family referral codes</h2>
        <p className="text-sm text-gray-500 mb-2">
          A leaked code cannot be rotated — disable it to shut it off.
        </p>
        {memberships.length === 0 ? (
          <p className="text-sm text-gray-500">No families yet.</p>
        ) : (
          <Table>
            <Thead>
              <Th>Family</Th><Th>Code</Th><Th>Status</Th><Th>{""}</Th>
            </Thead>
            <Tbody>
              {memberships.map((m) => (
                <Tr key={m.membership_id}>
                  <Td>{m.name}</Td>
                  <Td><span className="font-mono">{m.code ?? "—"}</span></Td>
                  <Td>{m.disabled_at
                    ? <StatusBadge status="Disabled" />
                    : <StatusBadge status="Active" />}</Td>
                  <Td>
                    <Button variant="ghost" onClick={() => toggleCode(m)} disabled={busy}>
                      {m.disabled_at ? "Enable" : "Disable"}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </section>

      <Modal title="Grant a referral reward" open={grantModal} onClose={() => setGrantModal(false)}>
        <p className="text-sm text-gray-600 mb-3">
          A goodwill discount for a family — e.g. a friend who forgot to enter the
          code. It joins the queue like any earned reward.
        </p>
        <div className="mb-3">
          <div className="text-xs font-semibold text-gray-500 mb-1">Family</div>
          <select
            value={grantParent}
            onChange={(e) => setGrantParent(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">Choose a family…</option>
            {memberships.map((m) => (
              <option key={m.parent_id} value={m.parent_id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-500 mb-1">Reason</div>
          <input
            value={grantReason}
            onChange={(e) => setGrantReason(e.target.value)}
            placeholder="Goodwill"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setGrantModal(false)}>Cancel</Button>
          <Button onClick={grant} disabled={busy || !grantParent}>Grant</Button>
        </div>
      </Modal>
    </div>
  );
}
