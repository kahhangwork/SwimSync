// student_package_coverage() rows → a per-child lookup for the payment-method
// badge. MIRROR of SwimSyncAdmin/lib/packageCoverage.ts (row-shaping only):
// the verdict and the count are computed in SQL — the only derivation,
// PACKAGES_DESIGN.md ⚠ RISK 4 — so this mirror cannot drift on the logic,
// only on the shape.
//
// Tolerant of null/undefined/garbage BY DESIGN: an RPC error must degrade to
// "no badge rendered", never to a screen that fails to load.

export type CoverageVerdict = "package" | "mixed" | "ad_hoc";

export type StudentCoverage = {
  parentId: string;
  tenantId: string;
  coverage: CoverageVerdict;
  /** Live lessons this child can draw on (shared packages, or their own one-child
   *  package — single-child packages); null when ad_hoc. */
  lessonsRemaining: number | null;
  /** The covering package SQL chose to show (student_package_coverage().package_id). */
  packageId: string | null;
  /** True when that package is THIS child's own one-child package. Never from
   *  the coverage row (its columns are unchanged, RISK 5): the caller looks the
   *  package up in the parent's own packages and sets it. */
  own?: boolean;
};

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
      package_id?: unknown;
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
      packageId: typeof r.package_id === "string" ? r.package_id : null,
    });
  }
  return map;
}

/** The badge's one-line description for detail screens (child profile).
 *  "shared across the family" only when the counted package IS shared; a
 *  child's own one-child package reads "<name>'s own". */
export function describeCoverage(
  c: StudentCoverage | undefined,
  childName?: string | null
): string | null {
  if (!c) return null;
  if (c.coverage === "ad_hoc") return "Ad-hoc — billed per lesson";
  const n = c.lessonsRemaining ?? 0;
  const lessons = `${n} lesson${n === 1 ? "" : "s"} left`;
  return c.coverage === "mixed"
    ? `Mixed — ${lessons} · some classes bill per lesson`
    : c.own
      ? `Package — ${lessons} · ${childName ? `${childName}'s` : "this child's"} own`
      : `Package — ${lessons} · shared across the family`;
}
