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
import { useLogin } from "@/features/login/domain/useLogin";

// Sign-in (docs/refactor/BATCH_FGH_PLAN.md, app fence): the markup stays here; the
// form state and the sign-in sequence live in features/login/domain/useLogin.

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
      className="flex-1 bg-sky-50"
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo / brand */}
        <View className="items-center mb-10">
          <Logo size="lg" className="mb-3" />
          <Text className="text-3xl font-bold text-gray-900">SwimSync</Text>
          <Text className="text-gray-500 mt-1">Swim Coach Attendance & Billing</Text>
        </View>

        {/* Form card */}
        <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <Text className="text-xl font-bold text-gray-900 mb-6">Sign In</Text>

          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Email</Text>
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

          <View className="mb-6">
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
            <TouchableOpacity
              className="mt-2 self-end"
              onPress={() => router.push("/(auth)/forgot-password")}
            >
              <Text className="text-sm text-sky-500">Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <PrimaryButton
            label={loading ? "Signing in..." : "Sign In"}
            onPress={handleLogin}
          />
        </View>

        {/* Register link */}
        <View className="flex-row justify-center mt-6">
          <Text className="text-gray-500">Don't have an account? </Text>
          <TouchableOpacity onPress={() => router.push("/(auth)/register")}>
            <Text className="text-sky-500 font-semibold">Register</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
