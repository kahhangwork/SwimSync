import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore } from "@/store/useAppStore";
import { supabase } from "@/lib/supabase";
import StatusBadge from "@/components/StatusBadge";
import PackageBadge from "@/components/PackageBadge";
import {
  coverageByStudent,
  type StudentCoverage,
} from "@/lib/packageCoverage";
import Card from "@/components/Card";
import { waitingSince } from "@/lib/claimCandidates";
import { todayInSg, formatSgDate } from "@/lib/lessonDates";

type Child = {
  id: string;
  full_name: string;
  // "inactive" was dropped from the enum — activity is its own axis now
  // (students.is_active), so a departed child must not read "Unassigned".
  assignment_status: "unassigned" | "assigned";
  is_active: boolean;
  coach_name: string | null;
  class_day: string | null;
  class_time: string | null;
  /** An upcoming, uncancelled trial: the class title and the date. */
  trial: { class_title: string; session_date: string } | null;
  class_location: string | null;
};

/** A claim the coach has not decided yet, or has declined. */
type PendingClaim = {
  id: string;
  claimed_name: string;
  status: "pending" | "declined";
  created_at: string;
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

export default function ParentHomeScreen() {
  const session = useAppStore((s) => s.session);
  const [children, setChildren] = useState<Child[]>([]);
  const [covMap, setCovMap] = useState<Map<string, StudentCoverage>>(
    new Map()
  );
  const [creditBalance, setCreditBalance] = useState(0);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<PendingClaim[]>([]);

  /** Clear a decided notice. Only ever offered on a DECLINED claim — a pending
   *  one is what explains why this parent cannot re-add that child. */
  async function dismissClaim(id: string) {
    setClaims((cs) => cs.filter((c) => c.id !== id)); // optimistic
    await supabase.rpc("dismiss_student_claim", { p_claim_id: id });
  }

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);

    // Payment-method badges. Fire-and-forget: a failed RPC only means no
    // badges, never a broken home screen. RLS scopes the rows to this family.
    supabase
      .rpc("student_package_coverage")
      .then(({ data: cov }) => setCovMap(coverageByStudent(cov ?? [])));

    // Fetch parent record with children and their enrolments
    const { data: parent } = await supabase
      .from("parents")
      .select(`
        id,
        parent_tenant_balances(credit_balance),
        parent_students(
          students(
            id,
            full_name,
            assignment_status,
            is_active,
            student_class_enrolments(
              is_active,
              classes(
                day_of_week,
                start_time,
                end_time,
                location_name,
                coaches(
                  profiles(full_name)
                )
              )
            )
          )
        )
      `)
      .eq("profile_id", session.id)
      .single();

    if (parent) {
      // Credit is held PER BUSINESS and is only spendable there, so there is
      // no single balance any more. The summary card shows the total the family
      // holds; the Billing tab is where each business's invoice shows what its
      // own credit actually covered.
      const balances = (parent as any).parent_tenant_balances ?? [];
      setCreditBalance(
        balances.reduce((sum: number, b: any) => sum + Number(b.credit_balance ?? 0), 0)
      );

      const mapped: Child[] = (parent.parent_students ?? []).map((ps: any) => {
        const s = ps.students;
        const activeEnrolment = (s.student_class_enrolments ?? []).find(
          (e: any) => e.is_active
        );
        const cls = activeEnrolment?.classes ?? null;
        const coachProfile = cls?.coaches?.profiles ?? null;

        return {
          id: s.id,
          full_name: s.full_name,
          assignment_status: s.assignment_status,
          is_active: s.is_active,
          coach_name: coachProfile?.full_name ?? null,
          trial: null, // filled below
          class_day: cls?.day_of_week ?? null,
          class_time: cls
            ? `${formatTime(cls.start_time)} – ${formatTime(cls.end_time)}`
            : null,
          class_location: cls?.location_name ?? null,
        };
      });

      // ⚠ A TRIAL IS NOT AN ENROLMENT, so a child who only has one booked reads
      // as "unassigned" — and the card then told the family "the admin will
      // assign your child soon", which is false and unhelpful: their lesson is
      // already booked, at a known class on a known date, and the app was the
      // only thing that knew. Reported from production 2026-07-26.
      const ids = mapped.map((c) => c.id);
      if (ids.length > 0) {
        const { data: trials } = await supabase
          .from("trial_bookings")
          .select("student_id, session_date, classes(title)")
          .in("student_id", ids)
          .is("cancelled_at", null)
          .gte("session_date", todayInSg())
          .order("session_date");

        const byStudent = new Map<string, { class_title: string; session_date: string }>();
        for (const b of (trials ?? []) as any[]) {
          // Earliest first from the query, so the first one wins.
          if (!byStudent.has(b.student_id)) {
            byStudent.set(b.student_id, {
              class_title: b.classes?.title ?? "their class",
              session_date: b.session_date,
            });
          }
        }
        for (const c of mapped) c.trial = byStudent.get(c.id) ?? null;
      }

      setChildren(mapped);

      // Fetch total outstanding invoices for this parent
      const { data: invoices } = await supabase
        .from("invoices")
        .select("net_amount")
        .eq("parent_id", parent.id)
        .eq("status", "outstanding");

      const outstanding = (invoices ?? []).reduce(
        (sum: number, inv: any) => sum + Number(inv.net_amount),
        0
      );
      setTotalOutstanding(outstanding);

      // Claims this family is waiting on. A parent who tapped "that's my
      // child" is BLOCKED from adding that child again until the coach
      // decides, so without this card they are left with a toast they saw once
      // and an app that appears to have done nothing. There is deliberately no
      // email chasing the admin (PARENT_CLAIM_PLAN decision 7), which makes
      // this the only thing managing the wait.
      const { data: claims } = await supabase
        .from("student_claims")
        .select("id, claimed_name, status, created_at")
        .eq("parent_id", parent.id)
        .in("status", ["pending", "declined"])
        // Without this a declined claim's notice is PERMANENT — there was no
        // dismissal and no time bound, so "your coach checked" became a fixture
        // of the home screen forever. Reported from production 2026-07-26.
        .is("dismissed_at", null)
        .order("created_at", { ascending: false });

      setClaims((claims ?? []) as PendingClaim[]);
    }

    setLoading(false);
  }, [session]);

  // Reload every time the screen comes into focus (e.g. after adding a child)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting */}
        <View className="flex-row items-center justify-between mb-6">
          <View>
            <Text className="text-gray-500 text-sm">Welcome back,</Text>
            <Text className="text-2xl font-bold text-gray-900">
              {session?.fullName ?? "—"}
            </Text>
          </View>
          <View className="w-10 h-10 rounded-full bg-sky-500 items-center justify-center">
            <Text className="text-white font-bold text-base">
              {session?.fullName?.charAt(0) ?? "?"}
            </Text>
          </View>
        </View>

        {/* Outstanding summary */}
        {totalOutstanding > 0 && (
          <Card className="mb-5 bg-red-50 border-red-100">
            <View className="flex-row items-center gap-2 mb-1">
              <Ionicons name="alert-circle" size={18} color="#dc2626" />
              <Text className="text-red-600 font-semibold text-sm">
                Outstanding Payment
              </Text>
            </View>
            <Text className="text-2xl font-bold text-red-700">
              S${totalOutstanding.toFixed(2)}
            </Text>
            <Text className="text-xs text-red-500 mt-0.5">
              Across all children — tap an invoice to pay
            </Text>
          </Card>
        )}

        {/* Credit balance */}
        {creditBalance > 0 && (
          <Card className="mb-5 bg-blue-50 border-blue-100">
            <View className="flex-row items-center gap-2 mb-1">
              <Ionicons name="wallet-outline" size={18} color="#2563eb" />
              <Text className="text-blue-600 font-semibold text-sm">
                Credit Balance
              </Text>
            </View>
            <Text className="text-2xl font-bold text-blue-700">
              S${creditBalance.toFixed(2)}
            </Text>
            <Text className="text-xs text-blue-500 mt-0.5">
              Will be applied to your next invoice automatically
            </Text>
          </Card>
        )}

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

        {/* Children section */}
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-lg font-bold text-gray-900">My Children</Text>
          <TouchableOpacity
            onPress={() => router.push("/(parent)/home/add-child")}
            className="flex-row items-center gap-1"
          >
            <Ionicons name="add-circle-outline" size={20} color="#0ea5e9" />
            <Text className="text-sky-500 font-semibold text-sm">Add Child</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : children.length === 0 ? (
          <Card className="items-center py-10">
            <Ionicons name="people-outline" size={40} color="#d1d5db" />
            <Text className="text-gray-400 mt-3 text-sm">No children added yet</Text>
            <TouchableOpacity
              onPress={() => router.push("/(parent)/home/add-child")}
              className="mt-3"
            >
              <Text className="text-sky-500 font-semibold text-sm">
                Add your first child
              </Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <View className="gap-3">
            {children.map((child) => (
              <TouchableOpacity
                key={child.id}
                onPress={() => router.push(`/(parent)/home/child/${child.id}`)}
                activeOpacity={0.8}
              >
                <Card>
                  <View className="flex-row items-start justify-between mb-3">
                    <View className="flex-row items-center gap-3">
                      <View className="w-10 h-10 rounded-full bg-sky-100 items-center justify-center">
                        <Text className="text-sky-600 font-bold text-base">
                          {child.full_name.charAt(0)}
                        </Text>
                      </View>
                      <View>
                        <Text className="text-base font-bold text-gray-900">
                          {child.full_name}
                        </Text>
                        <View className="mt-0.5">
                          <PackageBadge coverage={covMap.get(child.id)} />
                        </View>
                      </View>
                    </View>
                    <StatusBadge
                      status={
                        child.is_active
                          ? capitalize(child.assignment_status)
                          : "Inactive"
                      }
                      size="sm"
                    />
                  </View>

                  {child.is_active && child.assignment_status === "assigned" ? (
                    <View className="bg-sky-50 rounded-xl p-3 gap-1">
                      <View className="flex-row items-center gap-1.5">
                        <Ionicons name="person-outline" size={13} color="#0284c7" />
                        <Text className="text-xs text-sky-700">
                          {child.coach_name ?? "—"}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <Ionicons name="calendar-outline" size={13} color="#0284c7" />
                        <Text className="text-xs text-sky-700">
                          {capitalize(child.class_day)} · {child.class_time}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <Ionicons name="location-outline" size={13} color="#0284c7" />
                        <Text className="text-xs text-sky-700">
                          {child.class_location ?? "—"}
                        </Text>
                      </View>
                    </View>
                  ) : !child.is_active ? (
                    // An inactive child is NOT waiting for placement — telling
                    // them "the admin will assign your child soon" promises
                    // something that is not coming.
                    <View className="bg-gray-100 rounded-xl p-3">
                      <Text className="text-xs text-gray-600">
                        No longer attending. Their attendance and invoices are
                        still here. Contact your coach if this looks wrong.
                      </Text>
                    </View>
                  ) : child.trial ? (
                    /* Booked for one lesson. Says WHEN, which is the whole
                       question a family has about a trial. */
                    <View className="bg-sky-50 rounded-xl p-3">
                      <Text className="text-xs font-semibold text-sky-800">
                        Trial lesson booked
                      </Text>
                      <Text className="mt-0.5 text-xs text-sky-700">
                        {child.trial.class_title} ·{" "}
                        {formatSgDate(child.trial.session_date, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </Text>
                    </View>
                  ) : (
                    <View className="bg-yellow-50 rounded-xl p-3">
                      <Text className="text-xs text-yellow-700">
                        Not yet assigned to a class. The admin will assign your child soon.
                      </Text>
                    </View>
                  )}
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
