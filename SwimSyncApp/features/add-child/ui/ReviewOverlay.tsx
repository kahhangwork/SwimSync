// One last look before the record exists.
// Moved from app/(parent)/home/add-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F). UI restyle step 3.6: a floating card (the one shadow DESIGN.md allows),
// the date of birth in the One Date Style ("1 Jan 2019") so the parent checks a
// date, not a code. The value saved is still `dob` itself.
import React from "react";
import { View, Text } from "react-native";
import { Button } from "@/components/ui/Button";
import { formatSgStamp } from "@/lib/lessonDates";
import type { useAddChild } from "../domain/useAddChild";

type AddChild = ReturnType<typeof useAddChild>;

export function ReviewOverlay(p: Pick<AddChild, "reviewing" | "candidates" | "name" | "dob" | "gender" | "notes" | "loading" | "submit" | "setReviewing">) {
  const { reviewing, candidates, name, dob, gender, notes, loading, submit, setReviewing } = p;
  return (
    <>
      {/* ── One last look before the record exists ──────────────────────── */}
      {reviewing && candidates === null && (
        <View className="absolute inset-0 bg-black/40 items-center justify-center px-5">
          <View className="bg-surface border border-border rounded-card shadow-float p-5 w-full max-w-md">
            <Text className="text-headline font-semibold text-ink">
              Is this right?
            </Text>
            <Text className="mt-1 text-body text-ink-secondary">
              Check the spelling and the date of birth. A child&rsquo;s profile
              can&rsquo;t be deleted afterwards — if it&rsquo;s wrong,
              you&rsquo;ll need to ask your coach to sort it out.
            </Text>

            <View className="mt-4 bg-ground border border-border rounded-control p-3 gap-1">
              <Text className="text-headline font-semibold text-ink">
                {name.trim()}
              </Text>
              <Text className="text-body text-ink-secondary">
                Born {formatSgStamp(dob.trim(), { day: "numeric", month: "short", year: "numeric" })} · {gender}
              </Text>
              {notes.trim() !== "" && (
                <Text className="mt-1 text-body-secondary text-ink-secondary">{notes.trim()}</Text>
              )}
            </View>

            <View className="mt-5 gap-1">
              <Button
                label={loading ? "Saving..." : "Yes, add this child"}
                onPress={() => submit("check")}
              />
              <Button
                variant="link"
                label="Go back and edit"
                onPress={() => setReviewing(false)}
                className="items-center"
              />
            </View>
          </View>
        </View>
      )}
    </>
  );
}
