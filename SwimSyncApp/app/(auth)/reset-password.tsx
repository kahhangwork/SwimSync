import React from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import Logo from "@/components/Logo";
import { useResetPassword } from "@/features/reset-password/domain/useResetPassword";

// Reset password (docs/refactor/BATCH_FGH_PLAN.md, app fence): the markup stays
// here; the recovery-session check and the reset live in
// features/reset-password/domain/useResetPassword.
//
// UI restyle step 4.4 (DESIGN.md): Ground, a flat card, DESIGN.md inputs, the
// error in Danger text under the fields (the 2.8 Change Password shape). Words
// unchanged; the recovery check and the reset are useResetPassword's.

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
      <View className="flex-1 bg-ground items-center justify-center">
        <Text className="text-body text-ink-secondary">Verifying reset link...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-ground"
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-5 py-12 max-w-xl w-full mx-auto"
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center mb-8">
          <Logo size="md" className="mb-3" />
          <Text className="text-display font-semibold text-ink">
            Set New Password
          </Text>
          <Text className="text-body text-ink-secondary mt-1 text-center">
            Choose a new password for your account
          </Text>
        </View>

        {/* Form card */}
        <Surface className="gap-4">
          <View>
            <Text className="text-body font-medium text-ink mb-1.5">
              New Password
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
              placeholderTextColor="#6b6b6b"
            />
          </View>

          <View>
            <Text className="text-body font-medium text-ink mb-1.5">
              Confirm New Password
            </Text>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder="••••••••"
              secureTextEntry
              className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
              placeholderTextColor="#6b6b6b"
            />
          </View>

          {error && (
            <Text className="text-body text-status-danger-text">
              {error}
            </Text>
          )}

          <Button
            label={loading ? "Updating..." : "Update Password"}
            onPress={handleReset}
            className="mt-1"
          />
        </Surface>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
