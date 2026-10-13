// The registration form, or the check-your-email state.
// Moved VERBATIM from app/(auth)/register.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
//
// UI restyle step 4.3 (DESIGN.md): a flat card, DESIGN.md inputs (white, Border
// Strong, 6px, 44px, label above), "(optional)" in Ink Muted, the error in
// Danger text, the shared Button. Every placeholder stays as written — the
// drivers find the fields by them (Sarah Tan, you@email.com, 9123 4567, Blk 123,
// 120123, SWIM-1234). What Create Account does is useRegister's, unchanged.
import React from "react";
import { View, Text, TextInput } from "react-native";
import { router } from "expo-router";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import type { useRegister } from "../domain/useRegister";

type Register = ReturnType<typeof useRegister>;

export function FormCard(p: Pick<Register, "emailSent" | "email" | "setEmail" | "name" | "setName" | "phone" | "setPhone" | "address" | "setAddress" | "postal" | "setPostal" | "joinCode" | "setJoinCode" | "password" | "setPassword" | "confirm" | "setConfirm" | "error" | "loading" | "handleRegister">) {
  const { emailSent, email, setEmail, name, setName, phone, setPhone, address, setAddress, postal, setPostal, joinCode, setJoinCode, password, setPassword, confirm, setConfirm, error, loading, handleRegister } = p;
  return (
    <>
      {/* Form card */}
      <Surface className="gap-4">
        {emailSent ? (
          <View>
            <Text className="text-headline font-semibold text-ink mb-2">
              Check your email
            </Text>
            <Text className="text-body text-ink-secondary mb-5">
              We've sent a confirmation link to {email.trim()}. Please verify
              your email, then sign in.
            </Text>
            <Button
              label="Back to Sign In"
              onPress={() => router.replace("/(auth)/login")}
            />
          </View>
        ) : (
        <>
        <View>
          <Text className="text-body font-medium text-ink mb-1.5">Full Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Sarah Tan"
            className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
            placeholderTextColor="#6b6b6b"
          />
        </View>

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
          <Text className="text-body font-medium text-ink mb-1.5">
            Phone Number
          </Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+65 9123 4567"
            keyboardType="phone-pad"
            className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
            placeholderTextColor="#6b6b6b"
          />
        </View>

        {/* Optional, and labelled so. The coach uses the postal code to
            answer "is this family near a pool I teach at?" — but a signup
            form that refuses to submit without an address would block the
            onboarding it exists to help. Parents can add it later from their
            profile. */}
        <View>
          <Text className="text-body font-medium text-ink mb-1.5">
            Address <Text className="text-ink-muted">(optional)</Text>
          </Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Blk 123 Clementi Ave 3, #04-56"
            className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
            placeholderTextColor="#6b6b6b"
          />
        </View>

        <View>
          <Text className="text-body font-medium text-ink mb-1.5">
            Postal Code <Text className="text-ink-muted">(optional)</Text>
          </Text>
          <TextInput
            value={postal}
            onChangeText={setPostal}
            placeholder="120123"
            keyboardType="number-pad"
            maxLength={6}
            className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
            placeholderTextColor="#6b6b6b"
          />
        </View>

        <View>
          <Text className="text-body font-medium text-ink mb-1.5">
            Join or referral code <Text className="text-ink-muted">(optional)</Text>
          </Text>
          <TextInput
            value={joinCode}
            onChangeText={setJoinCode}
            placeholder="SWIM-1234 or REF-ABCDE"
            autoCapitalize="characters"
            autoCorrect={false}
            className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface tracking-widest"
            placeholderTextColor="#6b6b6b"
          />
          <Text className="mt-1.5 text-body-secondary text-ink-secondary">
            Have a code from your coach or a friend? Add it and we&rsquo;ll
            connect you when you sign in.
          </Text>
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
          label={loading ? "Creating account..." : "Create Account"}
          onPress={handleRegister}
          className="mt-1"
        />
        </>
        )}
      </Surface>
    </>
  );
}
