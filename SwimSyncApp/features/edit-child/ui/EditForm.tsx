// The child's editable fields and the Save / Cancel buttons.
// Moved from app/(parent)/home/edit-child.tsx (docs/refactor/BATCH_FGH_PLAN.md, App L-F).
// UI restyle step 3.6: DESIGN.md inputs (white, Border Strong, 44px, label above),
// Date of Birth a picker (components/ui/DateField — same YYYY-MM-DD value), the
// gender choice a segmented control, placeholders that read as examples.
import React from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Surface } from "@/components/ui/Surface";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { GENDER_OPTIONS } from "../constants";
import type { useEditChild } from "../domain/useEditChild";

type EditChild = ReturnType<typeof useEditChild>;

const LABEL = "text-body font-medium text-ink mb-1.5";
const INPUT = "min-h-11 border border-border-strong rounded-control px-3 text-body text-ink bg-surface";

export function EditForm(p: Pick<EditChild, "name" | "setName" | "dob" | "setDob" | "gender" | "setGender" | "notes" | "setNotes" | "loading" | "handleSave">) {
  const { name, setName, dob, setDob, gender, setGender, notes, setNotes, loading, handleSave } = p;
  return (
    <Surface className="gap-4">
      {/* Name */}
      <View>
        <Text className={LABEL}>
          Full Name <Text className="text-ink-muted">*</Text>
        </Text>
        {/* "e.g." so the example never reads as a value already entered.
            The UI drivers find the field by the "Emma Tan" in it. */}
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Emma Tan"
          className={INPUT}
          placeholderTextColor="#6b6b6b"
        />
      </View>

      {/* Date of Birth */}
      <View>
        <Text className={LABEL}>
          Date of Birth <Text className="text-ink-muted">*</Text>
        </Text>
        <DateField value={dob} onChange={setDob} accessibilityLabel="Date of Birth" />
        <Text className="text-body-secondary text-ink-secondary mt-1.5">
          Used with the name to tell children apart on a coach&rsquo;s roster.
        </Text>
      </View>

      {/* Gender */}
      <View>
        <Text className={LABEL}>
          Gender <Text className="text-ink-muted">*</Text>
        </Text>
        <View className="flex-row gap-2">
          {GENDER_OPTIONS.map((g) => (
            <TouchableOpacity
              key={g}
              onPress={() => setGender(g)}
              accessibilityRole="button"
              accessibilityState={{ selected: gender === g }}
              // RN-web drops accessibilityState; only aria-* reaches the DOM, so
              // without this no screen reader (or driver) can tell which gender is
              // chosen — or that none is. aria-pressed: the state ARIA defines for
              // a button (aria-selected is only announced on tabs/options).
              aria-pressed={gender === g}
              // DESIGN.md: the chosen segment is the Selected fill, not a blue.
              className={`flex-1 min-h-11 rounded-control border items-center justify-center ${
                gender === g ? "bg-selected border-border-strong" : "bg-surface border-border"
              }`}
            >
              <Text
                className={`text-body ${
                  gender === g ? "font-semibold text-ink" : "font-medium text-ink-secondary"
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
        <Text className={LABEL}>
          Additional Notes
        </Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. afraid of deep water..."
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          className="min-h-[88px] border border-border-strong rounded-control px-3 py-2.5 text-body text-ink bg-surface"
          placeholderTextColor="#6b6b6b"
        />
      </View>

      <Button
        label={loading ? "Saving..." : "Save Changes"}
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
  );
}
