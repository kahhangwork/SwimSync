// "Has your coach already added your child?" — the masked candidate popup.
// Moved VERBATIM from app/(parent)/home/add-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { describeCandidate, matchReasonLabel } from "@/lib/claimCandidates";
import type { useAddChild } from "../domain/useAddChild";

type AddChild = ReturnType<typeof useAddChild>;

export function CandidatesOverlay(p: Pick<AddChild, "candidates" | "chosen" | "setChosen" | "loading" | "submit" | "name" | "setCandidates">) {
  const { candidates, chosen, setChosen, loading, submit, name, setCandidates } = p;
  return (
    <>
      {/* ── "Has your coach already added your child?" ──────────────────────
          An overlay rather than RN's Modal: no screen in this app uses Modal,
          and Alert.alert is a NO-OP on the web build (§12a) — which is the
          build parents actually use.

          ⚠ THE THREE BUTTONS CARRY EQUAL WEIGHT, DELIBERATELY. This popup
          appears while a parent is trying to finish a task, offering a card
          that looks like the answer — and a wrong "Yes" is what hands a
          stranger a family's attendance and billing history. So there is no
          primary/ghost hierarchy, nothing is pre-selected, and a single
          candidate does NOT auto-advance (that is the case most likely to be
          accepted without reading). The heading asks a QUESTION; it never
          announces that we found their child. */}
      {candidates !== null && (
        <View className="absolute inset-0 bg-black/40 items-center justify-center px-5">
          <View className="bg-white rounded-2xl p-5 w-full max-w-md">
            <Text className="text-lg font-bold text-gray-900">
              Is this your child?
            </Text>
            <Text className="mt-1 text-sm text-gray-600">
              Your coach may have already added your child. If one of these is
              them, we&rsquo;ll ask your coach to confirm rather than creating a
              second profile.
            </Text>

            <View className="mt-4 gap-2">
              {candidates.map((c) => (
                <TouchableOpacity
                  key={c.student_id}
                  onPress={() => setChosen(c.student_id)}
                  className={`py-3 px-4 rounded-xl border ${
                    chosen === c.student_id
                      ? "bg-sky-50 border-sky-500"
                      : "bg-gray-50 border-gray-200"
                  }`}
                >
                  <Text className="font-medium text-sm text-gray-900">
                    {describeCandidate(c)}
                  </Text>
                  <Text className="mt-0.5 text-xs text-gray-500">
                    {matchReasonLabel(c.match_reason)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="mt-5 gap-2">
              <TouchableOpacity
                disabled={!chosen || loading}
                onPress={() => submit("claim_confirmed", chosen!)}
                className={`py-3 rounded-xl border items-center ${
                  chosen ? "border-gray-300 bg-white" : "border-gray-200 bg-gray-100"
                }`}
              >
                <Text
                  className={`font-medium text-sm ${
                    chosen ? "text-gray-900" : "text-gray-400"
                  }`}
                >
                  Yes, that&rsquo;s my child
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={!chosen || loading}
                onPress={() => submit("claim_unsure", chosen!)}
                className={`py-3 rounded-xl border items-center ${
                  chosen ? "border-gray-300 bg-white" : "border-gray-200 bg-gray-100"
                }`}
              >
                <Text
                  className={`font-medium text-sm ${
                    chosen ? "text-gray-900" : "text-gray-400"
                  }`}
                >
                  I&rsquo;m not sure
                </Text>
              </TouchableOpacity>

              {/* "No" needs no selection — it is a statement about all of them. */}
              <TouchableOpacity
                disabled={loading}
                onPress={() => submit("create_anyway")}
                className="py-3 rounded-xl border border-gray-300 bg-white items-center"
              >
                <Text className="font-medium text-sm text-gray-900">
                  No, add {name.trim() || "my child"} as a new child
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => setCandidates(null)}
              className="mt-3 items-center"
              disabled={loading}
            >
              <Text className="text-sm text-gray-500">Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
}
