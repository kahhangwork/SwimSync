// "Has your coach already added your child?" — the masked candidate popup.
// Moved from app/(parent)/home/add-child.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F). UI restyle step 3.6: DESIGN.md tokens only — the three answers stay
// equal-weight secondary buttons (see the ⚠ below), the chosen card is the
// Selected fill. Every disabled condition and press handler is unchanged.
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
          <View className="bg-surface border border-border rounded-card shadow-float p-5 w-full max-w-md">
            <Text className="text-headline font-semibold text-ink">
              Is this your child?
            </Text>
            <Text className="mt-1 text-body text-ink-secondary">
              Your coach may have already added your child. If one of these is
              them, we&rsquo;ll ask your coach to confirm rather than creating a
              second profile.
            </Text>

            <View className="mt-4 gap-2">
              {candidates.map((c) => (
                <TouchableOpacity
                  key={c.student_id}
                  onPress={() => setChosen(c.student_id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen === c.student_id }}
                  aria-pressed={chosen === c.student_id}
                  className={`min-h-11 justify-center py-2.5 px-3 rounded-control border ${
                    chosen === c.student_id
                      ? "bg-selected border-ink"
                      : "bg-surface border-border"
                  }`}
                >
                  <Text className="text-body font-medium text-ink">
                    {describeCandidate(c)}
                  </Text>
                  <Text className="mt-0.5 text-body-secondary text-ink-secondary">
                    {matchReasonLabel(c.match_reason)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="mt-5 gap-2">
              <TouchableOpacity
                disabled={!chosen || loading}
                onPress={() => submit("claim_confirmed", chosen!)}
                className={`min-h-11 rounded-control border items-center justify-center ${
                  chosen ? "border-border-strong bg-surface" : "border-border bg-status-neutral-bg"
                }`}
              >
                <Text
                  className={`text-body font-semibold ${
                    chosen ? "text-ink" : "text-ink-muted"
                  }`}
                >
                  Yes, that&rsquo;s my child
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={!chosen || loading}
                onPress={() => submit("claim_unsure", chosen!)}
                className={`min-h-11 rounded-control border items-center justify-center ${
                  chosen ? "border-border-strong bg-surface" : "border-border bg-status-neutral-bg"
                }`}
              >
                <Text
                  className={`text-body font-semibold ${
                    chosen ? "text-ink" : "text-ink-muted"
                  }`}
                >
                  I&rsquo;m not sure
                </Text>
              </TouchableOpacity>

              {/* "No" needs no selection — it is a statement about all of them. */}
              <TouchableOpacity
                disabled={loading}
                onPress={() => submit("create_anyway")}
                className="min-h-11 rounded-control border border-border-strong bg-surface items-center justify-center"
              >
                <Text className="text-body font-semibold text-ink">
                  No, add {name.trim() || "my child"} as a new child
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => setCandidates(null)}
              className="mt-1 min-h-11 items-center justify-center"
              disabled={loading}
            >
              <Text className="text-body font-semibold text-primary">Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
}
