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
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import PrimaryButton from "@/components/PrimaryButton";

const GENDER_OPTIONS = ["Male", "Female"];

// Editing a child, deliberately a SIBLING ROUTE of add-child rather than a
// nested child/[id]/edit — child/[id].tsx is a file, so nesting would mean
// restructuring the route into a folder for no gain.
//
// What is NOT editable here, and why:
//   • the business (students.tenant_id) — a student moves between businesses
//     only via the platform admin's RPC. The database pins it (migration
//     20260719001500) after a parent was found able to inject their own child
//     onto a rival's roster.
//   • assignment / activity — those belong to the business's admin (PRD §7.14).
//
// Renaming a child is safe for billing: invoices and credit notes snapshot the
// name they were issued with (migration 20260719001600), so history does not
// move when a name is corrected.
export default function EditChildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("Male");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);

  const showToast = useAppStore((s) => s.showToast);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const { data } = await supabase
          .from("students")
          .select("full_name, date_of_birth, gender, notes")
          .eq("id", id)
          .single();
        if (cancelled) return;
        if (!data) {
          setLoadError(true);
          setReady(true);
          return;
        }
        setName(data.full_name ?? "");
        setDob(data.date_of_birth ?? "");
        setGender(
          data.gender ? data.gender.charAt(0).toUpperCase() + data.gender.slice(1) : "Male"
        );
        setNotes(data.notes ?? "");
        setReady(true);
      })();
      return () => {
        cancelled = true;
      };
      // Loading once per focus is deliberate: re-running on every keystroke
      // would stomp the fields the parent is editing.
    }, [id])
  );

  async function handleSave() {
    if (!name.trim()) {
      showToast("Full name is required.", "error");
      return;
    }
    if (!dob.trim()) {
      showToast("Date of birth is required.", "error");
      return;
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dob.trim())) {
      showToast("Date of birth must be in YYYY-MM-DD format.", "error");
      return;
    }

    setLoading(true);
    const { error } = await supabase
      .from("students")
      .update({
        full_name: name.trim(),
        date_of_birth: dob.trim(),
        gender: gender.toLowerCase(),
        notes: notes.trim() || null,
      })
      .eq("id", id);
    setLoading(false);

    if (error) {
      // A child is identified by name + date of birth within a business
      // (students_identity_uniq). Editing into an existing pair almost always
      // means this child is already on file twice.
      if (error.code === "23505") {
        showToast(
          `Another child called ${name.trim()} with that date of birth is already registered here.`,
          "error"
        );
        return;
      }
      // 23514 is the tenant/created_by pin. Unreachable from this form, which
      // sends neither — but if it ever fires, say something true rather than
      // "please try again", which would invite exactly the retry that cannot work.
      if (error.code === "23514") {
        showToast(
          "That change isn't allowed here. Please contact your coach or school.",
          "error"
        );
        return;
      }
      showToast("Could not save changes. Please try again.", "error");
      return;
    }

    showToast(`${name.trim()}'s profile has been updated.`, "success");
    router.back();
  }

  if (!ready) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center px-6">
        <Ionicons name="alert-circle-outline" size={40} color="#d1d5db" />
        <Text className="text-gray-400 mt-3 text-center">
          Could not load this child&rsquo;s profile.
        </Text>
        <TouchableOpacity onPress={() => router.back()} className="mt-4">
          <Text className="text-sky-500 font-semibold">Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">Edit Child</Text>
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 gap-4">
          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Full Name <Text className="text-red-500">*</Text>
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Emma Tan"
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Date of Birth <Text className="text-red-500">*</Text>
            </Text>
            <TextInput
              value={dob}
              onChangeText={setDob}
              placeholder="YYYY-MM-DD"
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50"
              placeholderTextColor="#9ca3af"
            />
            <Text className="text-xs text-gray-500 mt-1.5">
              Used with the name to tell children apart on a coach&rsquo;s roster.
            </Text>
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-2">
              Gender <Text className="text-red-500">*</Text>
            </Text>
            <View className="flex-row gap-2">
              {GENDER_OPTIONS.map((g) => (
                <TouchableOpacity
                  key={g}
                  onPress={() => setGender(g)}
                  className={`flex-1 py-2.5 rounded-xl border items-center ${
                    gender === g
                      ? "bg-sky-500 border-sky-500"
                      : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <Text
                    className={`font-medium text-sm ${
                      gender === g ? "text-white" : "text-gray-600"
                    }`}
                  >
                    {g}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View>
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Additional Notes
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. afraid of deep water..."
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900 bg-gray-50 min-h-[80px]"
              placeholderTextColor="#9ca3af"
            />
          </View>

          <PrimaryButton
            label={loading ? "Saving..." : "Save Changes"}
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
