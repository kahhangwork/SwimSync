import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";
import Logo from "@/components/Logo";
import { useForgotPassword } from "@/features/forgot-password/domain/useForgotPassword";

// Forgot password (docs/refactor/BATCH_FGH_PLAN.md, app fence): the markup stays
// here; the send lives in features/forgot-password/domain/useForgotPassword, the
// redirect target in …/resetRedirectTo.

export default function ForgotPasswordScreen() {
  const {
    email,
    setEmail,
    loading,
    sent,
    handleSend,
  } = useForgotPassword();

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
          <Logo size="md" className="mb-3" />
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
