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
  /** Family-shared live lessons remaining; null when ad_hoc. */
  lessonsRemaining: number | null;
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
    });
  }
  return map;
}

/** The badge's one-line description for detail screens (child profile). */
export function describeCoverage(c: StudentCoverage | undefined): string | null {
  if (!c) return null;
  if (c.coverage === "ad_hoc") return "Ad-hoc — billed per lesson";
  const n = c.lessonsRemaining ?? 0;
  const lessons = `${n} lesson${n === 1 ? "" : "s"} left`;
  return c.coverage === "mixed"
    ? `Mixed — ${lessons} · some classes bill per lesson`
    : `Package — ${lessons} · shared across the family`;
}
