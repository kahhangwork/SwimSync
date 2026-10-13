import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import { Button } from "@/components/ui/Button";
import { useContactDetails } from "@/features/contact/domain/useContactDetails";

// Where a family lives — editable after signup.
//
// This screen exists because the fields are OPTIONAL at registration and every
// parent who signed up before they existed has neither. Without somewhere to
// supply them later, the feature would only ever hold data for families who
// joined after it shipped — which is not the families the coach is trying to
// reach.
//
// Address lives on `parents`, not `profiles`: profiles is shared with coaches
// and admins, and a home address is a parent-shaped fact.
//
// The markup stays here (docs/refactor/BATCH_FGH_PLAN.md, app fence); the state, the
// load and the save live in features/contact/domain/useContactDetails.
//
// UI restyle step 3.10: DESIGN.md inputs (white, Border Strong, 44px, label
// above); placeholders read as examples ("e.g. …") so none looks like a value
// already entered — the UI drivers still find each field by the example in it.
export default function ContactDetailsScreen() {
  const {
    fullName,
    setFullName,
    phone,
    setPhone,
    address,
    setAddress,
    postal,
    setPostal,
    ready,
    saving,
    handleSave,
  } = useContactDetails();

  if (!ready) {
    return (
      <SafeAreaView className="flex-1 bg-ground items-center justify-center">
        <ActivityIndicator size="large" color="#2563eb" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-ground">
      <View className="flex-row items-center gap-2 px-3 pt-4 pb-3">
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="w-11 h-11 items-center justify-center"
        >
          <Ionicons name="chevron-back" size={24} color="#2563eb" />
        </TouchableOpacity>
        <Text className="text-headline font-semibold text-ink">Contact Details</Text>
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Surface className="gap-4">
          <Text className="text-body text-ink-secondary">
            Your coach uses this to reach you and to know which pools are
            convenient. It is not shown to other families.
          </Text>

          <View>
            <Text className="text-body font-medium text-ink mb-1.5">
              Your name <Text className="text-ink-muted">*</Text>
            </Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="e.g. Sarah Lim"
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
              placeholder="e.g. 9123 4567"
              keyboardType="phone-pad"
              className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
              placeholderTextColor="#6b6b6b"
            />
            <Text className="mt-1.5 text-body-secondary text-ink-secondary">
              Helps your coach match you to a child they have already added.
            </Text>
          </View>

          <View>
            <Text className="text-body font-medium text-ink mb-1.5">Address</Text>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="e.g. Blk 123 Clementi Ave 3, #04-56"
              className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
              placeholderTextColor="#6b6b6b"
            />
          </View>

          <View>
            <Text className="text-body font-medium text-ink mb-1.5">
              Postal Code
            </Text>
            <TextInput
              value={postal}
              onChangeText={setPostal}
              placeholder="e.g. 120123"
              keyboardType="number-pad"
              maxLength={6}
              className="min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface"
              placeholderTextColor="#6b6b6b"
            />
          </View>

          <Button
            label={saving ? "Saving..." : "Save"}
            onPress={handleSave}
            className="mt-2"
          />
          <Button
            variant="link"
            label="Cancel"
            onPress={() => router.back()}
            className="items-center"
          />
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}
