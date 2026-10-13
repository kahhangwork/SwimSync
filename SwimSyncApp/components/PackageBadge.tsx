import React from "react";
import { Text } from "react-native";
import type { StudentCoverage } from "../lib/packageCoverage";

// The per-child payment-method line: "Package · 8 left" / "Ad-hoc" —
// explicit BOTH ways, so a missing line is never the signal. It renders
// nothing only when there is no coverage row at all (the RPC failed, or the
// child is not linked to this parent) — fail-safe is no line, never a wrong
// label. The count is what THIS child can use — shared packages for every
// sibling, a one-child package for its own child only (single-child packages);
// detail screens spell that out via describeCoverage(). 'mixed' is structurally unreachable while
// one_active_enrolment_per_student stands; the branch keeps a lifted
// constraint honest instead of mislabelling.
//
// UI restyle step 3.4: a plain Body Secondary line, not a pill. How a child is
// paid for is a fact, not a status — the card's one tag is kept for a state
// that needs attention (DESIGN.md: one tag per card). The words are unchanged:
// verify-packages and verify-single-child-packages read them.
export default function PackageBadge({
  coverage,
}: {
  coverage: StudentCoverage | undefined;
}) {
  if (!coverage) return null;

  if (coverage.coverage === "ad_hoc") {
    return <Text className="text-body-secondary text-ink-secondary">Ad-hoc</Text>;
  }

  const n = coverage.lessonsRemaining ?? 0;
  const label = coverage.coverage === "mixed" ? "Mixed" : "Package";
  return (
    <Text className="text-body-secondary text-ink-secondary">
      {label} · {n} left
    </Text>
  );
}
