import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import PrimaryButton from "@/components/PrimaryButton";

const GENDER_OPTIONS = ["Male", "Female"];

export default function AddChildScreen() {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("Male");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);

  async function handleSave() {
    if (!name.trim()) {
      showToast("Full name is required.", "error");
      return;
    }
    if (!dob.trim()) {
      showToast("Date of birth is required.", "error");
      return;
    }

    // Validate date format YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dob.trim())) {
      showToast("Date of birth must be in YYYY-MM-DD format.", "error");
      return;
    }

    setLoading(true);

    // Get the parent record for the logged-in user
    const { data: parentRecord, error: parentError } = await supabase
      .from("parents")
      .select("id")
      .eq("profile_id", session!.id)
      .single();

    if (parentError || !parentRecord) {
      setLoading(false);
      showToast("Could not find your parent account. Please try again.", "error");
      return;
    }

    // Insert the student record
    const { data: student, error: studentError } = await supabase
      .from("students")
      .insert({
        full_name: name.trim(),
        date_of_birth: dob.trim(),
        gender: gender.toLowerCase(),
        notes: notes.trim() || null,
        assignment_status: "unassigned",
        is_active: true,
      })
      .select("id")
      .single();

    if (studentError || !student) {
      setLoading(false);
      showToast("Failed to create child profile. Please try again.", "error");
      return;
    }

    // Link student to parent
    const { error: linkError } = await supabase
      .from("parent_students")
      .insert({
        parent_id: parentRecord.id,
        student_id: student.id,
      });

    setLoading(false);

    if (linkError) {
      showToast(
        "Child profile created but could not be linked to your account. Please contact support.",
        "error"
      );
      return;
    }

    showToast(
      `${name.trim()}'s profile has been created. The admin will assign them to a class shortly.`,
      "success"
    );
    router.back();
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">Add Child</Text>
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 gap-4">
          {/* Name */}
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

          {/* Date of Birth */}
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
          </View>

          {/* Gender */}
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

          {/* Notes */}
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
            label={loading ? "Saving..." : "Save Child Profile"}
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
