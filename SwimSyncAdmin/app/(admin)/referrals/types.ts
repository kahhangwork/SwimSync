import type { DiscountType } from "@/lib/referralDiscount";

export type Settings = {
  referral_enabled: boolean;
  referral_discount_type: DiscountType | null;
  referral_discount_value: number | null;
  referral_reward_expiry_days: number | null;
};

export type Membership = {
  membership_id: string;
  parent_id: string;
  name: string;
  code: string | null;
  disabled_at: string | null;
};

export type Referral = {
  id: string;
  referrer: string;
  referee: string;
  status: string;
  void_reason: string | null;
  created_at: string;
  converted_at: string | null;
};

export type Reward = {
  id: string;
  beneficiary: string;
  kind: string;
  status: string;
  earned_at: string;
  expires_at: string | null;
  void_reason: string | null;
};
