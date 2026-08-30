import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { ageFromDob, formatSgStamp } from "@/lib/lessonDates";
import StatusBadge from "@/components/StatusBadge";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";
import {
  coverageByStudent,
  describeCoverage,
  type StudentCoverage,
} from "@/lib/packageCoverage";
import {
  summariseSkillProgress,
  type GradeLevel,
  type LevelSkill,
} from "@/lib/skillProgress";

type ChildDetail = {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  level_label: string | null;
  level_note: string | null;
  /** Skills of the CURRENT level, with ids so grades can be paired to them. */
  level_skills: LevelSkill[];
  /** skill_id → grade_level_id, this child's grades on the current level. */
  skill_grades: Record<string, string>;
  /** The business's grade scale, for the "n of m at <top>" computation. */
  scale: GradeLevel[];
  notes: string | null;
  // "inactive" was dropped from the enum — activity is its own axis now
  // (students.is_active), so a departed child must not read "Unassigned".
  assignment_status: "unassigned" | "assigned";
  is_active: boolean;
  /** EVERY class, not "the" class — a child may hold several active enrolments
   *  since Wave 2 (`20260811000100`). This screen is where a parent goes to
   *  check the detail, so showing one of two is the worst of both. */
  classes: {
    coach_name: string | null;
    day: string | null;
    time: string | null;
    location: string | null;
    /** The location's street address + notes, shown so a parent knows where to
     *  go and any access detail (parking, which gate). From the entity. */
    location_address: string | null;
    location_notes: string | null;
  }[];
  outstanding_amount: number;
  credit_balance: number;
};

function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

function capitalize(str: string | null): string {
  if (!str) return "—";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return formatSgStamp(dateStr, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ChildProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [child, setChild] = useState<ChildDetail | null>(null);
  const [coverage, setCoverage] = useState<StudentCoverage | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(true);

  const loadChild = useCallback(async () => {
    setLoading(true);

    // Payment method for the Balances card. Fire-and-forget: a failed RPC
    // only means the line is absent, never a broken screen.
    supabase
      .rpc("student_package_coverage")
      .then(({ data: cov }) =>
        setCoverage(coverageByStudent(cov ?? []).get(String(id)))
      );

    const { data: student } = await supabase
      .from("students")
      .select(`
        id,
        full_name,
        date_of_birth,
        gender,
        tenant_id,
        tenant_levels(label, note, tenant_level_skills(id, label, sort_order)),
        notes,
        assignment_status,
        is_active,
        student_class_enrolments(
          is_active,
          classes(
            day_of_week,
            start_time,
            end_time,
            locations(name, address, notes),
            coaches(
              profiles(full_name)
            )
          )
        )
      `)
      .eq("id", id)
      .single();

    if (!student) {
      setLoading(false);
      return;
    }

    const classes = (student.student_class_enrolments ?? [])
      .filter((e: any) => e.is_active && e.classes)
      .map((e: any) => {
        const cls: any = e.classes;
        return {
          coach_name: cls?.coaches?.profiles?.full_name ?? null,
          day: cls?.day_of_week ?? null,
          time: `${formatTime(cls.start_time)} – ${formatTime(cls.end_time)}`,
          location: cls?.locations?.name ?? null,
          location_address: cls?.locations?.address ?? null,
          location_notes: cls?.locations?.notes ?? null,
        };
      });

    // Fetch outstanding invoices for the parent linked to this student
    const { data: parentStudentLink } = await supabase
      .from("parent_students")
      .select("parent_id")
      .eq("student_id", id)
      .single();

    let outstandingAmount = 0;
    let creditBalance = 0;

    if (parentStudentLink) {
      const { data: invoices } = await supabase
        .from("invoices")
        .select("net_amount")
        .eq("parent_id", parentStudentLink.parent_id)
        .eq("status", "outstanding");

      outstandingAmount = (invoices ?? []).reduce(
        (sum: number, inv: any) => sum + Number(inv.net_amount),
        0
      );

      const { data: parentRecord } = await supabase
        .from("parents")
        .select("parent_tenant_balances(credit_balance)")
        .eq("id", parentStudentLink.parent_id)
        .single();

      // Summed across businesses — see the note in home/index.tsx.
      creditBalance = ((parentRecord as any)?.parent_tenant_balances ?? []).reduce(
        (sum: number, b: any) => sum + Number(b.credit_balance ?? 0),
        0
      );
    }

    // The business's grade scale and this child's grades. Scoped to the CHILD's
    // tenant, not the parent's — a parent with children at two businesses would
    // otherwise pull both scales and their ranks would collide. Read-only here;
    // the coach does the grading.
    const [{ data: scaleRows }, { data: progressRows }] = await Promise.all([
      supabase
        .from("skill_grade_levels")
        .select("id, rank, label")
        .eq("tenant_id", (student as any).tenant_id)
        .order("rank"),
      supabase
        .from("student_skill_progress")
        .select("skill_id, grade_level_id")
        .eq("student_id", id),
    ]);

    setChild({
      id: student.id,
      full_name: student.full_name,
      date_of_birth: student.date_of_birth,
      gender: student.gender,
      // Cast because supabase-js infers a to-one embed as an ARRAY without an
      // !inner hint. Read off tenant_levels, not off the student (§7.28).
      level_label: (student as any).tenant_levels?.label ?? null,
      level_note: (student as any).tenant_levels?.note ?? null,
      // Kept unsorted here — summariseSkillProgress orders by sort_order/label at
      // render. Carry the id so grades can be paired to each skill.
      level_skills: ((student as any).tenant_levels?.tenant_level_skills ?? []).map(
        (sk: any) => ({ id: sk.id, label: sk.label, sort_order: sk.sort_order })
      ),
      skill_grades: Object.fromEntries(
        ((progressRows as any[]) ?? []).map((p) => [p.skill_id, p.grade_level_id])
      ),
      scale: (scaleRows as GradeLevel[]) ?? [],
      notes: student.notes,
      assignment_status: student.assignment_status,
      is_active: student.is_active,
      classes,
      outstanding_amount: outstandingAmount,
      credit_balance: creditBalance,
    });

    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadChild();
    }, [loadChild])
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  // Derived after the null guard so `child` is known present. Age is never
  // stored — date_of_birth is the fact (see ageFromDob).
  const age = ageFromDob(child?.date_of_birth ?? null);

  if (!child) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center px-6">
        <Ionicons name="alert-circle-outline" size={40} color="#d1d5db" />
        <Text className="text-gray-400 mt-3 text-center">
          Could not load child profile.
        </Text>
        <TouchableOpacity onPress={() => router.back()} className="mt-4">
          <Text className="text-sky-500 font-semibold">Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 bg-sky-50">
        <TouchableOpacity onPress={() => router.back()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900 flex-1">Child Profile</Text>
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-4"
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <Card>
          <View className="flex-row items-center gap-4 mb-4">
            <View className="w-16 h-16 rounded-full bg-sky-100 items-center justify-center">
              <Text className="text-sky-600 font-bold text-2xl">
                {child.full_name.charAt(0)}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-xl font-bold text-gray-900">
                {child.full_name}
              </Text>
              <StatusBadge
                status={child.is_active ? capitalize(child.assignment_status) : "Inactive"}
                size="sm"
              />
            </View>
            {/* Editing is the parent's, per PRD §7.4 — which claimed it long
                before anything implemented it. Only the profile fields: the
                business, the class assignment and activity all belong to the
                business's admin. */}
            <TouchableOpacity
              onPress={() => router.push(`/(parent)/home/edit-child?id=${child.id}`)}
              className="px-3 py-1.5 rounded-lg border border-gray-200"
            >
              <Text className="text-sm font-medium text-sky-600">Edit</Text>
            </TouchableOpacity>
          </View>

          <View className="gap-2">
            <Row label="Date of Birth" value={formatDate(child.date_of_birth)} />
            {/* Derived, never stored — see ageFromDob. Omitted rather than
                shown as 0 when the DOB is missing or unparseable. */}
            {age !== null ? (
              <Row label="Age" value={`${age} ${age === 1 ? "year" : "years"} old`} />
            ) : null}
            <Row label="Gender"        value={capitalize(child.gender)} />
            {/* Set by the business's admin; read-only to the parent. Omitted
                rather than shown as "—" when unset — a business that does not
                use levels should not have an empty row on every child. */}
            {child.level_label ? (
              <Row label="Level" value={child.level_label} />
            ) : null}
            {child.notes ? <Row label="Notes" value={child.notes} /> : null}
          </View>
        </Card>

        {/* What this level teaches — the clearest answer the app has to
            "what is my child working towards?", which it could not answer at
            all before. Read-only: the business's admin owns the curriculum. */}
        {child.level_label && (child.level_skills.length > 0 || child.level_note) ? (
          (() => {
            // The child's progress against the current level, paired and counted.
            const summary = summariseSkillProgress(
              child.level_skills,
              Object.entries(child.skill_grades).map(([skill_id, grade_level_id]) => ({
                skill_id,
                grade_level_id,
              })),
              child.scale
            );
            return (
              <Card>
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-base font-bold text-gray-900">
                    {child.level_label}
                  </Text>
                  {/* The headline: how many skills are at the top grade. Only
                      shown once a scale exists and there is something to count. */}
                  {summary.total > 0 && summary.topGradeLabel ? (
                    <Text className="text-xs font-semibold text-gray-500">
                      {summary.doneCount} of {summary.total} at {summary.topGradeLabel}
                    </Text>
                  ) : null}
                </View>
                {child.level_note ? (
                  <Text className="text-xs italic text-gray-500 mb-3">
                    {child.level_note}
                  </Text>
                ) : (
                  <View className="mb-3" />
                )}
                {summary.skills.length > 0 ? (
                  <View className="gap-2">
                    {summary.skills.map((sk, i) => (
                      <View key={sk.id} className="flex-row items-center gap-2.5">
                        <Text className="text-sky-500 font-semibold text-sm w-4">
                          {i + 1}
                        </Text>
                        <Text className="text-sm text-gray-700 flex-1">{sk.label}</Text>
                        {/* The grade the coach recorded, or nothing yet. */}
                        {sk.grade ? (
                          <View
                            className={
                              "px-2.5 py-1 rounded-full " +
                              (sk.done ? "bg-green-100" : "bg-sky-100")
                            }
                          >
                            <Text
                              className={
                                "text-xs font-semibold " +
                                (sk.done ? "text-green-700" : "text-sky-700")
                              }
                            >
                              {sk.grade.label}
                            </Text>
                          </View>
                        ) : (
                          <Text className="text-xs text-gray-300">Not yet graded</Text>
                        )}
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>
            );
          })()
        ) : null}

        {/* Assignment / Class info */}
        <Card>
          <Text className="text-base font-bold text-gray-900 mb-3">
            Class Assignment
          </Text>
          {child.is_active && child.assignment_status === "assigned" ? (
            /* One group of rows per class, separated by a rule so two classes
               cannot read as one muddled set of details. A child with a single
               class renders exactly as before — no divider, no heading. */
            <View className="gap-2">
              {child.classes.map((c, i) => (
                <View
                  key={`${c.day}-${c.time}-${i}`}
                  className={
                    i > 0 ? "gap-2 pt-3 mt-1 border-t border-gray-200" : "gap-2"
                  }
                >
                  <Row label="Coach"    value={c.coach_name ?? "—"} />
                  <Row label="Day"      value={capitalize(c.day)} />
                  <Row label="Time"     value={c.time ?? "—"} />
                  <Row label="Location" value={c.location ?? "—"} />
                  {c.location_address ? (
                    <Row label="Address" value={c.location_address} />
                  ) : null}
                  {c.location_notes ? (
                    <Row label="Getting there" value={c.location_notes} />
                  ) : null}
                </View>
              ))}
            </View>
          ) : !child.is_active ? (
            <View className="bg-gray-100 rounded-xl p-4">
              <Text className="text-gray-600 text-sm">
                No longer attending. Their attendance history and invoices are
                still here. Contact your coach if this looks wrong.
              </Text>
            </View>
          ) : (
            <View className="bg-yellow-50 rounded-xl p-4">
              <Text className="text-yellow-700 text-sm">
                Your child has not been assigned to a class yet. The admin will
                assign them shortly.
              </Text>
            </View>
          )}
        </Card>

        {/* Balances */}
        <Card>
          <Text className="text-base font-bold text-gray-900 mb-3">Balances</Text>
          <View className="flex-row gap-3">
            <View className="flex-1 bg-red-50 rounded-xl p-3 items-center">
              <Text className="text-xs text-red-500 mb-1">Outstanding</Text>
              <Text className="text-xl font-bold text-red-600">
                S${child.outstanding_amount.toFixed(2)}
              </Text>
            </View>
            <View className="flex-1 bg-blue-50 rounded-xl p-3 items-center">
              <Text className="text-xs text-blue-500 mb-1">Credit Balance</Text>
              <Text className="text-xl font-bold text-blue-600">
                S${child.credit_balance.toFixed(2)}
              </Text>
            </View>
          </View>
          {/* How this child's lessons are paid — package (with the family's
              live count) or ad-hoc invoice. Absent only if the RPC failed. */}
          {describeCoverage(coverage) && (
            <View
              className={`mt-3 rounded-xl p-3 ${
                coverage?.coverage === "ad_hoc" ? "bg-gray-50" : "bg-emerald-50"
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  coverage?.coverage === "ad_hoc"
                    ? "text-gray-500"
                    : "text-emerald-700"
                }`}
              >
                {describeCoverage(coverage)}
              </Text>
            </View>
          )}
        </Card>

        {/* Quick actions */}
        <View className="gap-3">
          <PrimaryButton
            label="View Attendance History"
            onPress={() => router.push("/(parent)/attendance")}
          />
          <PrimaryButton
            label="View Invoices"
            variant="outline"
            onPress={() => router.push("/(parent)/billing")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1.5 border-b border-gray-50">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm font-medium text-gray-800 max-w-[60%] text-right">
        {value}
      </Text>
    </View>
  );
}
