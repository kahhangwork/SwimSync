// One last look before the record exists.
// Moved VERBATIM from app/(parent)/home/add-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text } from "react-native";
import PrimaryButton from "@/components/PrimaryButton";
import type { useAddChild } from "../domain/useAddChild";

type AddChild = ReturnType<typeof useAddChild>;

export function ReviewOverlay(p: Pick<AddChild, "reviewing" | "candidates" | "name" | "dob" | "gender" | "notes" | "loading" | "submit" | "setReviewing">) {
  const { reviewing, candidates, name, dob, gender, notes, loading, submit, setReviewing } = p;
  return (
    <>
      {/* ── One last look before the record exists ──────────────────────── */}
      {reviewing && candidates === null && (
        <View className="absolute inset-0 bg-black/40 items-center justify-center px-5">
          <View className="bg-white rounded-2xl p-5 w-full max-w-md">
            <Text className="text-lg font-bold text-gray-900">
              Is this right?
            </Text>
            <Text className="mt-1 text-sm text-gray-600">
              Check the spelling and the date of birth. A child&rsquo;s profile
              can&rsquo;t be deleted afterwards — if it&rsquo;s wrong,
              you&rsquo;ll need to ask your coach to sort it out.
            </Text>

            <View className="mt-4 bg-gray-50 rounded-xl p-4 gap-1">
              <Text className="text-base font-semibold text-gray-900">
                {name.trim()}
              </Text>
              <Text className="text-sm text-gray-600">
                Born {dob.trim()} · {gender}
              </Text>
              {notes.trim() !== "" && (
                <Text className="mt-1 text-sm text-gray-500">{notes.trim()}</Text>
              )}
            </View>

            <View className="mt-5 gap-2">
              <PrimaryButton
                label={loading ? "Saving..." : "Yes, add this child"}
                onPress={() => submit("check")}
              />
              <PrimaryButton
                label="Go back and edit"
                variant="ghost"
                onPress={() => setReviewing(false)}
              />
            </View>
          </View>
        </View>
      )}
    </>
  );
}
