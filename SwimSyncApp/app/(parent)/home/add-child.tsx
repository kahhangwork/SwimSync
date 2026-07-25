import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import PrimaryButton from "@/components/PrimaryButton";
import {
  describeCandidate,
  matchReasonLabel,
  type ClaimCandidate,
} from "@/lib/claimCandidates";

const GENDER_OPTIONS = ["Male", "Female"];

type JoinedTenant = { id: string; display_name: string };

export default function AddChildScreen() {
  // Which business this child is being added to. A child belongs to exactly one
  // (students.tenant_id), and the parent may only pick from businesses they
  // have actually JOINED with a code — never a directory of every coach on the
  // platform, which would let a mis-tap put a child on a stranger's roster.
  const [tenants, setTenants] = useState<JoinedTenant[] | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("Male");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  // The candidate popup. `null` = not showing; the server decides whether it
  // appears at all, so there is no client-side rule here to get out of step.
  const [candidates, setCandidates] = useState<ClaimCandidate[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  // A last look before the record exists. Creating a child is close to
  // irreversible in this product — there is no delete, only "set inactive"
  // (PRD §7.14), because attendance and invoices hang off the row. So a typo
  // in a name or a date is something the family lives with, and the cost of
  // one extra tap is far below the cost of a permanent wrong record.
  const [reviewing, setReviewing] = useState(false);

  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);

  // Reloaded on focus, so returning from the join screen picks up a code the
  // parent has just redeemed without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // Only businesses this family is still ACTIVE with. A family the
        // business has marked inactive can still log in and read their history
        // — that is deliberate, their invoices are the record — but adding a
        // new child there would silently re-enter a business that has closed
        // them off. Re-entering the join code is the way back in, and it is
        // the business's own gate.
        //
        // Gated on `is_active = false` explicitly, never on absence-of-truthy:
        // a family with no rows at all is a NEW parent, and must land on the
        // "join a business" prompt rather than an error.
        const { data } = await supabase
          .from("parent_tenants")
          .select("tenant_id, is_active, tenants(id, display_name)")
          .eq("is_active", true)
          .order("joined_at");
        if (cancelled) return;

        const list: JoinedTenant[] = (data ?? [])
          .map((r: any) => r.tenants)
          .filter(Boolean);
        setTenants(list);
        // One business is the overwhelmingly common case — select it rather
        // than making every parent tap a single-option picker.
        setTenantId((prev) => prev ?? (list.length === 1 ? list[0].id : null));
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  async function handleSave() {
    if (!tenantId) {
      showToast("Choose which coach or school this child is with.", "error");
      return;
    }
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

    // Confirm the details BEFORE anything is written. The duplicate check runs
    // after this, on the server — the two are separate questions: "is this what
    // you meant to type?" then "does your coach already have this child?".
    setReviewing(true);
  }

  /**
   * The ONE write path for adding a child.
   *
   * This used to be a plain INSERT into `students` plus a second INSERT into
   * `parent_students`. It is now a single RPC because the "has your coach
   * already added this child?" check has to happen BEFORE the insert, and a
   * check the client could skip is not a check — `students_insert` no longer
   * admits parents at all, so this is the only door.
   *
   * `mode` is the parent's answer:
   *   check           — first attempt; the server looks for candidates
   *   claim_confirmed — "yes, that's my child"   ─┐ both file a claim; NEITHER
   *   claim_unsure    — "not sure"               ─┘ attaches the child
   *   create_anyway   — "no, that's a different child"
   */
  async function submit(
    mode: "check" | "claim_confirmed" | "claim_unsure" | "create_anyway",
    candidateId?: string
  ) {
    setLoading(true);
    setReviewing(false);

    const { data, error } = await supabase.rpc("add_child_or_claim", {
      p_tenant_id: tenantId,
      p_full_name: name.trim(),
      p_date_of_birth: dob.trim(),
      p_gender: gender.toLowerCase(),
      p_notes: notes.trim() || null,
      p_mode: mode,
      p_candidate_id: candidateId ?? null,
    });

    setLoading(false);

    if (error) {
      // A child is identified by name + date of birth within a business
      // (students_identity_uniq). Hitting it almost always means this child is
      // already registered — a parent tapping Save twice, or re-adding a child
      // they forgot they had. The RPC raises that message already worded for a
      // parent, so pass it through rather than inventing a second copy.
      showToast(
        error.code === "23505"
          ? error.message
          : error.message || "Failed to add your child. Please try again.",
        "error"
      );
      return;
    }

    // RETURNS TABLE, so supabase-js hands back an array of one row.
    const result = Array.isArray(data) ? data[0] : data;

    if (result?.outcome === "candidates") {
      setCandidates((result.candidates ?? []) as ClaimCandidate[]);
      setChosen(null);
      return;
    }

    if (result?.outcome === "pending" || result?.outcome === "already_pending") {
      setCandidates(null);
      showToast(
        result.outcome === "pending"
          ? "Sent to your coach to confirm. We'll add your child once they do."
          : "You've already asked about this child — your coach is still checking.",
        "success"
      );
      router.back();
      return;
    }

    setCandidates(null);
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
        {/* No business joined yet: the form is useless until there is one, so
            send them to the join screen rather than letting them fill it in and
            fail on save. */}
        {tenants !== null && tenants.length === 0 && (
          <View className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-4">
            <Text className="text-base font-semibold text-gray-900">
              Join your coach first
            </Text>
            <Text className="mt-1 text-sm text-gray-600">
              Your coach or swim school will give you a join code. You&rsquo;ll
              need it before you can add a child.
            </Text>
            <PrimaryButton
              label="Enter a join code"
              onPress={() => router.push("/(parent)/home/join-tenant")}
              className="mt-4"
            />
          </View>
        )}

        {/* Which business. Shown as a read-only line when there is only one, a
            picker when the family deals with several — the expected case for a
            parent with children under different coaches. */}
        {tenants !== null && tenants.length > 0 && (
          <View className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Coach or school <Text className="text-red-500">*</Text>
            </Text>
            {tenants.length === 1 ? (
              <Text className="text-gray-900">{tenants[0].display_name}</Text>
            ) : (
              <View className="gap-2">
                {tenants.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => setTenantId(t.id)}
                    className={`py-3 px-4 rounded-xl border ${
                      tenantId === t.id
                        ? "bg-sky-500 border-sky-500"
                        : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <Text
                      className={`font-medium text-sm ${
                        tenantId === t.id ? "text-white" : "text-gray-700"
                      }`}
                    >
                      {t.display_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TouchableOpacity
              onPress={() => router.push("/(parent)/home/join-tenant")}
              className="mt-3"
            >
              <Text className="text-sm font-medium text-sky-600">
                + Add another coach or school
              </Text>
            </TouchableOpacity>
          </View>
        )}

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
    </SafeAreaView>
  );
}
