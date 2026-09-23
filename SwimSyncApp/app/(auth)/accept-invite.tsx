import React from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import PrimaryButton from "@/components/PrimaryButton";
import Logo from "@/components/Logo";
import { useAcceptInvite } from "@/features/accept-invite/domain/useAcceptInvite";

/**
 * First-password screen for a parent whose coach set their account up for them
 * (TRIAL_ONBOARDING_PLAN.md phase 6).
 *
 * WHY THIS IS NOT reset-password.tsx, which does the same mechanical job. Its
 * copy is wrong in every particular for someone who has never had an account:
 * it says "reset link", offers to "request a new one", and on an invalid
 * session sends them to /forgot-password — a dead end for a person with no
 * password to forget. It also cannot explain the thing this screen exists to
 * explain: their child is already here. Same reasoning as the admin panel's
 * own /accept-invite (TENANT_PROVISIONING_PLAN.md phase 5).
 *
 * The markup stays here (docs/refactor/BATCH_FGH_PLAN.md, app fence); the state,
 * the invite check and the first-password sequence live in
 * features/accept-invite/domain/useAcceptInvite.
 */
export default function AcceptInviteScreen() {
  const {
    fullName,
    setFullName,
    phone,
    setPhone,
    password,
    setPassword,
    confirm,
    setConfirm,
    loading,
    checking,
    childName,
    error,
    handleSetPassword,
  } = useAcceptInvite();

  if (checking) {
    return (
      <View className="flex-1 bg-sky-50 items-center justify-center">
        <Text className="text-gray-500">Checking your invite…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-sky-50"
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center mb-8">
          <Logo size="md" className="mb-3" />
          <Text className="text-2xl font-bold text-gray-900">
            Welcome to SwimSync
          </Text>
          <Text className="text-gray-500 mt-1 text-sm text-center">
            {childName
              ? `${childName} is already set up. Choose a password to see their attendance and invoices.`
              : "Choose a password to finish setting up your account."}
          </Text>
        </View>

        <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 gap-4">
          {/* Asked BEFORE the password, because it is about them rather than
              about security, and because a blank name is what made an invited
              family look like no family at all on the coach's roster. */}
          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Your name <Text className="text-red-500">*</Text>
            </Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Sarah Lim"
              autoCapitalize="words"
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Phone number
            </Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="9123 4567"
              keyboardType="phone-pad"
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Password
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Confirm Password
            </Text>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder="••••••••"
              secureTextEntry
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
          </View>

          {error && (
            <Text className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </Text>
          )}

          <PrimaryButton
            label={loading ? "Setting up..." : "Set Password"}
            onPress={handleSetPassword}
            className="mt-2"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
