import React from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import Logo from "@/components/Logo";
import { useAcceptInvite } from "@/features/accept-invite/domain/useAcceptInvite";

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
 *
 * The markup stays here (docs/refactor/BATCH_FGH_PLAN.md, app fence); the state,
 * the invite check and the first-password sequence live in
 * features/accept-invite/domain/useAcceptInvite.
 *
 * UI restyle step 4.4 (DESIGN.md): Ground, a flat card, DESIGN.md inputs, the
 * required mark in Ink Muted (red is for stuck), the error in Danger text. The
 * placeholders "Sarah Lim" / "9123 4567" are how verify-app-auth finds the
 * fields, so they stay as written.
 */
export default function AcceptInviteScreen() {
  const {
    fullName,
    setFullName,
    phone,
    setPhone,
    password,
    setPassword,
    confirm,
    setConfirm,
    loading,
    checking,
    childName,
    error,
    handleSetPassword,
  } = useAcceptInvite();

  if (checking) {
    return (
      <View className="flex-1 bg-ground items-center justify-center">
        <Text className="text-body text-ink-secondary">Checking your invite…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-ground"
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-5 py-12 max-w-xl w-full mx-auto"
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center mb-8">
          <Logo size="md" className="mb-3" />
          <Text className="text-display font-semibold text-ink">
            Welcome to SwimSync
          </Text>
          <Text className="text-body text-ink-secondary mt-1 text-center">
            {childName
              ? `${childName} is already set up. Choose a password to see their attendance and invoices.`
              : "Choose a password to finish setting up your account."}
          </Text>
        </View>

        <Surface className="gap-4">
          {/* Asked BEFORE the password, because it is about them rather than
              about security, and because a blank name is what made an invited
              family look like no family at all on the coach's roster. */}
          <View>
            <Text className="text-body font-medium text-ink mb-1.5">
              Your name <Text className="text-ink-muted">*</Text>
            </Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Sarah Lim"
              autoCapitalize="words"
              className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
              placeholderTextColor="#6b6b6b"
            />
          </View>

          <View>
            <Text className="text-body font-medium text-ink mb-1.5">
              Phone number
            </Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="9123 4567"
              keyboardType="phone-pad"
              className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
              placeholderTextColor="#6b6b6b"
            />
          </View>

          <View>
            <Text className="text-body font-medium text-ink mb-1.5">
              Password
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
              placeholderTextColor="#6b6b6b"
            />
          </View>

          <View>
            <Text className="text-body font-medium text-ink mb-1.5">
              Confirm Password
            </Text>
            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder="••••••••"
              secureTextEntry
              className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
              placeholderTextColor="#6b6b6b"
            />
          </View>

          {error && (
            <Text className="text-body text-status-danger-text">
              {error}
            </Text>
          )}

          <Button
            label={loading ? "Setting up..." : "Set Password"}
            onPress={handleSetPassword}
            className="mt-1"
          />
        </Surface>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
