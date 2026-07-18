import React, { useState } from "react";
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
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import PrimaryButton from "@/components/PrimaryButton";

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
 */
export default function JoinTenantScreen() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const showToast = useAppStore((s) => s.showToast);

  async function handleJoin() {
    const entered = code.trim();
    if (!entered) {
      showToast("Enter the code your coach gave you.", "error");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.rpc("join_tenant_by_code", {
      p_code: entered,
    });
    setLoading(false);

    if (error) {
      // The RPC's message is already parent-facing and deliberately identical
      // for every failure, so a wrong code cannot be used to probe which codes
      // are real. Pass it through rather than inventing copy.
      showToast(error.message || "That code was not recognised.", "error");
      return;
    }

    const joined = Array.isArray(data) ? data[0] : data;
    showToast(`You've joined ${joined?.display_name ?? "your coach"}.`, "success");
    router.back();
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView contentContainerClassName="p-5">
        <TouchableOpacity
          onPress={() => router.back()}
          className="mb-4 flex-row items-center"
        >
          <Ionicons name="chevron-back" size={22} color="#0f172a" />
          <Text className="ml-1 text-base text-slate-900">Back</Text>
        </TouchableOpacity>

        <Text className="text-2xl font-bold text-slate-900">
          Join your coach
        </Text>
        <Text className="mt-2 text-base text-slate-600">
          Your coach or swim school will give you a join code. Enter it here to
          add your children to their classes.
        </Text>

        <View className="mt-6">
          <Text className="mb-1 text-xs font-semibold text-slate-500">
            JOIN CODE
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="SWIM-1234"
            placeholderTextColor="#94a3b8"
            autoCapitalize="characters"
            autoCorrect={false}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-lg tracking-widest text-slate-900"
          />
          <Text className="mt-2 text-xs text-slate-500">
            Codes look like SWIM-1234. Capitals and spaces don&rsquo;t matter.
          </Text>
        </View>

        <View className="mt-6">
          <PrimaryButton
            label={loading ? "Joining…" : "Join"}
            onPress={handleJoin}
            disabled={loading}
          />
        </View>

        <View className="mt-8 rounded-2xl border border-slate-200 bg-white p-4">
          <Text className="text-sm font-semibold text-slate-900">
            Don&rsquo;t have a code?
          </Text>
          <Text className="mt-1 text-sm text-slate-600">
            Ask your coach or swim school for it. Joining doesn&rsquo;t enrol
            your child in a class on its own — they&rsquo;ll assign the class
            once you&rsquo;ve added your child&rsquo;s details.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
