import React from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { useChangePassword } from "../domain/useChangePassword";

// Shared Change Password screen for the logged-in coach and parent. The user is
// already authenticated, so updateUser({ password }) is enough (no recovery
// session needed). Uses inline error/success state instead of Alert.alert,
// which is a no-op on the web build.
//
// Moved from components/ChangePasswordScreen.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// app fence): both change-password routes compose this feature. State and the save
// live in ../domain/useChangePassword. Restyled in UI restyle step 2.8 (DESIGN.md
// inputs: visible label above, white, Border Strong, 6px corners, 44px; the error in
// Danger text under the fields) — what Save does is unchanged.
export default function ChangePasswordScreen() {
  const {
    password,
    setPassword,
    confirm,
    setConfirm,
    loading,
    error,
    done,
    handleSave,
  } = useChangePassword();

  return (
    <SafeAreaView className="flex-1 bg-ground">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityLabel="Back"
          className="w-11 h-11 -ml-3 items-center justify-center"
        >
          <Ionicons name="chevron-back" size={24} color="#0a0a0a" />
        </TouchableOpacity>
        <Text className="text-display font-semibold text-ink">Change Password</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="px-5 py-4"
          keyboardShouldPersistTaps="handled"
        >
          <Surface className="gap-4">
            {done ? (
              <View>
                <View className="flex-row items-center gap-2 mb-2">
                  <Ionicons name="checkmark-circle" size={22} color="#166534" />
                  <Text className="text-headline font-semibold text-ink">
                    Password updated
                  </Text>
                </View>
                <Text className="text-body text-ink-secondary mb-5">
                  Your password has been changed. Use it next time you sign in.
                </Text>
                <Button label="Done" onPress={() => router.back()} />
              </View>
            ) : (
              <>
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

                {/* Not `disabled` while loading — the save's own guard is
                    useChangePassword's, unchanged (and a disabled Button is a
                    real <button disabled> the drivers cannot press, §7.367). */}
                <Button
                  label={loading ? "Updating..." : "Update Password"}
                  onPress={handleSave}
                  className="mt-1"
                />
              </>
            )}
          </Surface>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
