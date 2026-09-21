import { useEffect, useState } from "react";
import {
  getAuthUser,
  loadProfileTenantId,
  loadTenant,
  renameTenant,
} from "../dao/dashboard.repo";
import { regenerateJoinCode } from "../dao/dashboard.rpc";
import type { TenantInfo } from "../types";

export function useTenantCard() {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  /**
   * Rename the business.
   *
   * The tenant's name is seeded from the COACH's name by the migration that
   * created it, which is right for a private coach and wrong for anyone who
   * trades under a different name ("Coach Kah Hang" vs "Coach Kah Hang Swimming
   * Lessons"). It also appears on invoices and invoice emails, so it needs to
   * be the business's own name, not an operator's.
   */
  async function handleSaveName() {
    if (!tenant) return;
    const next = nameDraft.trim();
    if (!next) return;
    setSavingName(true);
    const { error } = await renameTenant(tenant.id, next);
    setSavingName(false);
    if (!error) {
      setTenant({ ...tenant, display_name: next });
      setEditingName(false);
    }
  }

  /**
   * Rotate the join code. Existing families keep their access — the code is an
   * invitation, not an ongoing credential — so this is safe to offer without a
   * scary confirmation.
   */
  async function handleRegenerate() {
    if (!tenant) return;
    setRegenerating(true);
    const { data, error } = await regenerateJoinCode(tenant.id);
    setRegenerating(false);
    if (!error && data) setTenant({ ...tenant, join_code: data as string });
  }

  useEffect(() => {
    // The admin's own business. A platform admin has no tenant, so the card
    // simply does not render for them.
    //
    // Its own effect, never awaited into the metrics load (BATCH_E_PLAN.md
    // RISK 5): the card must not wait on the counts, nor the counts on it.
    (async () => {
      const { data: auth } = await getAuthUser();
      if (!auth.user) return;
      const { data: profile } = await loadProfileTenantId(auth.user.id);
      if (!profile?.tenant_id) return;
      const { data: t } = await loadTenant(profile.tenant_id);
      if (t) setTenant(t as TenantInfo);
    })();
  }, []);

  return {
    tenant,
    regenerating,
    editingName,
    setEditingName,
    nameDraft,
    setNameDraft,
    savingName,
    handleSaveName,
    handleRegenerate,
  };
}
