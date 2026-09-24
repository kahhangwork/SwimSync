// The per-child coverage verdict, and the business's "running low" thresholds
// READ for display beside the filter. Stage 10 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md.
//
// The thresholds are EDITED on the Packages page since 2026-09-24 (plan §10's
// BACKLOG item: tenant package configuration does not belong on Students).
// Nothing here writes them.
//
// `tenantId` is read here as a by-product of the settings fetch and is also
// what the grading grid and the add-student duplicate check key on.

import { useState } from "react";
import { coverageByStudent, type StudentCoverage } from "@/lib/packageCoverage";
import * as repo from "../dao/students.repo";
import * as rpc from "../dao/students.rpc";
import type { StudentRow } from "../types";

export function usePackageSettings() {
  const [threshold, setThreshold] = useState("2");
  const [expiryDays, setExpiryDays] = useState("14");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(new Map());

  async function loadPackages() {
    const { data: userRes } = await repo.getCurrentUser();
    const { data: prof } = await repo.fetchTenantPackageSettings(userRes.user?.id);
    setTenantId((prof as any)?.tenant_id ?? null);
    const stored = (prof as any)?.tenants?.low_package_lessons;
    if (stored !== null && stored !== undefined) setThreshold(String(stored));
    const storedDays = (prof as any)?.tenants?.package_expiry_warning_days;
    if (storedDays !== null && storedDays !== undefined)
      setExpiryDays(String(storedDays));

    // Per-child verdict, category- and expiry-aware, computed in SQL. The old
    // code summed package_live_balances() by parent here, which said "10 left"
    // beside a child whose class the package could never pay for, and counted
    // date-expired packages too.
    const { data: cov } = await rpc.fetchPackageCoverage();
    setCovMap(coverageByStudent(cov ?? []));
  }

  // ⚠ RISK 10 — "running low" is now the SQL `low` verdict (lessons OR expiry,
  // minus families with an open row), so this filter AGREES with Generate-all's
  // candidate list. No TS re-derivation.
  const runningLow = (s: StudentRow) => covMap.get(s.id)?.low === true;

  return {
    threshold,
    expiryDays,
    tenantId,
    covMap,
    loadPackages,
    runningLow,
  };
}

export type PackageSettingsState = ReturnType<typeof usePackageSettings>;
