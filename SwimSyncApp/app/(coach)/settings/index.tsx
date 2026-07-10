import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PLACEHOLDER_COACH } from "@/constants/placeholder";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";

export default function CoachSettingsScreen() {
  const session = useAppStore((s) => s.session);
  const clearSession = useAppStore((s) => s.clearSession);

  async function handleLogout() {
    await supabase.auth.signOut();
    clearSession();
    router.replace("/(auth)/login");
  }

  function confirmLogout() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: handleLogout },
    ]);
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

          {PLACEHOLDER_COACH.hasPayNowQR ? (
            <View className="items-center mb-4">
              <View className="w-36 h-36 bg-gray-100 rounded-2xl items-center justify-center mb-3">
                <Ionicons name="qr-code" size={60} color="#6b7280" />
                <Text className="text-xs text-gray-400 mt-1">Current QR</Text>
              </View>
              <Text className="text-xs text-gray-500">
                Last updated: 1 Mar 2026
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
              PLACEHOLDER_COACH.hasPayNowQR ? "Replace QR Code" : "Upload QR Code"
            }
            variant="outline"
            onPress={() => {}}
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
            icon="notifications-outline"
            label="Notification Preferences"
            onPress={() => {}}
          />
          <MenuItem
            icon="lock-closed-outline"
            label="Change Password"
            onPress={() => {}}
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
