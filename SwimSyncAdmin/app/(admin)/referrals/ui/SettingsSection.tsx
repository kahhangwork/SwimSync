import { Button } from "@/components/Button";
import type { DiscountType } from "@/lib/referralDiscount";
import type { Settings } from "../types";

export function SettingsSection({
  settings,
  setSettings,
  saving,
  onSave,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  saving: boolean;
  onSave: () => void;
}) {
  return (
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

        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        The referrer&rsquo;s reward can expire; a friend&rsquo;s first-package
        discount never does. A per-product override lives on each product
        (Packages page).
      </p>
    </section>
  );
}
