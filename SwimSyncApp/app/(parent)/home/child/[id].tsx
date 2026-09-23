import React, { useCallback } from "react";
import { ScrollView, SafeAreaView } from "react-native";
import { useFocusEffect } from "expo-router";
import { useChildProfile } from "@/features/child-profile/domain/useChildProfile";
import { LoadingView } from "@/features/child-profile/ui/LoadingView";
import { NotFoundView } from "@/features/child-profile/ui/NotFoundView";
import { Header } from "@/features/child-profile/ui/Header";
import { ProfileCard } from "@/features/child-profile/ui/ProfileCard";
import { LevelCard } from "@/features/child-profile/ui/LevelCard";
import { ClassAssignmentCard } from "@/features/child-profile/ui/ClassAssignmentCard";
import { BalancesCard } from "@/features/child-profile/ui/BalancesCard";
import { QuickActions } from "@/features/child-profile/ui/QuickActions";

// Child Profile — composition only (docs/refactor/BATCH_FGH_PLAN.md, App L-F). The
// load lives in features/child-profile/domain/useChildProfile (queries in …/dao,
// the pure mapping in …/childFormat), markup in …/ui. The two early returns keep
// their original order: loading first, then not-found.
export default function ChildProfileScreen() {
  const { child, coverage, loading, loadChild, age } = useChildProfile();

  useFocusEffect(
    useCallback(() => {
      loadChild();
    }, [loadChild])
  );

  if (loading) {
    return <LoadingView />;
  }

  if (!child) {
    return <NotFoundView />;
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <Header />

      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-4"
        showsVerticalScrollIndicator={false}
      >
        <ProfileCard child={child} age={age} />

        <LevelCard child={child} />

        <ClassAssignmentCard child={child} />

        <BalancesCard child={child} coverage={coverage} />

        <QuickActions />
      </ScrollView>
    </SafeAreaView>
  );
}
