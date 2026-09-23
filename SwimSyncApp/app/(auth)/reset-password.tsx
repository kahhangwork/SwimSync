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
import { useResetPassword } from "@/features/reset-password/domain/useResetPassword";

// Reset password (docs/refactor/BATCH_FGH_PLAN.md, app fence): the markup stays
// here; the recovery-session check and the reset live in
// features/reset-password/domain/useResetPassword.

export default function ResetPasswordScreen() {
  const {
    password,
    setPassword,
    confirm,
    setConfirm,
    loading,
    checking,
    error,
    handleReset,
  } = useResetPassword();

  if (checking) {
    return (
      <View className="flex-1 bg-sky-50 items-center justify-center">
        <Text className="text-gray-500">Verifying reset link...</Text>
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
            Set New Password
          </Text>
          <Text className="text-gray-500 mt-1 text-sm text-center">
            Choose a new password for your account
          </Text>
        </View>

        {/* Form card */}
        <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 gap-4">
          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              New Password
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
              Confirm New Password
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
            label={loading ? "Updating..." : "Update Password"}
            onPress={handleReset}
            className="mt-2"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
