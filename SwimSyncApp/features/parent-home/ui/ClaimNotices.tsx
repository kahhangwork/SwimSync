// Claims awaiting the coach, and ones they turned down.
// Moved VERBATIM from app/(parent)/home/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-F); props destructured on the first line so the JSX is byte-identical
// (whitespace aside).
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Card from "@/components/Card";
import { waitingSince } from "@/lib/claimCandidates";
import type { useParentHome } from "../domain/useParentHome";

type Home = ReturnType<typeof useParentHome>;

export function ClaimNotices(p: Pick<Home, "claims" | "dismissClaim">) {
  const { claims, dismissClaim } = p;
  return (
    <>
      {/* ── Claims awaiting the coach, and ones they turned down ─────────
          A parent who claimed a child cannot re-add that child until this is
          decided, so the wait has to be visible and it has to say what to do
          about it. A declined claim explains itself and offers the way
          forward, because "nothing happened" is what makes a parent call the
          coach. */}
      {claims.map((c) => (
        <Card key={c.id} className="mb-3">
          {c.status === "pending" ? (
            <>
              <View className="flex-row items-center gap-2">
                <Ionicons name="time-outline" size={18} color="#f59e0b" />
                <Text className="font-semibold text-gray-900">
                  Waiting for your coach
                </Text>
              </View>
              <Text className="mt-1 text-sm text-gray-600">
                You asked about <Text className="font-medium">{c.claimed_name}</Text>.
                Your coach is checking whether they&rsquo;re already on their
                roster — we&rsquo;ll add them to your account once it&rsquo;s
                confirmed.
              </Text>
              <Text className="mt-1 text-xs text-gray-400">
                {waitingSince(c.created_at)} · Still waiting? Ask your coach to
                check their SwimSync admin.
              </Text>
            </>
          ) : (
            <>
              {/* ⚠ THE CLAIM WAS ABOUT A RECORD ALREADY ON THE ROSTER, NOT
                  ABOUT THE NAME THEY TYPED. The old copy said
                  "<typed name> wasn't on your coach's roster", which
                  conflated the two: the typed name was never on the roster —
                  it is what they want to CREATE. What the coach actually
                  decided is that the existing record they pointed at is not
                  their child. Reported from production 2026-07-26. */}
              <View className="flex-row items-start justify-between gap-2">
                <View className="flex-row items-center gap-2 flex-1">
                  <Ionicons
                    name="information-circle-outline"
                    size={18}
                    color="#64748b"
                  />
                  <Text className="font-semibold text-gray-900 flex-1">
                    Your coach checked — that wasn&rsquo;t {c.claimed_name}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => dismissClaim(c.id)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={18} color="#9ca3af" />
                </TouchableOpacity>
              </View>
              <Text className="mt-1 text-sm text-gray-600">
                The child already on their roster turned out to be someone
                else. If you think that&rsquo;s wrong, check with your coach —
                otherwise you can add {c.claimed_name} yourself now.
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/(parent)/home/add-child")}
                className="mt-2"
              >
                <Text className="text-sky-500 font-semibold text-sm">
                  Add {c.claimed_name}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </Card>
      ))}
    </>
  );
}
