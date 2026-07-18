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
import { friendlyAuthError } from "@/lib/authErrors";

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const setSession = useAppStore((s) => s.setSession);

  async function handleRegister() {
    setError(null);

    if (!name || !email || !phone || !password || !confirm) {
      setError("Please fill in all required fields.");
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

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: name.trim(),
          role: "parent",
        },
      },
    });

    if (signUpError || !data.user) {
      setLoading(false);
      setError(friendlyAuthError(signUpError));
      return;
    }

    // Update phone in profiles
    await supabase
      .from("profiles")
      .update({ phone: phone.trim() })
      .eq("id", data.user.id);

    setLoading(false);

    // If email confirmation is enabled, no session is returned. Show an inline
    // "check your email" state — Alert.alert is a no-op on the web build, which
    // would otherwise strand the user on the form with no feedback or redirect.
    if (!data.session) {
      setEmailSent(true);
      return;
    }

    // Email confirmation disabled → session returned immediately
    setSession({
      id: data.user.id,
      email: data.user.email!,
      role: "parent",
      fullName: name.trim(),
    });

    router.replace("/(parent)/home");
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-sky-50"
    >
      <ScrollView
        contentContainerClassName="flex-grow px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <TouchableOpacity onPress={() => router.back()} className="mb-6">
          <Text className="text-sky-500 text-base">← Back</Text>
        </TouchableOpacity>

        <View className="items-center mb-8">
          <Logo size="md" className="mb-3" />
          <Text className="text-2xl font-bold text-gray-900">Create Account</Text>
          <Text className="text-gray-500 mt-1 text-sm text-center">
            Register as a parent to manage your children's swim classes
          </Text>
        </View>

        {/* Form card */}
        <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 gap-4">
          {emailSent ? (
            <View>
              <Text className="text-base font-semibold text-gray-900 mb-2">
                Check your email
              </Text>
              <Text className="text-sm text-gray-500 mb-6">
                We've sent a confirmation link to {email.trim()}. Please verify
                your email, then sign in.
              </Text>
              <PrimaryButton
                label="Back to Sign In"
                onPress={() => router.replace("/(auth)/login")}
              />
            </View>
          ) : (
          <>
          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Full Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Sarah Tan"
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <View>
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

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Phone Number
            </Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="+65 9123 4567"
              keyboardType="phone-pad"
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Password</Text>
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
              Confirm Password
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
            label={loading ? "Creating account..." : "Create Account"}
            onPress={handleRegister}
            className="mt-2"
          />
          </>
          )}
        </View>

        <View className="flex-row justify-center mt-6">
          <Text className="text-gray-500">Already have an account? </Text>
          <TouchableOpacity onPress={() => router.replace("/(auth)/login")}>
            <Text className="text-sky-500 font-semibold">Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
