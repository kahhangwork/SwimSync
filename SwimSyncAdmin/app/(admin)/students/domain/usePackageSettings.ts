// Tenant package settings and the per-child coverage verdict. Stage 10 of
// docs/refactor/STUDENTS_PAGE_REFACTOR_PLAN.md. Lifted from page.tsx intact.
//
// ⚠ PLAN §10: this is TENANT-LEVEL PACKAGE CONFIGURATION living on the
// Students screen. It belongs on Packages. Moving it is a behaviour change,
// not a refactor, so it is extracted here IN PLACE and left. (BACKLOG.)
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

  async function saveThreshold(value: string) {
    setThreshold(value);
    // Empty BEFORE coercing (§7.22): an empty field must not save 0.
    if (value.trim() === "" || !Number.isInteger(Number(value)) || Number(value) < 0)
      return;
    if (!tenantId) return;
    await repo.updateLowPackageLessons(tenantId, Number(value));
  }

  async function saveExpiryDays(value: string) {
    setExpiryDays(value);
    if (value.trim() === "" || !Number.isInteger(Number(value)) || Number(value) < 0)
      return;
    if (!tenantId) return;
    await repo.updatePackageExpiryDays(tenantId, Number(value));
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
    saveThreshold,
    saveExpiryDays,
    runningLow,
  };
}

export type PackageSettingsState = ReturnType<typeof usePackageSettings>;
