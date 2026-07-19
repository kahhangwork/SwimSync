import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import PrimaryButton from "@/components/PrimaryButton";

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
export default function ContactDetailsScreen() {
  const [address, setAddress] = useState("");
  const [postal, setPostal] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const { data } = await supabase
          .from("parents")
          .select("address, postal_code")
          .eq("profile_id", session?.id)
          .single();
        if (cancelled) return;
        setAddress(data?.address ?? "");
        setPostal(data?.postal_code ?? "");
        setReady(true);
      })();
      return () => {
        cancelled = true;
      };
    }, [session?.id])
  );

  async function handleSave() {
    // Check the format only when something was typed — clearing both fields is
    // a legitimate edit, and a blank must become NULL rather than "".
    if (postal.trim() && !/^[0-9]{6}$/.test(postal.trim())) {
      showToast("Postal code should be 6 digits.", "error");
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("parents")
      .update({
        address: address.trim() || null,
        postal_code: postal.trim() || null,
      })
      .eq("profile_id", session?.id);
    setSaving(false);

    if (error) {
      showToast("Could not save your details. Please try again.", "error");
      return;
    }
    showToast("Your details have been saved.", "success");
    router.back();
  }

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
            Your coach uses this to know which pools are convenient for you. It
            is not shown to other families.
          </Text>

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
