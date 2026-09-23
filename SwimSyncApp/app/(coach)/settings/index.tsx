import React, { useEffect } from "react";
import { ScrollView, SafeAreaView } from "react-native";
import { useCoachSettings } from "@/features/coach-settings/domain/useCoachSettings";
import { Avatar } from "@/features/coach-settings/ui/Avatar";
import { PayNowQrCard } from "@/features/coach-settings/ui/PayNowQrCard";
import { AdminPanelCard } from "@/features/coach-settings/ui/AdminPanelCard";
import { AccountCard } from "@/features/coach-settings/ui/AccountCard";
import { MenuCard } from "@/features/coach-settings/ui/MenuCard";
import { SignOutButton } from "@/features/coach-settings/ui/SignOutButton";

// The coach Settings tab — composition only (docs/refactor/BATCH_FGH_PLAN.md, App L-H).
// State, the load, the fallback-QR upload and Sign Out live in
// features/coach-settings/domain/useCoachSettings (Storage + queries in …/dao),
// markup in …/ui. The one effect is here, keyed on loadCoach's identity.
export default function CoachSettingsScreen() {
  const {
    session,
    paynowUrl,
    uploading,
    canEditQr,
    hasPaynowId,
    showQrUpload,
    setShowQrUpload,
    loadCoach,
    openAdminPanel,
    handleUploadQR,
    confirmLogout,
  } = useCoachSettings();

  useEffect(() => {
    loadCoach();
  }, [loadCoach]);

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <Avatar session={session} />

        <PayNowQrCard hasPaynowId={hasPaynowId} showQrUpload={showQrUpload} setShowQrUpload={setShowQrUpload} paynowUrl={paynowUrl} uploading={uploading} handleUploadQR={handleUploadQR} />

        <AdminPanelCard canEditQr={canEditQr} openAdminPanel={openAdminPanel} />

        <AccountCard session={session} />

        <MenuCard />

        <SignOutButton confirmLogout={confirmLogout} />
      </ScrollView>
    </SafeAreaView>
  );
}
