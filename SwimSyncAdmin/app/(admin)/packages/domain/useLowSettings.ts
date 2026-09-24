"use client";

// The "running low" thresholds on the Packages page: load, and save as typed
// (as they did on the Students page). A value that must not be stored — empty,
// negative, a fraction — stays in the field unsaved, exactly as before; a
// FAILED save now says so instead of being dropped.

import { useEffect, useState } from "react";
import * as repo from "../dao/packages.repo";
import * as rpc from "../dao/packages.rpc";
import { parseCount } from "./lowSettings";

export function useLowSettings() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState("2");
  const [expiryDays, setExpiryDays] = useState("14");
  const [saveError, setSaveError] = useState<string | null>(null);
  // The fields are DISABLED until the stored values arrive: before that they
  // show defaults, and a value typed then has no tenant to save to — it would
  // be dropped, then overwritten by the load.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const tenant = await rpc.myTenantId();
      if (!tenant) return;
      setTenantId(tenant);
      const { data } = await repo.loadLowSettings(tenant);
      if (data?.low_package_lessons != null) setThreshold(String(data.low_package_lessons));
      if (data?.package_expiry_warning_days != null) setExpiryDays(String(data.package_expiry_warning_days));
      setLoaded(true);
    })();
  }, []);

  async function save(
    value: string,
    set: (v: string) => void,
    write: (tenantId: string, n: number) => PromiseLike<{ error: unknown }>
  ) {
    set(value);
    const n = parseCount(value);
    if (n === null || !tenantId) return;
    const { error } = await write(tenantId, n);
    setSaveError(error ? "Couldn't save that setting — please try again." : null);
  }

  return {
    threshold,
    expiryDays,
    saveError,
    loaded,
    saveThreshold: (v: string) => save(v, setThreshold, repo.updateLowPackageLessons),
    saveExpiryDays: (v: string) => save(v, setExpiryDays, repo.updatePackageExpiryDays),
  };
}

export type LowSettingsState = ReturnType<typeof useLowSettings>;
