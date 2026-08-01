import React from "react";
import { View, Text } from "react-native";
import type { StudentCoverage } from "../lib/packageCoverage";

// The per-child payment-method badge: "Package · 8 left" / "Ad-hoc" —
// explicit BOTH ways, so a missing badge is never the signal. It renders
// nothing only when there is no coverage row at all (the RPC failed, or the
// child is not linked to this parent) — fail-safe is no badge, never a wrong
// label. The count is FAMILY-SHARED; detail screens spell that out via
// describeCoverage(). 'mixed' is structurally unreachable while
// one_active_enrolment_per_student stands; the branch keeps a lifted
// constraint honest instead of mislabelling.
export default function PackageBadge({
  coverage,
}: {
  coverage: StudentCoverage | undefined;
}) {
  if (!coverage) return null;

  if (coverage.coverage === "ad_hoc") {
    return (
      <View className="rounded-full bg-gray-100 px-2 py-0.5 self-start">
        <Text className="text-xs font-medium text-gray-500">Ad-hoc</Text>
      </View>
    );
  }

  const n = coverage.lessonsRemaining ?? 0;
  const label = coverage.coverage === "mixed" ? "Mixed" : "Package";
  return (
    <View className="rounded-full bg-emerald-100 px-2 py-0.5 self-start">
      <Text className="text-xs font-semibold text-emerald-700">
        {label} · {n} left
      </Text>
    </View>
  );
}
