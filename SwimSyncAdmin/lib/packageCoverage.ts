// student_package_coverage() rows → a per-child lookup for the payment-method
// chip. Pure row-shaping: the verdict and the count are computed in SQL (the
// only derivation — PACKAGES_DESIGN.md ⚠ RISK 4); this file only indexes them.
//
// Tolerant of null/undefined/garbage BY DESIGN: an RPC error must degrade to
// "no chip rendered", never to a page that fails to load. Callers pass
// `cov ?? []` and get an empty Map on the worst day.

export type CoverageVerdict = "package" | "mixed" | "ad_hoc";

export type StudentCoverage = {
  parentId: string;
  tenantId: string;
  coverage: CoverageVerdict;
  /** Family-shared live lessons remaining; null when ad_hoc. */
  lessonsRemaining: number | null;
  /** ⚠ RISK 2/10 — the FAMILY "running low" verdict, computed in SQL (lessons
   *  OR expiry, minus families that already have an open row). The Students
   *  filter/amber read THIS; the old TS isRunningLow is gone so there is one
   *  definition of "low", in SQL, everywhere. */
  low: boolean;
  /** The covering package to SHOW: earliest-expiring with live lessons left. */
  packageId: string | null;
  packageName: string | null;
  expiresOn: string | null;
};

/** What the chip needs: family-grain callers synthesise this from
 *  familyLessonsByParent() without inventing a fake student row. */
export type CoverageLabel = Pick<
  StudentCoverage,
  "coverage" | "lessonsRemaining"
>;

const VERDICTS: ReadonlySet<string> = new Set(["package", "mixed", "ad_hoc"]);

export function coverageByStudent(
  rows: unknown
): Map<string, StudentCoverage> {
  const map = new Map<string, StudentCoverage>();
  if (!Array.isArray(rows)) return map;
  for (const raw of rows) {
    const r = raw as {
      student_id?: unknown;
      parent_id?: unknown;
      tenant_id?: unknown;
      coverage?: unknown;
      lessons_remaining?: unknown;
      low?: unknown;
      package_id?: unknown;
      package_name?: unknown;
      expires_on?: unknown;
    } | null;
    if (
      !r ||
      typeof r.student_id !== "string" ||
      typeof r.parent_id !== "string" ||
      typeof r.tenant_id !== "string" ||
      typeof r.coverage !== "string" ||
      !VERDICTS.has(r.coverage)
    )
      continue;
    map.set(r.student_id, {
      parentId: r.parent_id,
      tenantId: r.tenant_id,
      coverage: r.coverage as CoverageVerdict,
      lessonsRemaining:
        typeof r.lessons_remaining === "number" ? r.lessons_remaining : null,
      low: r.low === true,
      packageId: typeof r.package_id === "string" ? r.package_id : null,
      packageName: typeof r.package_name === "string" ? r.package_name : null,
      expiresOn: typeof r.expires_on === "string" ? r.expires_on : null,
    });
  }
  return map;
}

// FAMILY-grain aggregation for pages whose rows are parents, not children
// (Parents, Claims). "Does this family hold a live package at this business,
// and how many lessons across it?" — deliberately NOT category-aware, because
// at family grain there is no class to match against; the per-child verdict
// is coverageByStudent()'s job. Sums live_lessons_remaining like SQL does,
// and applies the same expiry filter the RPC applies server-side —
// package_live_balances() itself returns date-expired 'active' rows.
export function familyLessonsByParent(
  rows: unknown,
  todaySg: string
): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(rows)) return map;
  for (const raw of rows) {
    const r = raw as {
      parent_id?: unknown;
      expires_on?: unknown;
      live_lessons_remaining?: unknown;
    } | null;
    if (
      !r ||
      typeof r.parent_id !== "string" ||
      typeof r.expires_on !== "string" ||
      r.expires_on < todaySg
    )
      continue;
    const n =
      typeof r.live_lessons_remaining === "number"
        ? r.live_lessons_remaining
        : Number(r.live_lessons_remaining ?? 0);
    if (!Number.isFinite(n)) continue;
    map.set(r.parent_id, (map.get(r.parent_id) ?? 0) + n);
  }
  return map;
}

// ⚠ RISK 10 — isRunningLow() was DELETED. "Low" is now one definition, in SQL
// (student_package_coverage().low: lessons OR expiry, minus open-row families),
// so the Students filter/amber must read StudentCoverage.low. A second copy here
// would drift from Generate-all's candidate list.

/** Family-grain chip input: a family with any live package reads "Package ·
 *  N left"; one without reads "Ad-hoc". */
export function familyLabel(
  byParent: Map<string, number>,
  parentId: string | null | undefined
): CoverageLabel {
  if (parentId && byParent.has(parentId)) {
    return {
      coverage: "package",
      lessonsRemaining: byParent.get(parentId) ?? 0,
    };
  }
  return { coverage: "ad_hoc", lessonsRemaining: null };
}
