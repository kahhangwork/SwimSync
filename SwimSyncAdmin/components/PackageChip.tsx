import type { CoverageLabel } from "@/lib/packageCoverage";

// The per-child payment-method chip: "Package · 8 left" / "Ad-hoc" — explicit
// BOTH ways, so absence of a chip is never the signal. It renders nothing only
// when there is no coverage row at all: an unclaimed child (no family to have
// a payment method — they carry the amber "No parent account" badge instead)
// or an RPC that failed to load (fail-safe is no chip, not a wrong label).
//
// The count is what THIS CHILD can draw on (single-child packages,
// 20261010000100): shared packages count for every sibling — two siblings both
// read "8 left" from the same pool — while a one-child package counts only for
// its own child, so a sibling reads "Ad-hoc". The tooltip says so. 'mixed' is structurally unreachable while
// one_active_enrolment_per_student stands; the branch is here so a lifted
// constraint degrades to an honest label instead of a lie.
// ⚠ RISK 10 — the amber "running low" styling was REMOVED: "low" is now a SQL
// verdict shown only on the Students page's own columns, so a second threshold
// here (the old `lowThreshold` prop) would be a duplicate definition. This chip
// is a pure coverage label now.
export function PackageChip({
  coverage,
  title,
}: {
  coverage: CoverageLabel | undefined;
  /** Override tooltip — family-grain surfaces word it per family. */
  title?: string;
}) {
  if (!coverage) return null;

  if (coverage.coverage === "ad_hoc") {
    return (
      <span
        className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500"
        title={
          title ??
          "Billed per lesson by invoice — no prepaid package covers this child's class"
        }
      >
        Ad-hoc
      </span>
    );
  }

  const n = coverage.lessonsRemaining ?? 0;
  const label = coverage.coverage === "mixed" ? "Mixed" : "Package";
  return (
    <span
      className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700"
      title={
        title ??
        (coverage.coverage === "mixed"
          ? "Covers some of this child's classes; others bill per lesson. "
          : "") +
          "Prepaid lessons this child can use — a shared package counts for every sibling, a one-child package for its own child only — counting attended-but-uninvoiced lessons"
      }
    >
      {label} · {n} left
    </span>
  );
}
