import type { Membership, Referral, Reward } from "../types";

export function toMemberships(rows: any[] | null): Membership[] {
  return ((rows as any[]) ?? []).map((m) => {
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
}

export function toReferrals(rows: any[] | null, nameById: Map<string, string>): Referral[] {
  return ((rows as any[]) ?? []).map((r) => ({
    id: r.id,
    referrer: nameById.get(r.referrer_parent_id) ?? "—",
    referee: nameById.get(r.referee_parent_id) ?? "—",
    status: r.status,
    void_reason: r.void_reason ?? null,
    created_at: r.created_at,
    converted_at: r.converted_at ?? null,
  }));
}

export function toRewards(rows: any[] | null, nameById: Map<string, string>): Reward[] {
  return ((rows as any[]) ?? []).map((r) => ({
    id: r.id,
    beneficiary: nameById.get(r.parent_id) ?? "—",
    kind: r.kind,
    status: r.status,
    earned_at: r.earned_at,
    expires_at: r.expires_at ?? null,
    void_reason: r.void_reason ?? null,
  }));
}

/** A reward is usable only while available AND unexpired; the admin table shows
 *  "expired" derived here, without any write (RISK 14). */
export function displayStatus(r: Reward): string {
  if (r.status === "available" && r.expires_at && new Date(r.expires_at) <= new Date()) {
    return "expired";
  }
  return r.status;
}
