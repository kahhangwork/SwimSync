import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { backlogWindowStart, formatSgDate } from "@/lib/lessonDates";
import { isNowInRange } from "@/lib/timeOfDay";
import {
  progressLabel,
  formatAttendees,
  isFinished,
  type LessonProgress,
} from "@/lib/attendanceSummary";
import {
  selectableWeekOffsets,
  canGoBack,
  canGoForward,
} from "@/lib/scheduleWeek";
import { bucketWeek } from "@/lib/scheduleBuckets";
import { locationChips } from "@/lib/locationFilter";
import { canMark, roleBadge, type LessonRole } from "@/lib/coachRoster";
import Card from "@/components/Card";
import PrimaryButton from "@/components/PrimaryButton";
import type { WeekLesson } from "@/features/schedule/types";
import {
  formatTime,
  shortDate,
  dayHeading,
} from "@/features/schedule/domain/scheduleFormat";
import { useWeek } from "@/features/schedule/domain/useWeek";
import { useScheduleLoad } from "@/features/schedule/domain/useScheduleLoad";

/**
 * The status pill. One component for every section, so a state cannot be worded
 * or coloured one way here and another way there.
 *
 * Colour carries no information the text does not — the label is always present
 * — because a coach reading this outdoors on a phone is exactly the case where
 * colour alone fails.
 */
function ProgressChip({ progress }: { progress: LessonProgress }) {
  // `hex` as well as the Tailwind class: Ionicons takes a colour PROP and
  // ignores className, so without it the glyph renders default black inside a
  // coloured pill. Keep the two in step.
  const tone = {
    "no-students": { bg: "bg-gray-100",   fg: "text-gray-500",   hex: "#6b7280", icon: "remove-outline" },
    upcoming:      { bg: "bg-gray-100",   fg: "text-gray-500",   hex: "#6b7280", icon: "time-outline" },
    unmarked:      { bg: "bg-orange-100", fg: "text-orange-700", hex: "#c2410c", icon: "alert-circle-outline" },
    partial:       { bg: "bg-amber-100",  fg: "text-amber-700",  hex: "#b45309", icon: "ellipse-outline" },
    complete:      { bg: "bg-green-100",  fg: "text-green-700",  hex: "#15803d", icon: "checkmark-circle" },
  }[progress.kind];

  return (
    <View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${tone.bg}`}>
      <Ionicons name={tone.icon as any} size={12} color={tone.hex} />
      <Text className={`text-xs font-semibold ${tone.fg}`}>
        {progressLabel(progress)}
      </Text>
    </View>
  );
}

/**
 * "Covering" / "Shadowing" / "Covered" — who is teaching a lesson, when it is
 * not simply the coach reading the screen.
 *
 * ⚠ VIOLET, AND NOT ONE OF THE PROGRESS CHIP'S COLOURS. This says something
 * orthogonal to marking state — a covered lesson can be unmarked, partial or
 * complete — and reusing amber or green here would read as a fourth status.
 * `null` for an ordinary lesson: a business that has never rostered anybody
 * gains no new furniture on its screens.
 *
 * Module scope for the same reason as `ProgressChip` and `DaySection` below.
 */
function RoleBadge({ role }: { role: LessonRole }) {
  const label = roleBadge(role);
  if (!label) return null;
  return (
    <View className="self-start rounded-full bg-violet-100 px-2 py-0.5 mt-1">
      <Text className="text-[10px] font-semibold text-violet-700">{label}</Text>
    </View>
  );
}

/**
 * A collapsed day under COMING UP or DONE.
 *
 * ⚠ MODULE SCOPE, NOT NESTED IN THE SCREEN. Declared inside the component body
 * this is a NEW component type on every render, so React unmounts and remounts
 * every COMING UP / DONE subtree on each one — including every expand press and
 * every `loading` flip. It survives that today only because it holds no state
 * of its own, and it stops surviving the moment anyone adds any. `ProgressChip`
 * is at module scope for the same reason.
 */
function DaySection({
  group,
  tappable,
  open,
  onToggle,
  onOpenLesson,
}: {
  group: { date: string; items: WeekLesson[] };
  tappable: boolean;
  open: boolean;
  onToggle: (date: string) => void;
  onOpenLesson: (l: WeekLesson) => void;
}) {
  const allMarked = group.items.every((l) => isFinished(l.progress));
  return (
    <View className="mb-2">
      <TouchableOpacity
        onPress={() => onToggle(group.date)}
        className="flex-row items-center gap-2 py-2"
      >
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={14}
          color="#6b7280"
        />
        <Text className="text-sm font-semibold text-gray-700">
          {dayHeading(group.date)}
        </Text>
        <Text className="text-xs text-gray-400">
          {group.items.length === 1 ? "1 lesson" : `${group.items.length} lessons`}
        </Text>
        {allMarked && (
          <Ionicons name="checkmark-circle" size={14} color="#15803d" />
        )}
      </TouchableOpacity>

      {open && (
        <View className="gap-2 pl-6">
          {group.items.map((l) => (
            <TouchableOpacity
              key={`${l.classId}:${l.date}`}
              activeOpacity={tappable ? 0.8 : 1}
              onPress={() =>
                tappable
                  ? onOpenLesson(l)
                  : // ⚠ A FUTURE LESSON MUST NOT REACH THE ATTENDANCE SCREEN.
                    // checkMarkableDate refuses `date > today` outright, and
                    // refuses a booking on a non-weekday date too, so the only
                    // exit from there is a `replace` back here — a dead tap.
                    // The roster is the honest destination for "who is coming".
                    router.push(`/(coach)/classes/${l.classId}/roster`)
              }
            >
              <Card>
                <View className="flex-row items-start justify-between">
                  <View className="flex-1">
                    <Text
                      className={`text-sm font-bold ${
                        l.cancelled ? "text-gray-500 line-through" : "text-gray-900"
                      }`}
                    >
                      {l.title}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-0.5">
                      {formatTime(l.startTime)} – {formatTime(l.endTime)}
                    </Text>
                    {l.cancelled && (
                      <Text className="text-xs font-semibold text-gray-500 mt-0.5">
                        Cancelled by your admin
                      </Text>
                    )}
                    <RoleBadge role={l.role} />
                  </View>
                  <ProgressChip progress={l.progress} />
                </View>
                <Text className="text-xs text-gray-500 mt-1">
                  {formatAttendees(l.students, l.guests)}
                  {l.summary ? ` · ${l.summary}` : ""}
                </Text>
              </Card>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function ScheduleScreen() {
  const {
    weekOffset,
    setWeekOffset,
    todayDate,
    nowMins,
    todayStr,
    weekStart,
    weekEnd,
    showsTodaySection,
    label,
  } = useWeek();
  const { session, needsMarking, weekLessons, floor, truncated, loading, loadData } =
    useScheduleLoad({ weekOffset, todayDate, nowMins, weekStart, weekEnd });

  // "" = all locations. Filters the WEEK buckets only — NEEDS MARKING stays
  // floor-scoped and ignores it, the same way it ignores the week selector, so a
  // straggler at another location is never hidden.
  const [locationFilter, setLocationFilter] = useState<string>("");
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  // Derived AFTER the load: it needs the business's floor (Stage 4 moves it).
  const bounds = selectableWeekOffsets(
    todayDate,
    backlogWindowStart(todayDate, null, floor)
  );

  // ⚠ ONE EFFECT, NOT TWO. `useFocusEffect` re-runs whenever its callback
  // identity changes WHILE FOCUSED, and `loadData` is rebuilt on every
  // `weekOffset` change — so it already covers pressing an arrow. An extra
  // `useEffect(..., [loadData])` beside it is not a safety net, it is a second
  // full four-query round on every mount and every arrow press.
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // ── DE-DUPLICATION, IN THE RENDER BODY ────────────────────────────────────
  // Today's unmarked lesson belongs in TODAY (where it has a button), not in
  // both sections. Deriving this here — from the same render's `needsMarking`
  // and `showsTodaySection` — means the two values cannot disagree. Doing it
  // inside loadData would make a week that re-renders without refetching show
  // neither, and today's lesson would be unmarkable from the landing tab.
  const visibleNeedsMarking = needsMarking.filter(
    (i) => !(showsTodaySection && i.date === todayDate)
  );

  // A lesson appears in EXACTLY ONE section. Anything already listed under
  // NEEDS MARKING is pulled out of the week's own buckets, or an unmarked past
  // lesson would render twice — once as a nag and once under DONE, which reads
  // as "finished" and is the opposite of true. (Today's lesson goes the other
  // way: bucketWeek puts it in `today`, and the filter above keeps it out of
  // NEEDS MARKING so it keeps its Mark button.)
  const needsKeys = new Set(
    visibleNeedsMarking.map((i) => `${i.class_id}:${i.date}`)
  );
  // Distinct locations across the week's lessons, for the filter chips.
  const scheduleLocationOpts = React.useMemo(
    () => locationChips(weekLessons.map((l) => ({ id: l.locationId, name: l.location }))),
    [weekLessons]
  );

  // Clamp to "all" when the selected location has no lessons this week — else the
  // chips disappear (options ≤ 1) while the filter renders the week empty with no
  // control to clear it.
  const effLocationFilter = scheduleLocationOpts.some((o) => o.id === locationFilter)
    ? locationFilter
    : "";
  const buckets = bucketWeek(
    weekLessons
      .filter((l) => !needsKeys.has(`${l.classId}:${l.date}`))
      .filter((l) => !effLocationFilter || l.locationId === effLocationFilter),
    todayDate
  );
  const todayLessons = showsTodaySection ? buckets.today : [];
  const todayStudents = todayLessons.reduce((s, l) => s + l.students, 0);
  const todayGuests = todayLessons.reduce((s, l) => s + l.guests, 0);

  const toggleDay = (date: string) =>
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  // ⚠ `sessionId` IS DELIBERATELY NOT PASSED. The attendance screen resolves
  // the session from (class_id, date) itself and no longer accepts one from the
  // URL — it used to trust it without checking that it belonged to this class
  // or this date. `l.sessionId` is still carried in the item because the
  // sections use it to render marking state; it is simply not navigation input.
  const openAttendance = (l: { classId: string; date: string; sessionId: string | null }) =>
    router.push(
      `/(coach)/classes/${l.classId}/attendance?date=${l.date}&from=schedule`
    );

  /** A collapsed day, expandable. Used by COMING UP and DONE. */

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      <ScrollView
        contentContainerClassName="px-5 py-6 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting. The long-form SGT date is also the cheapest possible proof
            that this screen's date is the Singapore one, and verify-tz-saturday
            asserts on it (§7.7). */}
        <View className="mb-4">
          <Text className="text-gray-500 text-sm">Good morning,</Text>
          <Text className="text-2xl font-bold text-gray-900">
            Coach {session?.fullName ?? "—"}
          </Text>
          <Text className="text-sm text-gray-400 mt-0.5">{todayStr}</Text>
        </View>

        {/* ── WEEK SELECTOR ───────────────────────────────────────────────── */}
        <View className="flex-row items-center justify-between mb-4 bg-white rounded-2xl px-2 py-2 border border-gray-100">
          {/* testIDs because these are ICON-ONLY controls — there is no text
              for a driver to grab, and a positional click is exactly the
              brittleness §7.10/§7.58 punish. They render as data-testid on
              RN-web, so Playwright's getByTestId finds them. */}
          <TouchableOpacity
            testID="week-prev"
            disabled={!canGoBack(weekOffset, bounds.min)}
            onPress={() => setWeekOffset((w) => w - 1)}
            className="px-3 py-1.5"
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={canGoBack(weekOffset, bounds.min) ? "#0ea5e9" : "#d1d5db"}
            />
          </TouchableOpacity>

          <View className="items-center">
            <Text className="text-sm font-semibold text-gray-900">
              {shortDate(weekStart)} – {shortDate(weekEnd)}
            </Text>
            {label !== "" && (
              <Text className="text-xs text-sky-600">{label}</Text>
            )}
          </View>

          <TouchableOpacity
            testID="week-next"
            disabled={!canGoForward(weekOffset, bounds.max)}
            onPress={() => setWeekOffset((w) => w + 1)}
            className="px-3 py-1.5"
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={canGoForward(weekOffset, bounds.max) ? "#0ea5e9" : "#d1d5db"}
            />
          </TouchableOpacity>
        </View>

        {/* Location filter — only when this coach's week spans more than one.
            Filters the week's sections; NEEDS MARKING deliberately ignores it. */}
        {scheduleLocationOpts.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 pb-1"
            className="mb-4 -mx-1 px-1"
          >
            {[{ id: "", name: "All locations" }, ...scheduleLocationOpts].map((opt) => {
              const active = effLocationFilter === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id || "all"}
                  onPress={() => setLocationFilter(opt.id)}
                  activeOpacity={0.8}
                  className={`rounded-full px-4 py-1.5 ${
                    active ? "bg-sky-600" : "bg-white border border-gray-200"
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      active ? "text-white" : "text-gray-600"
                    }`}
                  >
                    {opt.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* One tap back to the present. Marking a straggler correctly returns
            the coach to that past week, which is right for the straggler and
            wrong as a resting state. */}
        {weekOffset !== 0 && (
          <TouchableOpacity
            testID="week-today"
            onPress={() => setWeekOffset(0)}
            className="mb-4 self-start flex-row items-center gap-1"
          >
            <Ionicons name="today-outline" size={14} color="#0ea5e9" />
            <Text className="text-xs font-semibold text-sky-600">
              Back to this week
            </Text>
          </TouchableOpacity>
        )}

        {truncated && (
          <Card className="mb-4 border-amber-200 bg-amber-50">
            <Text className="text-sm font-semibold text-amber-800">
              Too many lessons to check at once
            </Text>
            <Text className="text-xs text-amber-700 mt-1">
              This list may be incomplete. Ask your admin before relying on it to
              tell you what still needs marking.
            </Text>
          </Card>
        )}

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#0ea5e9" />
          </View>
        ) : (
          <>
            {/* ── NEEDS MARKING ─────────────────────────────────────────────
                ⚠ THE HEADING STRING IS `NEEDS MARKING (N)` AND THE COUNT IS
                PART OF IT. Three drivers assert on it verbatim, and the
                parenthesised number is the only assertion that the floor-scoped
                set is neither larger nor smaller than it should be. Do not
                relax those regexes to a bare /NEEDS MARKING/. Keep this string
                UNIQUE on the screen too — a negative assertion elsewhere
                (`!/needs marking/i`) false-fails if the words appear twice. */}
            {visibleNeedsMarking.length > 0 && (
              <View className="mb-6">
                <Text className="text-lg font-bold text-gray-900 mb-1">
                  NEEDS MARKING ({visibleNeedsMarking.length})
                </Text>
                <Text className="text-xs text-gray-500 mb-3">
                  These lessons have no attendance yet and won&apos;t be billed
                  until they do.
                </Text>
                <View className="gap-2">
                  {visibleNeedsMarking.map((item) => (
                    <TouchableOpacity
                      key={`${item.class_id}:${item.date}`}
                      onPress={() =>
                        openAttendance({
                          classId: item.class_id,
                          date: item.date,
                          sessionId: item.session_id,
                        })
                      }
                      activeOpacity={0.8}
                    >
                      <Card className="flex-row items-center gap-3 border-orange-200 bg-orange-50">
                        <View className="w-9 h-9 rounded-full bg-orange-100 items-center justify-center">
                          <Ionicons name="alert" size={18} color="#ea580c" />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-gray-800">
                            {item.class_title}
                          </Text>
                          <Text className="text-xs text-orange-600">
                            {formatSgDate(item.date)}
                          </Text>
                          <Text className="text-xs text-gray-500 mt-0.5">
                            {progressLabel(item.progress)}
                            {item.summary ? ` · ${item.summary}` : ""}
                          </Text>
                        </View>
                        <View className="flex-row items-center gap-1">
                          <Text className="text-xs font-semibold text-orange-600">
                            Mark
                          </Text>
                          <Ionicons name="chevron-forward" size={13} color="#ea580c" />
                        </View>
                      </Card>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* ── TODAY — only in the current week ───────────────────────── */}
            {showsTodaySection && (
              <View className="mb-6">
                <Text className="text-lg font-bold text-gray-900">
                  TODAY · {dayHeading(todayDate)}
                </Text>
                {/* The three tiles this replaced (Classes / Students / Guests
                    Today) are folded in here — every number kept, the vertical
                    space reclaimed, because this screen is far denser than the
                    one-day screen it replaces. Guests stay counted APART from
                    students: a guest at one lesson is not a weekly student. */}
                <Text className="text-xs text-gray-500 mb-3">
                  {todayLessons.length === 0
                    ? "No lessons today."
                    : `${todayLessons.length === 1 ? "1 lesson" : `${todayLessons.length} lessons`} · ${formatAttendees(todayStudents, todayGuests)}`}
                </Text>

                <View className="gap-3">
                  {todayLessons.map((l) => {
                    const isActive = isNowInRange(l.startTime, l.endTime, nowMins);
                    return (
                      <Card
                        key={`${l.classId}:${l.date}`}
                        className={isActive ? "border-sky-200 bg-sky-50" : ""}
                      >
                        {isActive && (
                          <View className="flex-row items-center gap-1.5 mb-2">
                            <View className="w-2 h-2 rounded-full bg-green-500" />
                            <Text className="text-xs font-semibold text-green-600">
                              Now
                            </Text>
                          </View>
                        )}

                        <View className="flex-row items-start justify-between mb-3">
                          <View className="flex-1">
                            <Text
                              className={`text-base font-bold ${
                                l.cancelled ? "text-gray-500 line-through" : "text-gray-900"
                              }`}
                            >
                              {l.title}
                            </Text>
                            {l.cancelled && (
                              <Text className="text-xs font-semibold text-gray-500 mt-0.5">
                                Cancelled by your admin — nothing to mark
                              </Text>
                            )}
                            <View className="flex-row items-center gap-1.5 mt-1">
                              <Ionicons name="time-outline" size={13} color="#6b7280" />
                              <Text className="text-xs text-gray-500">
                                {formatTime(l.startTime)} – {formatTime(l.endTime)}
                              </Text>
                            </View>
                            <View className="flex-row items-center gap-1.5 mt-0.5">
                              <Ionicons name="location-outline" size={13} color="#6b7280" />
                              <Text className="text-xs text-gray-500">
                                {l.location}
                              </Text>
                            </View>
                            <RoleBadge role={l.role} />
                          </View>
                          <ProgressChip progress={l.progress} />
                        </View>

                        <Text className="text-xs text-gray-500 mb-3 -mt-1">
                          {formatAttendees(l.students, l.guests)}
                          {l.summary ? ` · ${l.summary}` : ""}
                        </Text>

                        {/* isFinished, NOT `kind !== "unmarked"`. A card that
                            stops asking for marks it still needs is a lesson
                            that never gets marked, and that blocks the month
                            with no override (§8a). Any state added later
                            inherits the loud button.

                            A lesson I am shadowing, or one another coach was
                            rostered to cover, is the ONE case where the loud
                            button is wrong: the database refuses my write, so
                            "Mark Attendance" could only ever end in an error
                            toast. The screen behind it still opens, read-only,
                            because knowing who is expected is the reason a
                            trainee is there at all. */}
                        <PrimaryButton
                          label={
                            !canMark(l.role)
                              ? "View lesson"
                              : isFinished(l.progress)
                                ? "Edit attendance"
                                : "Mark Attendance"
                          }
                          variant={
                            !canMark(l.role) || isFinished(l.progress)
                              ? "outline"
                              : "primary"
                          }
                          onPress={() => openAttendance(l)}
                        />
                      </Card>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── COMING UP ─────────────────────────────────────────────── */}
            {buckets.comingUp.length > 0 && (
              <View className="mb-6">
                <Text className="text-lg font-bold text-gray-900 mb-2">
                  COMING UP
                </Text>
                {buckets.comingUp.map((g) => (
                  <DaySection
                    key={g.date}
                    group={g}
                    tappable={false}
                    open={expandedDays.has(g.date)}
                    onToggle={toggleDay}
                    onOpenLesson={openAttendance}
                  />
                ))}
              </View>
            )}

            {/* ── DONE ──────────────────────────────────────────────────── */}
            {buckets.done.length > 0 && (
              <View className="mb-6">
                <Text className="text-lg font-bold text-gray-900 mb-2">DONE</Text>
                {buckets.done.map((g) => (
                  <DaySection
                    key={g.date}
                    group={g}
                    tappable={true}
                    open={expandedDays.has(g.date)}
                    onToggle={toggleDay}
                    onOpenLesson={openAttendance}
                  />
                ))}
              </View>
            )}

            {/* Only when there is no TODAY section to carry its own
                "No lessons today." line — otherwise an empty current week
                printed two empty states one above the other. */}
            {weekLessons.length === 0 &&
              visibleNeedsMarking.length === 0 &&
              !showsTodaySection && (
              <Card className="items-center py-10">
                <Ionicons name="sunny-outline" size={40} color="#d1d5db" />
                <Text className="text-gray-400 mt-3 text-sm">
                  No lessons this week
                </Text>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
