// The Packages tab's per-package usage list (Wave 6 D3). Loaded on the FIRST
// expand of a package, not with the tab: most parents never open it, and one
// RPC per package on every Billing visit would be N reads for nothing.
// A failed read is said under that package and retried on the next expand.

import { useCallback, useRef, useState } from "react";
import { fetchPackageUsage } from "../dao/billing.rpc";
import type { PackageUsageRow } from "./packageUsage";

export type UsageState = {
  open: boolean;
  loading: boolean;
  rows: PackageUsageRow[] | null;
  error: string | null;
};

const CLOSED: UsageState = { open: false, loading: false, rows: null, error: null };

export function usePackageUsage() {
  const [byPackage, setByPackage] = useState<Record<string, UsageState>>({});
  // The decision "fetch or not" reads THIS, never a setState updater's side
  // effect — React may run an updater later than the line after it.
  const latest = useRef(byPackage);

  const put = useCallback((packageId: string, patch: Partial<UsageState>) => {
    const next = {
      ...latest.current,
      [packageId]: { ...(latest.current[packageId] ?? CLOSED), ...patch },
    };
    latest.current = next;
    setByPackage(next);
  }, []);

  const toggle = useCallback(
    async (packageId: string) => {
      const cur = latest.current[packageId] ?? CLOSED;
      if (cur.open) return put(packageId, { open: false });
      if (cur.rows !== null || cur.loading) return put(packageId, { open: true });

      put(packageId, { open: true, loading: true, error: null });
      const { data, error } = await fetchPackageUsage(packageId);
      put(packageId, {
        loading: false,
        rows: error ? null : ((data ?? []) as PackageUsageRow[]),
        error: error
          ? "Couldn't load the lessons this package paid for. Close and open it to try again."
          : null,
      });
    },
    [put]
  );

  const stateOf = (packageId: string): UsageState => byPackage[packageId] ?? CLOSED;

  return { stateOf, toggle };
}

export type PackageUsage = ReturnType<typeof usePackageUsage>;
