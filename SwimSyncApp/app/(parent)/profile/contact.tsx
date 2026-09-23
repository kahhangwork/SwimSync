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
import PrimaryButton from "@/components/PrimaryButton";
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
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">Contact Details</Text>
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 gap-4">
          <Text className="text-sm text-gray-600">
            Your coach uses this to reach you and to know which pools are
            convenient. It is not shown to other families.
          </Text>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Your name <Text className="text-red-500">*</Text>
            </Text>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Sarah Lim"
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Phone number
            </Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="9123 4567"
              keyboardType="phone-pad"
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
            <Text className="mt-1 text-xs text-gray-400">
              Helps your coach match you to a child they have already added.
            </Text>
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">Address</Text>
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
              Postal Code
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

          <PrimaryButton
            label={saving ? "Saving..." : "Save"}
            onPress={handleSave}
            className="mt-2"
          />
          <PrimaryButton
            label="Cancel"
            variant="ghost"
            onPress={() => router.back()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
