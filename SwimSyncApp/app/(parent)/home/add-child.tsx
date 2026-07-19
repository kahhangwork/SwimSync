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

    setLoading(true);

    // Get the parent record for the logged-in user
    const { data: parentRecord, error: parentError } = await supabase
      .from("parents")
      .select("id")
      .eq("profile_id", session!.id)
      .single();

    if (parentError || !parentRecord) {
      setLoading(false);
      showToast("Could not find your parent account. Please try again.", "error");
      return;
    }

    // Insert the student record
    const { data: student, error: studentError } = await supabase
      .from("students")
      .insert({
        full_name: name.trim(),
        date_of_birth: dob.trim(),
        gender: gender.toLowerCase(),
        notes: notes.trim() || null,
        assignment_status: "unassigned",
        is_active: true,
        tenant_id: tenantId,
      })
      .select("id")
      .single();

    if (studentError || !student) {
      setLoading(false);
      // A child is identified by name + date of birth within a business
      // (students_identity_uniq). Hitting it almost always means this child is
      // already registered — a parent tapping Save twice, or re-adding a child
      // they forgot they had. Say that, rather than surfacing a raw 23505.
      if (studentError?.code === "23505") {
        showToast(
          `${name.trim()} is already registered with this coach or school.`,
          "error"
        );
        return;
      }
      showToast("Failed to create child profile. Please try again.", "error");
      return;
    }

    // Link student to parent
    const { error: linkError } = await supabase
      .from("parent_students")
      .insert({
        parent_id: parentRecord.id,
        student_id: student.id,
      });

    setLoading(false);

    if (linkError) {
      showToast(
        "Child profile created but could not be linked to your account. Please contact support.",
        "error"
      );
      return;
    }

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
    </SafeAreaView>
  );
}
