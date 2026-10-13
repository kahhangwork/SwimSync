import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import { useParentProfile } from "@/features/profile/domain/useParentProfile";

// The parent Profile tab (docs/refactor/BATCH_FGH_PLAN.md, app fence): the markup
// stays here; the session read and Sign Out live in
// features/profile/domain/useParentProfile.
//
// UI restyle step 3.10 — the same shape as the coach's Settings (step 2.7): no
// avatar circle, flat cards, 44px menu rows, Sign Out a destructive control behind
// confirmLogout's confirmation.

export default function ParentProfileScreen() {
  const { session, confirmLogout } = useParentProfile();

  return (
    <SafeAreaView className="flex-1 bg-ground">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-5">
          <Text className="text-display font-semibold text-ink">
            {session?.fullName ?? "—"}
          </Text>
          <Text className="text-body-secondary text-ink-secondary mt-0.5">{session?.email ?? "—"}</Text>
        </View>

        {/* Account info */}
        <Surface className="mb-3">
          <Text className="text-headline font-semibold text-ink mb-2">
            Account Details
          </Text>
          <View>
            <Row label="Name"  value={session?.fullName ?? "—"} icon="person-outline" />
            <Row label="Email" value={session?.email ?? "—"}    icon="mail-outline" />
          </View>
        </Surface>

        {/* Menu items */}
        <Surface className="mb-4 py-1">
          <MenuItem
            icon="person-add-outline"
            label="Add Child Profile"
            onPress={() => router.push("/(parent)/home/add-child")}
          />
          <MenuItem
            icon="location-outline"
            label="Contact Details"
            onPress={() => router.push("/(parent)/profile/contact")}
          />
          <MenuItem
            icon="lock-closed-outline"
            label="Change Password"
            onPress={() => router.push("/(parent)/profile/change-password")}
            last
          />
        </Surface>

        {/* Logout — DESIGN.md's destructive control: secondary shape, Danger
            text, behind confirmLogout's confirmation. The word is the
            pressable's direct child (pressByText dispatches on the leaf's
            parent). */}
        <TouchableOpacity
          onPress={confirmLogout}
          className="min-h-11 flex-row items-center justify-center gap-2 rounded-control border border-border-strong bg-surface"
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={18} color="#b91c1c" />
          <Text className="text-body font-semibold text-status-danger-text">Sign Out</Text>
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
    <View className="flex-row items-center gap-3 py-2">
      <Ionicons name={icon as any /* db-any-ok: icon */} size={16} color="#6b6b6b" />
      <Text className="text-body text-ink-secondary w-14">{label}</Text>
      <Text className="text-body font-medium text-ink flex-1">{value}</Text>
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
      className={
        last
          ? "min-h-11 flex-row items-center gap-3 py-3"
          : "min-h-11 flex-row items-center gap-3 py-3 border-b border-divider"
      }
    >
      <Ionicons name={icon as any /* db-any-ok: icon */} size={20} color="#525252" />
      <Text className="flex-1 text-body text-ink">{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#6b6b6b" />
    </TouchableOpacity>
  );
}
