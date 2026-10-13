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
import { useLogin } from "@/features/login/domain/useLogin";

// Sign-in (docs/refactor/BATCH_FGH_PLAN.md, app fence): the markup stays here; the
// form state and the sign-in sequence live in features/login/domain/useLogin.
//
// UI restyle step 4.2 (DESIGN.md): Ground, a flat card, DESIGN.md inputs (white,
// Border Strong, 6px, 44px, label above), the shared Button. Every word a driver
// reads is kept — "Sign In" is both the heading and the button (drivers press
// .last()), and the placeholder "you@email.com" is how lib.mjs finds the field.
// What Sign In does is useLogin's, unchanged.

export default function LoginScreen() {
  const {
    email,
    setEmail,
    password,
    setPassword,
    loading,
    handleLogin,
  } = useLogin();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-ground"
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-5 py-12 max-w-xl w-full mx-auto"
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo / brand */}
        <View className="items-center mb-8">
          <Logo size="lg" className="mb-3" />
          <Text className="text-display font-semibold text-ink">SwimSync</Text>
          <Text className="text-body text-ink-secondary mt-1">Swim Coach Attendance & Billing</Text>
        </View>

        {/* Form card */}
        <Surface className="gap-4">
          <Text className="text-headline font-semibold text-ink">Sign In</Text>

          <View>
            <Text className="text-body font-medium text-ink mb-1.5">Email</Text>
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

          <View>
            <Text className="text-body font-medium text-ink mb-1.5">Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
              placeholderTextColor="#6b6b6b"
            />
            <TouchableOpacity
              className="min-h-11 justify-center self-end"
              onPress={() => router.push("/(auth)/forgot-password")}
            >
              <Text className="text-body font-medium text-primary">Forgot password?</Text>
            </TouchableOpacity>
          </View>

          {/* Not `disabled` while signing in — useLogin's own guard is unchanged,
              and a disabled Button is a real <button disabled> (§7.367). */}
          <Button
            label={loading ? "Signing in..." : "Sign In"}
            onPress={handleLogin}
          />
        </Surface>

        {/* Register link */}
        <View className="flex-row justify-center items-center mt-4">
          <Text className="text-body text-ink-secondary">Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push("/(auth)/register")}>
            <Text className="py-3 text-body font-semibold text-primary">Register</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
