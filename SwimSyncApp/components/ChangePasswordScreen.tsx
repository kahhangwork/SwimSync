import React, { useState } from "react";
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
import PrimaryButton from "@/components/PrimaryButton";
import { supabase } from "@/lib/supabase";
import { friendlyAuthError } from "@/lib/authErrors";

// Shared Change Password screen for the logged-in coach and parent. The user is
// already authenticated, so updateUser({ password }) is enough (no recovery
// session needed). Uses inline error/success state instead of Alert.alert,
// which is a no-op on the web build.
export default function ChangePasswordScreen() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSave() {
    setError(null);
    if (!password || !confirm) {
      setError("Please enter and confirm your new password.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updErr) {
      setError(friendlyAuthError(updErr));
      return;
    }
    setDone(true);
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">Change Password</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="px-6 py-6"
          keyboardShouldPersistTaps="handled"
        >
          <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 gap-4">
            {done ? (
              <View>
                <View className="flex-row items-center gap-2 mb-2">
                  <Ionicons name="checkmark-circle" size={22} color="#16a34a" />
                  <Text className="text-base font-semibold text-gray-900">
                    Password updated
                  </Text>
                </View>
                <Text className="text-sm text-gray-500 mb-6">
                  Your password has been changed. Use it next time you sign in.
                </Text>
                <PrimaryButton label="Done" onPress={() => router.back()} />
              </View>
            ) : (
              <>
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
                  onPress={handleSave}
                  className="mt-2"
                />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
