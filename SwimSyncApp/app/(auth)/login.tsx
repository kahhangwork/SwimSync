import React, { useState } from "react";
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
import { useAppStore } from "@/store/useAppStore";
import PrimaryButton from "@/components/PrimaryButton";
import Logo from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { landingFor } from "@/lib/landing";
import { friendlyAuthError } from "@/lib/authErrors";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const setSession = useAppStore((s) => s.setSession);
  const showToast = useAppStore((s) => s.showToast);

  async function handleLogin() {
    if (!email || !password) {
      showToast("Please enter your email and password.", "error");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error || !data.user) {
      setLoading(false);
      showToast(friendlyAuthError(error), "error");
      return;
    }

    // Profile + whether they actually teach. A PRIVATE COACH is a tenant_admin
    // with a coaches row, so the role alone cannot decide where they land.
    const [{ data: profile, error: profileError }, { data: coachRow }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("role, full_name")
          .eq("id", data.user.id)
          .single(),
        supabase
          .from("coaches")
          .select("id")
          .eq("profile_id", data.user.id)
          .maybeSingle(),
      ]);

    setLoading(false);

    if (profileError || !profile) {
      showToast("Could not load your profile. Please try again.", "error");
      return;
    }

    setSession({
      id: data.user.id,
      email: data.user.email!,
      role: profile.role,
      fullName: profile.full_name,
    });

    const landing = landingFor(profile.role, !!coachRow);
    if (landing.route) {
      router.replace(landing.route);
    } else {
      showToast(landing.reason, "error");
    }
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
