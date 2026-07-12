import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";
import { supabase } from "@/lib/supabase";
import { friendlyAuthError } from "@/lib/authErrors";

// Where Supabase should redirect the recovery link back to. On web this is the
// running Expo origin; on native it's the app's custom scheme (swimsync://).
function resetRedirectTo(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin + "/reset-password";
  }
  return Linking.createURL("/reset-password");
}

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    if (!email.trim()) {
      Alert.alert("Error", "Please enter your email address.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: resetRedirectTo(),
    });

    setLoading(false);

    if (error) {
      Alert.alert("Error", friendlyAuthError(error));
      return;
    }

    setSent(true);
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
        {/* Header */}
        <TouchableOpacity
          onPress={() => router.replace("/(auth)/login")}
          className="mb-6"
        >
          <Text className="text-sky-500 text-base">← Back to sign in</Text>
        </TouchableOpacity>

        <View className="items-center mb-8">
          <View className="w-14 h-14 rounded-2xl bg-sky-500 items-center justify-center mb-3">
            <Text className="text-white text-2xl font-bold">S</Text>
          </View>
          <Text className="text-2xl font-bold text-gray-900">Reset Password</Text>
          <Text className="text-gray-500 mt-1 text-sm text-center">
            Enter your email and we'll send you a link to reset your password
          </Text>
        </View>

        {/* Form card */}
        <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          {sent ? (
            <View>
              <Text className="text-base font-semibold text-gray-900 mb-2">
                Check your email
              </Text>
              <Text className="text-sm text-gray-500 mb-6">
                If an account exists for {email.trim()}, we've sent a link to
                reset your password. Open it on this device to continue.
              </Text>
              <PrimaryButton
                label="Back to Sign In"
                onPress={() => router.replace("/(auth)/login")}
              />
            </View>
          ) : (
            <>
              <View className="mb-6">
                <Text className="text-sm font-medium text-gray-700 mb-1.5">
                  Email
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
                  placeholderTextColor="#9ca3af"
                />
              </View>

              <PrimaryButton
                label={loading ? "Sending..." : "Send Reset Link"}
                onPress={handleSend}
              />
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
