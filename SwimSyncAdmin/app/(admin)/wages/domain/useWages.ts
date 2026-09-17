import { useEffect, useState } from "react";
import { useTableSort } from "@/components/Table";
import * as repo from "../dao/wages.repo";
import type { CoachRow } from "../types";
import { toCoachRow } from "./wageRows";

// The Wages spine: the admin's tenant, the pay policy, the coaches + their
// rates, and the busy/message pair every write on the page shares. usePayroll
// and useRateEditor take tenantId / coaches / loadCoaches / setBusy / setMessage
// from here.
export function useWages() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [rainPays, setRainPays] = useState(false);
  const [runDay, setRunDay] = useState(15);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await repo.getAuthUser();
      if (!auth.user) return;
      const { data: profile } = await repo.loadProfileTenant(auth.user.id);
      if (!profile?.tenant_id) return;
      setTenantId(profile.tenant_id);

      const { data: t } = await repo.loadTenantPolicy(profile.tenant_id);
      setRainPays(t?.rain_pays_coach ?? false);
      setRunDay(t?.wage_run_day ?? 15);

      await loadCoaches(profile.tenant_id);
    })();
  }, []);

  async function loadCoaches(tid: string) {
    const { data } = await repo.loadCoaches(tid);

    setCoaches((data ?? []).map((c: any) => toCoachRow(c)));
  }

  async function updateTenant(patch: Record<string, unknown>) {
    if (!tenantId) return;
    await repo.updateTenant(tenantId, patch);
  }

  const rateSort = useTableSort<CoachRow>({
    key: "name",
    accessors: {
      // The rate itself, so "Not on payroll" is blank and sorts last in both
      // directions — a coach with no rate is the row to notice, not to bury in
      // the middle of the alphabet.
      rate: (c) => c.rate?.amount ?? null,
      effective_from: (c) => c.rate?.effective_from ?? null,
    },
  });
  const visibleCoaches = rateSort.apply(coaches);

  return {
    tenantId,
    rainPays, setRainPays,
    runDay, setRunDay,
    coaches, loadCoaches,
    updateTenant,
    busy, setBusy,
    message, setMessage,
    rateSort, visibleCoaches,
  };
}
