// The child's details and the Save / Cancel buttons.
// Moved VERBATIM from app/(parent)/home/add-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import PrimaryButton from "@/components/PrimaryButton";
import { GENDER_OPTIONS } from "../constants";
import type { useAddChild } from "../domain/useAddChild";

type AddChild = ReturnType<typeof useAddChild>;

export function ChildForm(p: Pick<AddChild, "name" | "setName" | "dob" | "setDob" | "gender" | "setGender" | "notes" | "setNotes" | "loading" | "handleSave">) {
  const { name, setName, dob, setDob, gender, setGender, notes, setNotes, loading, handleSave } = p;
  return (
    <>
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
    </>
  );
}
