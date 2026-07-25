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
  // ⚠ NAME AND PHONE LIVE ON `profiles`, ADDRESS ON `parents` — two tables, one
  // screen, deliberately. profiles is shared with coaches and admins (it is
  // the account), while a home address is a parent-shaped fact.
  //
  // WHY THEY ARE EDITABLE HERE AT ALL. An INVITED parent never fills in the
  // registration form — /accept-invite only ever asked for a password — so
  // their name and phone were blank with NO screen anywhere in the app able to
  // set them. The admin's Students page then showed a blank parent, which
  // reads as "this child has no parent" when it has one. Reported from
  // production 2026-07-26.
  // It also disabled a feature: the parent's phone is one of the two signals
  // that matches a family to a child their coach already added, so an invited
  // parent could never match on it.
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
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
        const [{ data }, { data: prof }] = await Promise.all([
          supabase
            .from("parents")
            .select("address, postal_code")
            .eq("profile_id", session?.id)
            .single(),
          supabase
            .from("profiles")
            .select("full_name, phone")
            .eq("id", session?.id)
            .single(),
        ]);
        if (cancelled) return;
        setAddress(data?.address ?? "");
        setPostal(data?.postal_code ?? "");
        setFullName(prof?.full_name ?? "");
        setPhone(prof?.phone ?? "");
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
    // Required, unlike everything else here: a blank name is what made an
    // invited family look like no family at all on the coach's roster.
    if (!fullName.trim()) {
      showToast("Please enter your name.", "error");
      return;
    }

    setSaving(true);
    const [{ error }, { error: profErr }] = await Promise.all([
      supabase
        .from("parents")
        .update({
          address: address.trim() || null,
          postal_code: postal.trim() || null,
        })
        .eq("profile_id", session?.id),
      supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
        })
        .eq("id", session?.id),
    ]);
    setSaving(false);

    if (error || profErr) {
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
