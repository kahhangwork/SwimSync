import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";
import Logo from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { friendlyAuthError } from "@/lib/authErrors";
import { useAppStore } from "@/store/useAppStore";

/**
 * First-password screen for a parent whose coach set their account up for them
 * (TRIAL_ONBOARDING_PLAN.md phase 6).
 *
 * WHY THIS IS NOT reset-password.tsx, which does the same mechanical job. Its
 * copy is wrong in every particular for someone who has never had an account:
 * it says "reset link", offers to "request a new one", and on an invalid
 * session sends them to /forgot-password — a dead end for a person with no
 * password to forget. It also cannot explain the thing this screen exists to
 * explain: their child is already here. Same reasoning as the admin panel's
 * own /accept-invite (TENANT_PROVISIONING_PLAN.md phase 5).
 */
export default function AcceptInviteScreen() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [childName, setChildName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showToast = useAppStore((s) => s.showToast);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        showToast(
          "This invite link is invalid or has already been used. Ask your coach to send a new one.",
          "error"
        );
        router.replace("/(auth)/login");
        return;
      }

      // Name the child, because it is the proof this is really their invite —
      // a stranger's link would name a child they do not recognise. Failure is
      // non-fatal: the password still needs setting either way.
      const { data: kids } = await supabase
        .from("students")
        .select("full_name")
        .limit(1);
      setChildName(kids?.[0]?.full_name ?? null);
      setChecking(false);
    });
  }, []);

  async function handleSetPassword() {
    setError(null);
    if (!password || !confirm) {
      setError("Please enter and confirm a password.");
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
    if (updErr) {
      setLoading(false);
      setError(friendlyAuthError(updErr));
      return;
    }

    // Sign out and back in, exactly as the reset flow does: the invite session
    // exists to set a password, and a clean login proves the password works
    // before the parent depends on it.
    await supabase.auth.signOut();
    setLoading(false);
    showToast("Password set. Please sign in.", "success");
    router.replace("/(auth)/login");
  }

  if (checking) {
    return (
      <View className="flex-1 bg-sky-50 items-center justify-center">
        <Text className="text-gray-500">Checking your invite…</Text>
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
          <Logo size="md" className="mb-3" />
          <Text className="text-2xl font-bold text-gray-900">
            Welcome to SwimSync
          </Text>
          <Text className="text-gray-500 mt-1 text-sm text-center">
            {childName
              ? `${childName} is already set up. Choose a password to see their attendance and invoices.`
              : "Choose a password to finish setting up your account."}
          </Text>
        </View>

        <View className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 gap-4">
          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Password
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
            label={loading ? "Setting up..." : "Set Password"}
            onPress={handleSetPassword}
            className="mt-2"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
