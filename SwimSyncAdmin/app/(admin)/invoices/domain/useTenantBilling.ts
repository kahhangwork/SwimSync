import { useState } from "react";
import { blankToNull, normalizeSgPhone } from "@/lib/sgPhone";
import * as repo from "../dao/invoices.repo";
import { payNowProxyWarning } from "./paynow";

/** The tenant this admin bills for and its billing schedule (auto on/off, run
 *  day, PayNow proxy, business name). `tenantId` is the shared spine — orphans,
 *  pending debits and generation all read it — so `loadTenant` RETURNS the
 *  resolved id and the page chains those dependent loads. A platform_admin has
 *  no tenant, so the generation controls stay disabled for them. */
export function useTenantBilling() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState<boolean | null>(null);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [runDay, setRunDay] = useState<number | null>(null);
  const [savingRunDay, setSavingRunDay] = useState(false);
  // PayNow proxy — where invoice QRs point the money. null = not loaded yet
  // (platform admin has no tenant); "" = loaded and unset.
  const [paynowUen, setPaynowUen] = useState<string | null>(null);
  const [paynowMobile, setPaynowMobile] = useState<string | null>(null);
  const [paynowSaved, setPaynowSaved] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("your swim school");

  /**
   * Resolve who is signed in and which business they bill for, then read that
   * tenant's billing schedule. Returns the resolved tenant id (or null) so the
   * caller can load the tenant-scoped reports (orphans, pending debits).
   *
   * The schedule moved from the GLOBAL app_settings rows onto `tenants` when
   * the engine became tenant-scoped. Left on app_settings these controls would
   * still save happily and the engine would ignore them — a switch that looks
   * like it works and does nothing.
   */
  async function loadTenant(): Promise<string | null> {
    const { data: auth } = await repo.getUser();
    if (!auth.user) return null;

    const { data: profile } = await repo.fetchProfile(auth.user.id);

    setIsPlatformAdmin(profile?.role === "platform_admin");
    const tid = (profile?.tenant_id as string | null) ?? null;
    setTenantId(tid);
    if (!tid) return null;

    const { data: tenant } = await repo.fetchTenant(tid);

    setBusinessName((tenant?.display_name as string | null) ?? "your swim school");
    setAutoEnabled(tenant?.auto_invoice_enabled ?? true);
    const n = Number(tenant?.invoice_run_day);
    setRunDay(Number.isFinite(n) && n >= 1 ? Math.min(28, n) : 7);
    setPaynowUen((tenant?.paynow_uen as string | null) ?? "");
    setPaynowMobile((tenant?.paynow_mobile as string | null) ?? "");
    return tid;
  }

  // Saves on blur, like the run day. Validation is ADVISORY only (the
  // sgPhone doctrine — a blocked save helps nobody); normalizeSgPhone strips
  // +65 so the stored form is the bare 8 digits the QR payload needs.
  async function handleSavePaynow(field: "paynow_uen" | "paynow_mobile", raw: string) {
    if (!tenantId) return;
    const value =
      field === "paynow_mobile" ? blankToNull(normalizeSgPhone(raw)) : blankToNull(raw);
    const { error } = await repo.updateTenant(tenantId, {
      [field]: value,
      updated_at: new Date().toISOString(),
    });
    // Advisory only: the value still saved. A mistyped mobile can't build a QR,
    // and the parent's screen would silently show none — warn here instead.
    const warning = error ? null : payNowProxyWarning(field, value);
    setPaynowSaved(
      error
        ? `Error: ${error.message}`
        : warning
          ? `Saved — ⚠ ${warning}`
          : "PayNow details saved."
    );
    if (!error && field === "paynow_mobile") setPaynowMobile(value ?? "");
    if (!error && field === "paynow_uen") setPaynowUen(value ?? "");
  }

  // Capped at 28 to match the engine: 29-31 would never fire in February.
  // The row is seeded by migration — app_settings has no INSERT policy, so
  // this can only ever UPDATE.
  async function handleSaveRunDay(next: number) {
    if (!tenantId) return;
    const clamped = Math.min(28, Math.max(1, Math.trunc(next)));
    setSavingRunDay(true);
    const { error } = await repo.updateTenant(tenantId, {
      invoice_run_day: clamped,
      updated_at: new Date().toISOString(),
    });
    if (!error) setRunDay(clamped);
    setSavingRunDay(false);
  }

  async function handleToggleAuto() {
    if (autoEnabled === null || !tenantId) return;
    setTogglingAuto(true);
    const next = !autoEnabled;
    const { error } = await repo.updateTenant(tenantId, {
      auto_invoice_enabled: next,
      updated_at: new Date().toISOString(),
    });
    if (!error) setAutoEnabled(next);
    setTogglingAuto(false);
  }

  return {
    tenantId,
    isPlatformAdmin,
    autoEnabled,
    togglingAuto,
    runDay,
    setRunDay,
    savingRunDay,
    paynowUen,
    setPaynowUen,
    paynowMobile,
    setPaynowMobile,
    paynowSaved,
    businessName,
    loadTenant,
    handleSavePaynow,
    handleSaveRunDay,
    handleToggleAuto,
  };
}
