import React, { useCallback } from "react";
import { ScrollView, SafeAreaView } from "react-native";
import { useFocusEffect } from "expo-router";
import { useCoachClasses } from "@/features/coach-classes/domain/useCoachClasses";
import { Heading } from "@/features/coach-classes/ui/Heading";
import { LocationChips } from "@/features/coach-classes/ui/LocationChips";
import { ClassList } from "@/features/coach-classes/ui/ClassList";

// The coach Classes tab — composition only (docs/refactor/BATCH_FGH_PLAN.md, App L-H).
// State, the location filter, the weekday grouping and the load live in
// features/coach-classes/domain/useCoachClasses, markup in …/ui. The one effect is
// here, keyed on loadClasses' identity.
export default function ClassesScreen() {
  const {
    classes,
    loading,
    setLocationFilter,
    locationOpts,
    effLocationFilter,
    groups,
    loadClasses,
  } = useCoachClasses();

  useFocusEffect(
    useCallback(() => {
      loadClasses();
    }, [loadClasses])
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <Heading />

        <LocationChips locationOpts={locationOpts} effLocationFilter={effLocationFilter} setLocationFilter={setLocationFilter} />

        <ClassList loading={loading} classes={classes} groups={groups} />
      </ScrollView>
    </SafeAreaView>
  );
}
