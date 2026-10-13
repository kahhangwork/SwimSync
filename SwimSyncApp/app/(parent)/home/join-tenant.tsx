import React from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import { Button } from "@/components/ui/Button";
import { useJoinTenant } from "@/features/join-tenant/domain/useJoinTenant";

/**
 * Join a coach or swim school with the code they gave you.
 *
 * A parent cannot browse businesses — there is deliberately no directory, since
 * that would publish every coach and school on the platform and let a mis-tap
 * put a child on a stranger's roster. POSSESSION OF THE CODE is the proof that
 * this family actually deals with this business.
 *
 * The code is redeemed through the `join_tenant_by_code` RPC rather than a
 * direct query: the parent has no read access to a tenant they have not joined,
 * so resolving the code has to happen with policies bypassed, server-side.
 *
 * The markup stays here (docs/refactor/BATCH_FGH_PLAN.md, app fence); the code and
 * the redeem live in features/join-tenant/domain/useJoinTenant.
 *
 * UI restyle step 3.10: Ground and Ink in place of slate, a sentence-case field
 * label, DESIGN.md's input and button. The code field, the Join press and its
 * loading state are unchanged.
 */
export default function JoinTenantScreen() {
  const {
    code,
    setCode,
    loading,
    handleJoin,
  } = useJoinTenant();

  return (
    <SafeAreaView className="flex-1 bg-ground">
      <ScrollView contentContainerClassName="p-5">
        <TouchableOpacity
          onPress={() => router.back()}
          className="mb-4 -ml-1 min-h-11 flex-row items-center self-start"
        >
          <Ionicons name="chevron-back" size={22} color="#2563eb" />
          <Text className="ml-1 text-body font-semibold text-primary">Back</Text>
        </TouchableOpacity>

        <Text className="text-display font-semibold text-ink">
          Join your coach
        </Text>
        <Text className="mt-2 text-body text-ink-secondary">
          Your coach or swim school will give you a join code. Enter it here to
          add your children to their classes.
        </Text>

        <View className="mt-6">
          <Text className="mb-1.5 text-body font-medium text-ink">
            Join code
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="SWIM-1234 or REF-ABCDE"
            placeholderTextColor="#6b6b6b"
            autoCapitalize="characters"
            autoCorrect={false}
            className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-headline tracking-widest text-ink"
          />
          <Text className="mt-1.5 text-body-secondary text-ink-secondary">
            A join code (SWIM-1234) or a friend&rsquo;s referral code (REF-ABCDE).
            Capitals and spaces don&rsquo;t matter.
          </Text>
        </View>

        <View className="mt-6">
          <Button
            label={loading ? "Joining…" : "Join"}
            onPress={handleJoin}
            disabled={loading}
          />
        </View>

        <Surface className="mt-8">
          <Text className="text-body font-semibold text-ink">
            Don&rsquo;t have a code?
          </Text>
          <Text className="mt-1 text-body text-ink-secondary">
            Ask your coach or swim school for it. Joining doesn&rsquo;t enrol
            your child in a class on its own — they&rsquo;ll assign the class
            once you&rsquo;ve added your child&rsquo;s details.
          </Text>
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}
