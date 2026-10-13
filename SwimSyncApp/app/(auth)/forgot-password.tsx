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
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import Logo from "@/components/Logo";
import { useForgotPassword } from "@/features/forgot-password/domain/useForgotPassword";

// Forgot password (docs/refactor/BATCH_FGH_PLAN.md, app fence): the markup stays
// here; the send lives in features/forgot-password/domain/useForgotPassword, the
// redirect target in …/resetRedirectTo.
//
// UI restyle step 4.4 (DESIGN.md): Ground, a flat card, DESIGN.md input, the
// shared Button, the back link a 44px Lane Blue link. Words unchanged; what Send
// does (and where the email's link points) is useForgotPassword's.

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
      className="flex-1 bg-ground"
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-5 py-12 max-w-xl w-full mx-auto"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <TouchableOpacity
          onPress={() => router.replace("/(auth)/login")}
          className="min-h-11 justify-center self-start mb-4"
        >
          <Text className="text-body font-medium text-primary">← Back to sign in</Text>
        </TouchableOpacity>

        <View className="items-center mb-8">
          <Logo size="md" className="mb-3" />
          <Text className="text-display font-semibold text-ink">Reset Password</Text>
          <Text className="text-body text-ink-secondary mt-1 text-center">
            Enter your email and we'll send you a link to reset your password
          </Text>
        </View>

        {/* Form card */}
        <Surface>
          {sent ? (
            <View>
              <Text className="text-headline font-semibold text-ink mb-2">
                Check your email
              </Text>
              <Text className="text-body text-ink-secondary mb-5">
                If an account exists for {email.trim()}, we've sent a link to
                reset your password. Open it on this device to continue.
              </Text>
              <Button
                label="Back to Sign In"
                onPress={() => router.replace("/(auth)/login")}
              />
            </View>
          ) : (
            <View className="gap-4">
              <View>
                <Text className="text-body font-medium text-ink mb-1.5">
                  Email
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
                  placeholderTextColor="#6b6b6b"
                />
              </View>

              <Button
                label={loading ? "Sending..." : "Send Reset Link"}
                onPress={handleSend}
              />
            </View>
          )}
        </Surface>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
