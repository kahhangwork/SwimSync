import type { CoverageLabel } from "@/lib/packageCoverage";

// The per-child payment-method chip: "Package · 8 left" / "Ad-hoc" — explicit
// BOTH ways, so absence of a chip is never the signal. It renders nothing only
// when there is no coverage row at all: an unclaimed child (no family to have
// a payment method — they carry the amber "No parent account" badge instead)
// or an RPC that failed to load (fail-safe is no chip, not a wrong label).
//
// The count is FAMILY-SHARED — two siblings both read "8 left" from the same
// pool — and the tooltip says so. 'mixed' is structurally unreachable while
// one_active_enrolment_per_student stands; the branch is here so a lifted
// constraint degrades to an honest label instead of a lie.
export function PackageChip({
  coverage,
  lowThreshold = null,
  title,
}: {
  coverage: CoverageLabel | undefined;
  lowThreshold?: number | null;
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
  const low = lowThreshold !== null && n <= lowThreshold;
  const label = coverage.coverage === "mixed" ? "Mixed" : "Package";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
        low ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
      }`}
      title={
        title ??
        (coverage.coverage === "mixed"
          ? "Covers some of this child's classes; others bill per lesson. "
          : "") +
          "Prepaid lessons remaining, shared across the family, counting attended-but-uninvoiced lessons"
      }
    >
      {label} · {n} left
    </span>
  );
}
