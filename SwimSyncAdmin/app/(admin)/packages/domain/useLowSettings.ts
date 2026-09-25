"use client";

// The "running low" thresholds on the Packages page: load, and save when the
// admin LEAVES a field (blur, or Enter) — not per keystroke. Typing "20" used
// to send two PATCHes, "2" then "20", and they could land out of order and
// store 2 while the field showed 20 — the number Generate renewal offers reads.
// Saves for one field also run one at a time, so a quick edit-leave-edit-leave
// cannot reorder either. A value that must not be stored — empty, negative, a
// fraction — stays in the field unsaved; a FAILED save says so.

import { useEffect, useRef, useState } from "react";
import * as repo from "../dao/packages.repo";
import * as rpc from "../dao/packages.rpc";
import { parseCount } from "./lowSettings";

type Write = (tenantId: string, n: number) => PromiseLike<{ error: unknown }>;
type Field = "threshold" | "expiryDays";

export function useLowSettings() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState("2");
  const [expiryDays, setExpiryDays] = useState("14");
  const [saveError, setSaveError] = useState<string | null>(null);
  // The fields are DISABLED until the stored values arrive: before that they
  // show defaults, and a value typed then has no tenant to save to — it would
  // be dropped, then overwritten by the load.
  const [loaded, setLoaded] = useState(false);
  // Per field: the last value stored (a blur that changed nothing sends
  // nothing), and the tail of its save queue.
  const saved = useRef<Record<Field, number | null>>({ threshold: null, expiryDays: null });
  const queue = useRef<Record<Field, Promise<void>>>({
    threshold: Promise.resolve(),
    expiryDays: Promise.resolve(),
  });

  useEffect(() => {
    (async () => {
      const tenant = await rpc.myTenantId();
      if (!tenant) return;
      setTenantId(tenant);
      const { data } = await repo.loadLowSettings(tenant);
      if (data?.low_package_lessons != null) {
        setThreshold(String(data.low_package_lessons));
        saved.current.threshold = data.low_package_lessons;
      }
      if (data?.package_expiry_warning_days != null) {
        setExpiryDays(String(data.package_expiry_warning_days));
        saved.current.expiryDays = data.package_expiry_warning_days;
      }
      setLoaded(true);
    })();
  }, []);

  function commit(field: Field, value: string, write: Write) {
    const n = parseCount(value);
    if (n === null || !tenantId || n === saved.current[field]) return;
    const previous = saved.current[field];
    saved.current[field] = n;
    queue.current[field] = queue.current[field].then(async () => {
      // A THROWN write counts as a failed one: left to reject, it would poison
      // this field's queue and silently drop every later save.
      const error = await Promise.resolve(write(tenantId, n)).then(
        (r) => r.error,
        (e: unknown) => e ?? "failed"
      );
      if (error && saved.current[field] === n) saved.current[field] = previous;
      setSaveError(error ? "Couldn't save that setting — please try again." : null);
    });
  }

  return {
    threshold,
    expiryDays,
    saveError,
    loaded,
    setThreshold,
    setExpiryDays,
    commitThreshold: () => commit("threshold", threshold, repo.updateLowPackageLessons),
    commitExpiryDays: () => commit("expiryDays", expiryDays, repo.updatePackageExpiryDays),
  };
}

export type LowSettingsState = ReturnType<typeof useLowSettings>;
