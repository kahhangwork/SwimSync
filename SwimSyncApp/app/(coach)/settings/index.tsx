import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Image,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import { confirmAction } from "@/lib/confirm";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";

export default function CoachSettingsScreen() {
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

  const loadCoach = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase
      .from("coaches")
      .select("id, tenant_id")
      .eq("profile_id", session.id)
      .single();
    if (!data) return;

    setCoachId(data.id);
    setTenantId(data.tenant_id);

    const [{ data: tenant }, { data: profile }] = await Promise.all([
      supabase
        .from("tenants")
        .select("paynow_qr_url")
        .eq("id", data.tenant_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("role")
        .eq("id", session.id)
        .maybeSingle(),
    ]);

    setPaynowUrl(tenant?.paynow_qr_url ?? null);
    setCanEditQr(profile?.role === "tenant_admin");
  }, [session]);

  useEffect(() => {
    loadCoach();
  }, [loadCoach]);

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
      const bytes = await (await fetch(asset.uri)).arrayBuffer();
      const contentType = asset.mimeType ?? "image/png";

      // TENANT-scoped path: the storage policy checks the first path segment
      // against the caller's tenant (it used to be the coach's id).
      const path = `${tenantId}/paynow-qr`;

      const { error: upErr } = await supabase.storage
        .from("paynow-qr")
        .upload(path, bytes, { contentType, upsert: true });
      if (upErr) throw upErr;

      // Public bucket → render without a signed URL. Cache-bust so a
      // replaced image re-renders instead of showing the cached one.
      const { data: pub } = supabase.storage
        .from("paynow-qr")
        .getPublicUrl(path);
      const publicUrl = `${pub.publicUrl}?t=${Date.now()}`;

      const { error: updErr } = await supabase
        .from("tenants")
        .update({ paynow_qr_url: publicUrl })
        .eq("id", tenantId);
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
    await supabase.auth.signOut();
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

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar */}
        <View className="items-center mb-8">
          <View className="w-20 h-20 rounded-full bg-sky-500 items-center justify-center mb-3">
            <Text className="text-white text-3xl font-bold">
              {session?.fullName?.charAt(0) ?? "?"}
            </Text>
          </View>
          <Text className="text-xl font-bold text-gray-900">
            Coach {session?.fullName ?? "—"}
          </Text>
          <Text className="text-sm text-gray-500">{session?.email ?? "—"}</Text>
        </View>

        {/* PayNow QR Management */}
        <Card className="mb-4">
          <View className="flex-row items-center gap-2 mb-4">
            <Ionicons name="qr-code-outline" size={20} color="#0ea5e9" />
            <Text className="text-base font-bold text-gray-900">
              PayNow QR Code
            </Text>
          </View>

          {paynowUrl ? (
            <View className="items-center mb-4">
              <Image
                source={{ uri: paynowUrl }}
                className="w-36 h-36 rounded-2xl mb-3"
                resizeMode="contain"
              />
              <Text className="text-xs text-gray-500">
                Parents see this QR on their invoices.
              </Text>
            </View>
          ) : (
            <View className="bg-yellow-50 rounded-xl p-3 mb-4">
              <Text className="text-sm text-yellow-700">
                No PayNow QR uploaded yet. Parents cannot make PayNow payments
                until you upload your QR code.
              </Text>
            </View>
          )}

          <PrimaryButton
            label={
              uploading
                ? "Uploading…"
                : paynowUrl
                ? "Replace QR Code"
                : "Upload QR Code"
            }
            variant="outline"
            onPress={handleUploadQR}
          />
        </Card>

        {/* Account */}
        <Card className="mb-4">
          <Text className="text-base font-bold text-gray-900 mb-3">
            Account Details
          </Text>
          <View className="gap-2">
            <Row label="Name"  value={session?.fullName ?? "—"} icon="person-outline" />
            <Row label="Email" value={session?.email ?? "—"}    icon="mail-outline" />
          </View>
        </Card>

        {/* Menu */}
        <Card className="mb-4">
          <MenuItem
            icon="lock-closed-outline"
            label="Change Password"
            onPress={() => router.push("/(coach)/settings/change-password")}
            last
          />
        </Card>

        {/* Logout */}
        <TouchableOpacity
          onPress={confirmLogout}
          className="bg-red-50 border border-red-100 rounded-2xl py-4 items-center"
          activeOpacity={0.8}
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name="log-out-outline" size={20} color="#dc2626" />
            <Text className="text-red-600 font-semibold">Sign Out</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <View className="flex-row items-center gap-3 py-1.5">
      <Ionicons name={icon as any} size={16} color="#9ca3af" />
      <Text className="text-sm text-gray-500 w-14">{label}</Text>
      <Text className="text-sm font-medium text-gray-800 flex-1">{value}</Text>
    </View>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  last = false,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className={`flex-row items-center gap-3 py-3.5 ${
        !last ? "border-b border-gray-100" : ""
      }`}
    >
      <Ionicons name={icon as any} size={20} color="#6b7280" />
      <Text className="flex-1 text-sm text-gray-700">{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
    </TouchableOpacity>
  );
}
