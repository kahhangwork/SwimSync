// The logo, the business and the package name.
// Moved VERBATIM from app/package/[token].tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-G); props destructured on the first line so the JSX is byte-identical
// (whitespace aside). Restyled in UI restyle step 4.6 (Display title).
import React from "react";
import { Text, View } from "react-native";
import Logo from "@/components/Logo";
import type { PublicPackage } from "../types";

export function PageHeader(p: { pkg: PublicPackage }) {
  const { pkg } = p;
  return (
    <>
      <View className="items-center mb-6">
        <Logo size="lg" className="mb-3" />
        <Text className="text-display font-semibold text-ink text-center">
          {pkg.business_name}
        </Text>
        <Text className="text-body text-ink-secondary mt-1 text-center">Package · {pkg.package_name}</Text>
      </View>
    </>
  );
}
