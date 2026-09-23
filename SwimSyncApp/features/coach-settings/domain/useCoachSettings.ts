// The coach Settings tab's state, its load, the fallback-QR upload and Sign Out
// (docs/refactor/BATCH_FGH_PLAN.md, App L-H). Moved VERBATIM from
// app/(coach)/settings/index.tsx — store reads, state, loadCoach (deps [session]),
// the handlers; builders are dao calls. The mount effect that calls loadCoach
// stays on the route.
//
// ⚠ The one Alert.alert in the app lives here: the NATIVE media-permission
// branch (Platform.OS !== "web"), never reached on the web build (plan ⚠ R8
// counts it). The upload's try/finally is unchanged. No verify-* driver presses
// Upload or Sign Out — L4-H hand-checks both (plan ⚠ R5).
import { useState, useCallback } from "react";
import { Alert, Platform, Linking } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useAppStore } from "@/store/useAppStore";
import { confirmAction } from "@/lib/confirm";
import { ADMIN_PANEL_URL } from "../constants";
import {
  fetchCoach,
  fetchTenantPaynow,
  fetchProfileRole,
  updateTenantQrUrl,
} from "../dao/coachSettings.repo";
import { readImageBytes, uploadQrImage, qrPublicUrl } from "../dao/coachSettings.storage";
import { signOut } from "../dao/coachSettings.auth";

export function useCoachSettings() {
  const session = useAppStore((s) => s.session);
  const clearSession = useAppStore((s) => s.clearSession);
  const showToast = useAppStore((s) => s.showToast);

  const [coachId, setCoachId] = useState<string | null>(null);
  const [paynowUrl, setPaynowUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // The QR belongs to the BUSINESS now, not the coach: a school with three
  // coaches has one bank account. So only the business's admin may set it —
  // which a private coach is, for their own tenant of one. A school coach sees
  // the QR but cannot change it.
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [canEditQr, setCanEditQr] = useState(false);
  // Since 2026-08-02 the PRIMARY way a parent pays is a computed dynamic QR
  // built from the business's PayNow ID (uen/mobile), set on the admin panel.
  // The uploaded image is the fallback for native builds and for a business
  // that has not entered an ID yet.
  const [hasPaynowId, setHasPaynowId] = useState(false);
  // The upload is ALWAYS reachable, just collapsed. Deliberately not hidden
  // when a PayNow ID exists: a stored-but-unencodable ID (sgPhone normalises
  // by stripping non-digits and never blocks, so a nine-digit typo saves
  // fine) makes buildPayNowPayload throw, the parent's screen falls back to
  // the image — and if this upload had been removed there is no image, and
  // NOBODY at that business can be paid. Hiding it is one typo away from an
  // outage; a disclosure is not.
  const [showQrUpload, setShowQrUpload] = useState(false);

  const loadCoach = useCallback(async () => {
    if (!session) return;
    const { data } = await fetchCoach(session);
    if (!data) return;

    setCoachId(data.id);
    setTenantId(data.tenant_id);

    const [{ data: tenant }, { data: profile }] = await Promise.all([
      fetchTenantPaynow(data.tenant_id),
      fetchProfileRole(session),
    ]);

    setPaynowUrl(tenant?.paynow_qr_url ?? null);
    setHasPaynowId(
      Boolean(tenant?.paynow_uen?.trim() || tenant?.paynow_mobile?.trim())
    );
    setCanEditQr(profile?.role === "tenant_admin");
  }, [session]);

  function openAdminPanel() {
    if (Platform.OS === "web") {
      // New tab: this is a different site, and losing the app's state to
      // navigate away from it is not what "open my admin panel" means.
      window.open(ADMIN_PANEL_URL, "_blank", "noopener,noreferrer");
      return;
    }
    Linking.openURL(ADMIN_PANEL_URL);
  }

  async function handleUploadQR() {
    if (uploading) return;
    if (!canEditQr) {
      showToast(
        "Your school manages the payment QR code. Ask your admin to update it.",
        "error"
      );
      return;
    }
    if (!tenantId) {
      showToast("Could not find your business account.", "error");
      return;
    }

    // Native needs media-library permission; web uses a file picker (no perm).
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permission needed",
          "Please allow photo access to upload your QR code."
        );
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];

    try {
      setUploading(true);

      // Read the picked image into bytes (works on web + native).
      const bytes = await readImageBytes(asset.uri);
      const contentType = asset.mimeType ?? "image/png";

      // TENANT-scoped path: the storage policy checks the first path segment
      // against the caller's tenant (it used to be the coach's id).
      const path = `${tenantId}/paynow-qr`;

      const { error: upErr } = await uploadQrImage(path, bytes, contentType);
      if (upErr) throw upErr;

      // Public bucket → render without a signed URL. Cache-bust so a
      // replaced image re-renders instead of showing the cached one.
      const { data: pub } = qrPublicUrl(path);
      const publicUrl = `${pub.publicUrl}?t=${Date.now()}`;

      const { error: updErr } = await updateTenantQrUrl(tenantId, publicUrl);
      if (updErr) throw updErr;

      setPaynowUrl(publicUrl);
      showToast("Your PayNow QR code has been updated.", "success");
    } catch (e: any) {
      showToast(e?.message ?? "Upload failed. Please try again.", "error");
    } finally {
      setUploading(false);
    }
  }

  async function handleLogout() {
    await signOut();
    clearSession();
    router.replace("/(auth)/login");
  }

  function confirmLogout() {
    confirmAction(
      "Sign Out",
      "Are you sure you want to sign out?",
      handleLogout,
      "Sign Out"
    );
  }

  return {
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
  };
}
