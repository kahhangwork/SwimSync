import React, { useCallback } from "react";
import { ScrollView, SafeAreaView } from "react-native";
import { useFocusEffect } from "expo-router";
import { useParentHome } from "@/features/parent-home/domain/useParentHome";
import { useSignupJoinCode } from "@/features/parent-home/domain/useSignupJoinCode";
import { Greeting } from "@/features/parent-home/ui/Greeting";
import { MoneySummary } from "@/features/parent-home/ui/MoneySummary";
import { ClaimNotices } from "@/features/parent-home/ui/ClaimNotices";
import { ChildrenSection } from "@/features/parent-home/ui/ChildrenSection";

// The parent Home tab — composition only (docs/refactor/BATCH_FGH_PLAN.md, App L-F).
// The load lives in features/parent-home/domain/useParentHome (queries in …/dao,
// the pure mapping in …/homeRows), the signup-join-code effect in
// …/useSignupJoinCode, markup in …/ui.
//
// ⚠ EFFECT ORDER IS THE ROUTE'S ORIGINAL ORDER: the join-code effect is declared
// before the focus reload, exactly as it was when both lived here. Both are keyed
// on loadData's identity, which is why useParentHome returns its useCallback
// unwrapped (plan ⚠ R4).
export default function ParentHomeScreen() {
  const {
    session,
    showToast,
    children,
    covMap,
    creditBalance,
    totalOutstanding,
    loading,
    claims,
    dismissClaim,
    loadData,
  } = useParentHome();

  // Reload every time the screen comes into focus (e.g. after adding a child)
  useSignupJoinCode(session, showToast, loadData);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <Greeting session={session} />

        <MoneySummary totalOutstanding={totalOutstanding} creditBalance={creditBalance} />

        <ClaimNotices claims={claims} dismissClaim={dismissClaim} />

        <ChildrenSection loading={loading} children={children} covMap={covMap} />
      </ScrollView>
    </SafeAreaView>
  );
}
