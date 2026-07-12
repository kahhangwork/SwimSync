import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { router } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";
import { supabase } from "@/lib/supabase";
import { friendlyAuthError } from "@/lib/authErrors";

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // This screen is only valid inside a recovery session (opened via the email
  // link). If there's no session, the link is invalid or expired.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        Alert.alert(
          "Link expired",
          "This reset link is invalid or has expired. Please request a new one.",
          [{ text: "OK", onPress: () => router.replace("/(auth)/forgot-password") }]
        );
        return;
      }
      setChecking(false);
    });
  }, []);

  async function handleReset() {
    if (!password || !confirm) {
      Alert.alert("Error", "Please enter and confirm your new password.");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Error", "Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setLoading(false);
      Alert.alert("Error", friendlyAuthError(error));
      return;
    }

    // Force a clean re-login with the new password.
    await supabase.auth.signOut();
    setLoading(false);

    Alert.alert(
      "Password updated",
      "Your password has been reset. Please sign in with your new password.",
      [{ text: "OK", onPress: () => router.replace("/(auth)/login") }]
    );
  }

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
          <View className="w-14 h-14 rounded-2xl bg-sky-500 items-center justify-center mb-3">
            <Text className="text-white text-2xl font-bold">S</Text>
          </View>
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
