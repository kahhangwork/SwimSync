// The registration form, or the check-your-email state.
// Moved VERBATIM from app/(auth)/register.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TextInput } from "react-native";
import { router } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";
import type { useRegister } from "../domain/useRegister";

type Register = ReturnType<typeof useRegister>;

export function FormCard(p: Pick<Register, "emailSent" | "email" | "setEmail" | "name" | "setName" | "phone" | "setPhone" | "address" | "setAddress" | "postal" | "setPostal" | "joinCode" | "setJoinCode" | "password" | "setPassword" | "confirm" | "setConfirm" | "error" | "loading" | "handleRegister">) {
  const { emailSent, email, setEmail, name, setName, phone, setPhone, address, setAddress, postal, setPostal, joinCode, setJoinCode, password, setPassword, confirm, setConfirm, error, loading, handleRegister } = p;
  return (
    <>
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

        {/* Optional, and labelled so. The coach uses the postal code to
            answer "is this family near a pool I teach at?" — but a signup
            form that refuses to submit without an address would block the
            onboarding it exists to help. Parents can add it later from their
            profile. */}
        <View>
          <Text className="text-sm font-medium text-gray-700 mb-1.5">
            Address <Text className="text-gray-400">(optional)</Text>
          </Text>
          <TextInput
            value={address}
            onChangeText={setAddress}
            placeholder="Blk 123 Clementi Ave 3, #04-56"
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
            placeholderTextColor="#9ca3af"
          />
        </View>

        <View>
          <Text className="text-sm font-medium text-gray-700 mb-1.5">
            Postal Code <Text className="text-gray-400">(optional)</Text>
          </Text>
          <TextInput
            value={postal}
            onChangeText={setPostal}
            placeholder="120123"
            keyboardType="number-pad"
            maxLength={6}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
            placeholderTextColor="#9ca3af"
          />
        </View>

        <View>
          <Text className="text-sm font-medium text-gray-700 mb-1.5">
            Join or referral code <Text className="text-gray-400">(optional)</Text>
          </Text>
          <TextInput
            value={joinCode}
            onChangeText={setJoinCode}
            placeholder="SWIM-1234 or REF-ABCDE"
            autoCapitalize="characters"
            autoCorrect={false}
            className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50 tracking-widest"
            placeholderTextColor="#9ca3af"
          />
          <Text className="mt-1.5 text-xs text-gray-500">
            Have a code from your coach or a friend? Add it and we&rsquo;ll
            connect you when you sign in.
          </Text>
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
    </>
  );
}
