import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/store/useAppStore";
import { confirmAction } from "@/lib/confirm";
import { applyBulkStatus, SET_ALL_OPTIONS, BulkOption } from "@/lib/attendanceBulk";
import { mergeRoster } from "@/lib/attendanceRoster";
import { buildAttendanceRows } from "@/lib/attendancePayload";
import { attendanceSaveErrorMessage } from "@/lib/attendanceSaveError";
import { checkMarkableDate, type MarkableCheck } from "@/lib/attendanceWindow";
import { fetchMarkableFloor } from "@/lib/markableFloor";
import {
  resolveSessionForDate,
  isShowingDate,
  type ResolvedSession,
} from "@/lib/attendanceSession";
import { toSgDate, todayInSg, type DayOfWeek, formatSgStamp } from "@/lib/lessonDates";
import {
  lessonRole,
  canMark,
  roleNotice,
  type LessonRole,
} from "@/lib/coachRoster";
import { fetchIsMainOnSession } from "@/lib/sessionMainCoach";
import {
  mayHaveIssuedCreditNote,
  notifyCreditNoteEmails,
} from "@/lib/creditNoteEmail";
import PrimaryButton from "@/components/PrimaryButton";

// "holiday" is READ-ONLY here: a public-holiday void is set by the tenant admin
// (mark_day_holiday) and the DB guard refuses a coach touching it. The coach sees
// it, never sets it — so it is excluded from the settable buttons, "Set all", the
// save validation, and the save payload below.
type TopStatus = "unmarked" | "present" | "absent" | "cancelled" | "trial" | "holiday";
type DBStatus =
  | "present"
  | "absent"
  | "cancelled_rain"
  | "cancelled_coach"
  | "trial_paid"
  | "trial_free"
  | "holiday";

type StudentRow = {
  id: string;
  full_name: string;
  /** On this roster because of an attendance row or a booking, not an
   *  enrolment. */
  attendedOnly?: boolean;
  /** Booked for a trial on this date specifically. */
  isTrial?: boolean;
  /** Booked for a make-up on this date specifically — enrolled elsewhere,
   *  guesting for one lesson. Ordinary statuses only. */
  isMakeup?: boolean;
};

type AttState = {
  top: TopStatus;
  sub: string | null; // "rain"|"coach" for cancelled; "paid"|"free" for trial
};

// `existingId` used to live here, carrying the attendance row's primary key so
// the save could "update in place". It never did that — onConflict on
// (lesson_session_id, student_id) is what matches an existing row — and sending
// the PK is what broke every partially-marked lesson (§7.67). Removed rather
// than left unused, so nothing puts `id` back in the payload.

function toDBStatus(top: TopStatus, sub: string | null): DBStatus | null {
  if (top === "unmarked") return null;
  if (top === "present") return "present";
  if (top === "absent") return "absent";
  if (top === "cancelled" && sub === "rain") return "cancelled_rain";
  if (top === "cancelled" && sub === "coach") return "cancelled_coach";
  if (top === "trial" && sub === "paid") return "trial_paid";
  if (top === "trial" && sub === "free") return "trial_free";
  return null;
}

function fromDBStatus(status: DBStatus): { top: TopStatus; sub: string | null } {
  switch (status) {
    case "present":         return { top: "present",   sub: null };
    case "absent":          return { top: "absent",    sub: null };
    case "cancelled_rain":  return { top: "cancelled", sub: "rain" };
    case "cancelled_coach": return { top: "cancelled", sub: "coach" };
    case "trial_paid":      return { top: "trial",     sub: "paid" };
    case "trial_free":      return { top: "trial",     sub: "free" };
    case "holiday":         return { top: "holiday",   sub: null };
  }
}

function formatDate(dateStr: string): string {
  return formatSgStamp(dateStr, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const TOP_STATUSES: {
  key: TopStatus;
  label: string;
  ring: string;
  bg: string;
}[] = [
  { key: "present",   label: "Present",   ring: "border-green-500",  bg: "bg-green-500"  },
  { key: "absent",    label: "Absent",    ring: "border-gray-400",   bg: "bg-gray-400"   },
  { key: "cancelled", label: "Cancelled", ring: "border-orange-500", bg: "bg-orange-500" },
  { key: "trial",     label: "Trial",     ring: "border-blue-500",   bg: "bg-blue-500"   },
];

export default function MarkAttendanceScreen() {
  const { id } = useLocalSearchParams<{
    id: string;
    date: string;
  }>();
  // ⚠ THERE IS DELIBERATELY NO `sessionId` PARAM ANY MORE. This screen used to
  // accept one from the URL and trust it, without checking that it belonged to
  // this class or to the date on screen. Supplying a real session id satisfied
  // the "this session already exists" branch, which SKIPS the weekday check —
  // so the screen rendered a markable roster for a date it should have refused.
  // Never a billing hole (records attach to the session that id names, and the
  // database guard reads that session's OWN date, so every write stayed inside
  // the window), but the header could show a date the records did not belong
  // to. The session is now always resolved from `(class_id, date)`, which is
  // UNIQUE — `lesson_sessions` carries `ON CONFLICT (class_id, session_date)`
  // (20260727000100) — so the lookup cannot disagree with what a caller would
  // have passed, and there is nothing left to trust.
  const { date, from } = useLocalSearchParams<{
    date: string;
    from?: string;
  }>();

  // ── WHERE DOES LEAVING THIS SCREEN GO? (§7.65) ──────────────────────────
  // Not `router.back()`, which trusts whatever happens to be underneath — and
  // what is underneath is frequently ANOTHER LESSON'S attendance screen.
  //
  // This screen lives in the CLASSES tab's Stack (classes/_layout.tsx) but is
  // pushed from the SCHEDULE tab as well. Switching tabs does not unwind the
  // Classes stack, it only hides it, so the stack accumulates:
  //
  //   Schedule → tap 845am card    [classes-index, att(845, 26 Jul)]
  //   back chevron → Schedule      [classes-index, att(845, 26 Jul)]  ← kept
  //   Schedule → tap 930am card    [classes-index, att(845,26), att(930,26)]
  //   Save → router.back()         → lands on att(845, 26 Jul)
  //
  // Which is what the coach reported: saving the 9:30 class returned them to
  // the 8:45 one, and the URL still carried the 8:45 session id.
  //
  // So the caller says where it came from and we go there EXPLICITLY, with
  // `replace` rather than `push` — that also drops this screen out of the
  // history, so nothing can pop back into a lesson the coach has finished.
  //
  // ⚠ THE DEFAULT ARM IS THE SAFETY NET — KEEP IT AS `from === "roster" ? … : …`
  // rather than switching on "schedule". A stale `from=today` (a bookmark, a
  // driver nobody updated) then still lands on a real screen instead of
  // nowhere. Narrowing it to an exact match buys nothing and can only break.
  const exitHref =
    from === "roster" ? `/(coach)/classes/${id}/roster` : "/(coach)/schedule";

  function leaveScreen() {
    router.replace(exitHref as any);
  }

  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);

  const [classTitle, setClassTitle] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttState>>({});
  // Statuses as the roster loaded them, keyed by student. A ref, not state: nothing
  // renders from it, and it must not trigger a re-render when the roster reloads.
  const loadedStatuses = useRef<Record<string, DBStatus | null>>({});
  // A session id is never held on its own — always with the date it belongs
  // to. See lib/attendanceSession.ts for what that prevents.
  const [resolved, setResolved] = useState<ResolvedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Non-null when this date may not be marked. The database refuses it anyway;
  // this is so the coach is told why, before filling in a roster that cannot
  // be saved.
  const [blocked, setBlocked] = useState<MarkableCheck | null>(null);
  // Who is teaching THIS lesson, from this coach's point of view. `owner` until
  // the load says otherwise, which is the absence rule: no roster row means the
  // class's own coach. A trainee shadowing, or a coach whose lesson somebody
  // else was rostered to cover, gets the roster READ-ONLY — `attendance_write`
  // is `coach_is_main_on_session()` since 20260811000200, so the alternative is
  // a screen that invites work the database will refuse.
  /** The class's ACTIVE shadows for this lesson, and whether each was here.
   *  Pre-ticked: the normal case is that the assigned trainee turned up, and a
   *  forgotten tick must not silently cost them a lesson's pay. */
  const [shadowsHere, setShadowsHere] = useState<
    { coach_id: string; name: string; present: boolean }[]
  >([]);
  const [role, setRole] = useState<LessonRole>("owner");
  // Which load() is the current one. Switching lessons quickly can leave an
  // earlier fetch in flight; without this it lands last and repopulates the
  // screen with the lesson the coach navigated AWAY from.
  const loadToken = useRef(0);

  // ⚠ THESE DEPS ARE LOAD-BEARING — this was `[]`, and it wrote attendance to
  // the wrong day (§7.64). One route serves every lesson, distinguished only
  // by `?date=`, and Expo Router reuses the mounted screen when a search param
  // changes. A mount-only effect therefore never reloads, so the header showed
  // the new lesson over the previous lesson's roster and session id.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, date]);

  async function load() {
    const token = ++loadToken.current;
    setLoading(true);

    // Clear everything the PREVIOUS lesson put here before fetching. Leaving
    // it in place is what let a stale roster be displayed, filled in and
    // saved; `resolved` going null is also what holds the spinner up (below)
    // until this date's data has actually arrived.
    setResolved(null);
    setBlocked(null);
    setStudents([]);
    setAttendance({});
    setRole("owner");

    // Load class title + the students enrolled ON THIS DATE. `coach_id` rides
    // along because "is this my class?" is half of the roster question below,
    // and the coach record answers the other half — both fetched together so
    // the screen does not gain a round trip in front of everything else.
    const [{ data: cls }, { data: me }] = await Promise.all([
      supabase
        .from("classes")
        .select(`
        title,
        day_of_week,
        coach_id,
        student_class_enrolments(
          is_active,
          enrolled_at,
          unenrolled_at,
          students(id, full_name)
        )
      `)
        .eq("id", id)
        .single(),
      session?.id
        ? supabase
            .from("coaches")
            .select("id")
            .eq("profile_id", session.id)
            .maybeSingle()
        : Promise.resolve({ data: null as { id: string } | null }),
    ]);

    if (token !== loadToken.current) return;

    if (!cls) {
      // Not reachable from ordinary navigation, but an RLS denial looks like
      // this. Say so rather than leaving the spinner up forever — the render
      // guard below now keys off `resolved`, which this path never sets.
      setBlocked({
        ok: false,
        title: "That class could not be loaded",
        detail: "Go back and try again, or ask your admin to check the class.",
      });
      setResolved({ date, sessionId: null });
      setLoading(false);
      return;
    }

    setClassTitle(cls.title);

    // ── THE ROSTER FOR A DATE IS THE ROSTER AS IT WAS ON THAT DATE ──────────
    // This used to filter on `is_active` alone, with no reference to `date` at
    // all — so opening any past lesson showed TODAY'S roster. A child who
    // joined last month appeared on a lesson from before they existed here,
    // and because the save refuses until every student on screen has a status,
    // the coach was FORCED to record attendance for a child who was not there.
    //
    // Both ends inclusive, matching EnrolmentSpan: a trial walk-in's enrolment
    // opens and closes on its own date, and an exclusive end would drop them
    // from the very screen that is marking them.
    const enrolledOnDate: StudentRow[] = (cls.student_class_enrolments ?? [])
      .filter((e: any) => {
        const from = toSgDate(e.enrolled_at);
        const until = e.unenrolled_at ? toSgDate(e.unenrolled_at) : null;
        return from <= date && (until === null || date <= until);
      })
      .map((e: any) => ({
        id: e.students.id,
        full_name: e.students.full_name,
      }));

    // The business's marking floor, STARTED here so it overlaps the session
    // lookup below rather than delaying the screen by a round trip. Awaited at
    // the check. fetchMarkableFloor resolves on every path and never rejects,
    // so leaving it in flight cannot become an unhandled rejection.
    const markableFloorPromise = fetchMarkableFloor();

    // Resolve the session from (class_id, date) — or leave null, which means
    // "create it on save". Never from a URL param; see the note on the params
    // above. The pair is unique, so this is the only answer there is.
    const { data: existingSession } = await supabase
      .from("lesson_sessions")
      .select("id, cancelled_at, cancellation_reason")
      .eq("class_id", id)
      .eq("session_date", date)
      .maybeSingle();
    const sid: string | null = existingSession?.id ?? null;

    if (token !== loadToken.current) return;

    // A lesson the admin CANCELLED in advance takes no marks. Said here, in the
    // same place a closed date is refused — and this is the cosmetic half: the
    // database trigger (guard_attendance_date, 20260821000700) refuses the
    // write whatever this screen shows, so a stale screen cannot mark it.
    if (existingSession?.cancelled_at) {
      const reason = (existingSession as any).cancellation_reason as string | null;
      setBlocked({
        ok: false,
        title: "This lesson was cancelled",
        detail: `Your business's admin cancelled ${classTitle || "this lesson"} on ${formatDate(date)}${
          reason ? ` — ${reason}` : ""
        }. Nothing is marked for a cancelled lesson; if it is going ahead after all, ask them to restore it.`,
      });
      setLoading(false);
      return;
    }

    // Stamped with the date it was resolved FOR, so nothing downstream can
    // mistake it for this screen's current lesson after a param change.
    setResolved({ date, sessionId: sid });

    // ── WHOSE LESSON IS THIS? ──────────────────────────────────────────────
    // Two facts, and neither substitutes for the other:
    //
    //   · MY row on the roster, if any. `session_coaches_select` returns a
    //     coach only their own rows, so this is the only way to learn that I am
    //     a SHADOW rather than the main coach.
    //   · `coach_is_main_on_session()` — definer rights, so it can see the row
    //     naming somebody ELSE that RLS hides from me. It is the same predicate
    //     `attendance_write` enforces, which is why asking it here cannot
    //     disagree with what the save will do.
    //
    // An assignment creates the session row (`assign_session_coach()`), so no
    // row means no roster, which by the absence rule means the class's coach.
    // ⚠ AND IF THE COACH RECORD DID NOT COME BACK, ASSUME THE CLASS IS MINE.
    // Not knowing who I am is not evidence that somebody else is teaching. The
    // other direction turns one failed lookup into a silently read-only screen
    // for the coach who owns the class — a lesson that never gets marked, and
    // the billing month blocks with no override (§8i). This way the roster is
    // offered, and the database refuses the write LOUDLY if it really is not
    // mine. The shadow branch and the gate below still narrow it.
    const ownsClass = !me?.id || cls.coach_id === me.id;
    const [{ data: myRosterRow }, { data: amClassShadow }, isMain] =
      await Promise.all([
        sid
          ? supabase
              .from("session_coaches")
              .select("coach_id")
              .eq("lesson_session_id", sid)
              .maybeSingle()
          : Promise.resolve({ data: null as { coach_id: string } | null }),
        // ⚠ AN RPC, NOT A FILTERED TABLE READ, AND `me` IS THE REASON.
        // A client-side `coach_id = me.id` filter is null-unsafe here: `me` is
        // resolved from a session that is NOT hydrated when this screen is
        // deep-linked, so the filter matches nothing and the coach silently
        // resolves to "covered" — measured, and it cost this screen a real
        // failure (§7.141). coach_is_active_class_shadow() reads
        // current_coach_id() server-side, which cannot be absent, and is also
        // admin-proof in a way `select *` on the table is not.
        supabase.rpc("coach_is_active_class_shadow", { p_class_id: id }),
        // With no session row there is nothing to ask about.
        sid ? fetchIsMainOnSession(sid) : Promise.resolve(ownsClass),
      ]);

    if (token !== loadToken.current) return;

    const lessonIsMine = lessonRole({
      ownsClass,
      isSubstitute: Boolean(myRosterRow) && !ownsClass,
      isClassShadow: amClassShadow === true,
      coveredOut: !isMain,
    });
    setRole(lessonIsMine);

    // ── Who is shadowing this lesson, for the coach who marks it ───────────
    // Only fetched for the coach who can actually record it. A shadow reading
    // their own screen has no business ticking anybody, and `canMark` is the
    // same predicate the write policy uses.
    // ⚠ ONE RPC, AND IT RETURNS THE ABSENCES WITH THE NAMES. Reading
    // class_shadow_coaches directly returns NOTHING for a substitute: the
    // policy is `admin OR coach_id = current_coach_id()`, so the one person who
    // must tick these boxes is the one person who cannot see them. The RPC is
    // gated on coach_is_main_on_session — the SAME predicate as the write — so
    // the list and the save can never disagree about who may act.
    //
    // Its date range is the LESSON's, not today's: a shadow assigned tomorrow
    // must not appear on last week's lesson.
    if (canMark(lessonIsMine)) {
      // (class, date) — NOT the session id. The lesson_sessions row is created
      // lazily by the very save this list feeds, so a session-keyed call returns
      // nothing on the one visit that matters.
      const { data: shadowRoster } = await supabase.rpc(
        "session_shadow_coaches",
        { p_class_id: id, p_session_date: date }
      );

      if (token !== loadToken.current) return;

      setShadowsHere(
        (shadowRoster ?? []).map((r: any) => ({
          coach_id: r.coach_id,
          name: r.full_name ?? "Unknown coach",
          present: !r.absent,
        }))
      );
    } else {
      setShadowsHere([]);
    }

    // ── Is this date markable at all? ──────────────────────────────────────
    // Checked AFTER the session lookup, because an existing session is itself
    // the authorisation: an off-schedule lesson the admin scheduled is not on
    // the class's weekday and must still be markable.
    //
    // windowFloor is awaited rather than passed as a promise so the check never
    // runs against a floor that has not resolved. A null answer is the calendar
    // rule, which the database enforced before 20260806000200 and still accepts.
    const check = checkMarkableDate({
      date,
      today: todayInSg(),
      classDayOfWeek: cls.day_of_week as DayOfWeek,
      classTitle: cls.title,
      sessionExists: sid !== null,
      windowFloor: await markableFloorPromise,
    });
    if (!check.ok) {
      setBlocked(check);
      setLoading(false);
      return;
    }
    setBlocked(null);

    // Attendance is fetched BEFORE the roster is set, because it partly
    // DEFINES the roster: a trial walk-in's enrolment closes on its own date,
    // so they are not actively enrolled and would otherwise disappear from the
    // screen that just marked them. See lib/attendanceRoster.ts.
    const { data: attData } = sid
      ? await supabase
          .from("attendance")
          .select("id, student_id, status, students(id, full_name)")
          .eq("lesson_session_id", sid)
      : { data: [] as any[] };

    // Children booked for a TRIAL on this date. They are not enrolled — a trial
    // is a visit, not a standing arrangement — so without this they would never
    // appear, never be marked, and the billing month could never close.
    const { data: booked } = await supabase
      .from("trial_bookings")
      .select("student_id, students(id, full_name)")
      .eq("class_id", id)
      .eq("session_date", date)
      .is("cancelled_at", null);

    // And children booked for a MAKE-UP: enrolled elsewhere, guesting into
    // this one lesson. Same mechanism, same stakes — an unmarked make-up
    // holds the billing month open.
    const { data: makeupBooked } = await supabase
      .from("makeup_bookings")
      .select("student_id, students(id, full_name)")
      .eq("class_id", id)
      .eq("session_date", date)
      .is("cancelled_at", null);

    if (token !== loadToken.current) return;

    const roster = mergeRoster(
      enrolledOnDate,
      (attData ?? [])
        .map((a: any) => a.students)
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, full_name: s.full_name })),
      (booked ?? [])
        .map((b: any) => b.students)
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, full_name: s.full_name })),
      (makeupBooked ?? [])
        .map((b: any) => b.students)
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, full_name: s.full_name }))
    );

    setStudents(roster);

    // Pre-fill attendance from existing records (or default to present)
    const initAtt: Record<string, AttState> = {};
    if (sid) {
      for (const student of roster) {
        const existing = (attData ?? []).find(
          (a: any) => a.student_id === student.id
        );
        if (existing) {
          const parsed = fromDBStatus(existing.status as DBStatus);
          initAtt[student.id] = {
            top: parsed.top,
            sub: parsed.sub,
          };
        } else {
          initAtt[student.id] = { top: "unmarked", sub: null };
        }
      }
    } else {
      for (const student of roster) {
        initAtt[student.id] = { top: "unmarked", sub: null };
      }
    }

    setAttendance(initAtt);
    // The statuses AS LOADED, for the credit-note-email check in handleSave. A note
    // can only be issued when a lesson LEAVES a billable status, so this is what lets
    // the common save skip the edge-function round trip entirely.
    loadedStatuses.current = Object.fromEntries(
      Object.entries(initAtt).map(([id, st]) => [id, toDBStatus(st.top, st.sub)])
    );
    setLoading(false);
  }

  function setTop(studentId: string, top: TopStatus) {
    setAttendance((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], top, sub: null },
    }));
  }

  function setSub(studentId: string, sub: string) {
    setAttendance((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], sub },
    }));
  }

  function onSetAll(opt: BulkOption) {
    setMenuOpen(false);
    const apply = () => {
      setAttendance((prev) =>
        applyBulkStatus(
          // Never re-mark a holiday row — the guard refuses a coach clearing one,
          // and a single refused row fails the whole batch save (§7.67).
          students.filter((s) => prev[s.id]?.top !== "holiday").map((s) => s.id),
          prev,
          { top: opt.top, sub: opt.sub }
        )
      );
      showToast(`All ${students.length} set to ${opt.label}.`, "info");
    };
    const anyMarked = students.some(
      (s) => (attendance[s.id]?.top ?? "unmarked") !== "unmarked"
    );
    if (anyMarked) {
      confirmAction(
        `Set all to ${opt.label}?`,
        `This will change all ${students.length} students to ${opt.label}.`,
        apply,
        "Set all"
      );
    } else {
      apply();
    }
  }

  async function handleSave() {
    // Validate all statuses are complete
    for (const student of students) {
      const state = attendance[student.id];
      // A holiday row is admin-owned and read-only here — it needs no marking and
      // is left out of the save payload below, so don't demand a status for it.
      if (state?.top === "holiday") continue;
      if (!state || state.top === "unmarked") {
        showToast(`Please mark attendance for ${student.full_name}.`, "error");
        return;
      }
      if (toDBStatus(state.top, state.sub) === null) {
        showToast(
          `Please select a sub-type for ${student.full_name}.`,
          "error"
        );
        return;
      }
    }

    setSaving(true);

    // Get coach record
    const { data: coach } = await supabase
      .from("coaches")
      .select("id")
      .eq("profile_id", session!.id)
      .single();

    if (!coach) {
      showToast("Could not find coach record.", "error");
      setSaving(false);
      return;
    }

    // ── WHICH LESSON AM I WRITING TO? ──────────────────────────────────────
    // Never the bare id this screen happens to be holding. It is only usable
    // if it was resolved for the date now on screen; anything else is treated
    // as unknown and re-resolved from (class_id, date) — the pair that
    // uniquely identifies a lesson. This is the layer that would have caught
    // §7.64 even with the mount-only effect still in place.
    const decision = resolveSessionForDate(resolved, date);
    let finalSessionId =
      decision.kind === "use" ? decision.sessionId : null;

    if (decision.kind === "stale") {
      const { data: existingSession } = await supabase
        .from("lesson_sessions")
        .select("id")
        .eq("class_id", id)
        .eq("session_date", date)
        .maybeSingle();
      finalSessionId = existingSession?.id ?? null;
    }

    if (!finalSessionId) {
      const { data: newSession, error: sessionError } = await supabase
        .from("lesson_sessions")
        .insert({ class_id: id, session_date: date, status: "scheduled" })
        .select("id")
        .single();

      if (sessionError || !newSession) {
        showToast("Could not create session record.", "error");
        setSaving(false);
        return;
      }

      finalSessionId = newSession.id;
    }

    // A real guard rather than `!`: everything below writes attendance against
    // this id, and a null here would be the §7.64 class of mistake again.
    if (!finalSessionId) {
      showToast("Could not create session record.", "error");
      setSaving(false);
      return;
    }

    setResolved({ date, sessionId: finalSessionId });

    // Built in lib/attendancePayload.ts, NOT inline — every row has to carry
    // the same keys or PostgREST inserts NULL for the ones a row omits (§7.67).
    // That is what made a partially-marked lesson permanently unsaveable.
    const rows = buildAttendanceRows(
      finalSessionId,
      session!.id,
      students
        // EXCLUDE holiday rows: the DB guard refuses a coach writing 'holiday', and
        // one refused row rolls back the whole batch upsert (§7.67). Leaving them
        // out of the payload keeps the admin's void untouched by a coach save.
        .filter((student) => attendance[student.id].top !== "holiday")
        .map((student) => ({
          studentId: student.id,
          status: toDBStatus(
            attendance[student.id].top,
            attendance[student.id].sub
          )!,
        }))
    );

    const { error: upsertError } = await supabase
      .from("attendance")
      .upsert(rows, { onConflict: "lesson_session_id,student_id" });

    if (upsertError) {
      // ⚠ CN001 — the credit-note trigger REFUSED to un-correct a lesson whose
      // credit is already applied (20260818000100). One row in a batch upsert, so
      // the whole roster rolled back — attendanceSaveErrorMessage says so.
      showToast(
        attendanceSaveErrorMessage((upsertError as { code?: string }).code),
        "error"
      );
      setSaving(false);
      return;
    }

    // ── Coaches present ───────────────────────────────────────────────────
    // ⚠ AFTER THE ATTENDANCE UPSERT, AND ON finalSessionId. The lesson_sessions
    // row is created LAZILY above, so an absence written before it has no lesson
    // to reference.
    //
    // ⚠ A ROW MEANS ABSENT. No row means the shadow was here and is paid, which
    // is why a FAILED write here is survivable: it leaves them PAID, the
    // recoverable direction. Inverting this to a presence record would trade
    // that for a silent underpayment (migration §2).
    //
    // Alert.alert is a no-op on RN-web, so the failure is a Toast.
    if (shadowsHere.length > 0) {
      const absent = shadowsHere.filter((sh) => !sh.present);
      const present = shadowsHere.filter((sh) => sh.present);

      const [delRes, insRes] = await Promise.all([
        present.length > 0
          ? supabase
              .from("session_coach_absences")
              .delete()
              .eq("lesson_session_id", finalSessionId)
              .in("coach_id", present.map((sh) => sh.coach_id))
          : Promise.resolve({ error: null }),
        absent.length > 0
          ? supabase.from("session_coach_absences").upsert(
              absent.map((sh) => ({
                lesson_session_id: finalSessionId,
                coach_id: sh.coach_id,
                // Stamped by the trigger; the value sent is never trusted.
                tenant_id: "00000000-0000-0000-0000-000000000000",
                marked_by: session!.id,
              })),
              { onConflict: "lesson_session_id,coach_id" }
            )
          : Promise.resolve({ error: null }),
      ]);

      if (delRes.error || insRes.error) {
        // Named, not swallowed: the month may be settled, in which case the
        // seal refused this deliberately and the attendance above still saved.
        showToast(
          `Attendance saved, but the coaches-present list did not: ${
            (delRes.error ?? insRes.error)?.message ?? "unknown error"
          }`,
          "error"
        );
      }
    }

    // Audit log
    await supabase.from("audit_log").insert({
      actor_id: session!.id,
      action: "attendance_saved",
      entity_type: "lesson_session",
      entity_id: finalSessionId,
      new_value: {
        class_id: id,
        date,
        student_count: students.length,
      },
    });

    // ⚠ RISK 9 (CREDIT_NOTE_EMAIL_PLAN.md) — BEFORE setSaving(false), and before
    // leaveScreen(). If this attendance edit flipped an already-invoiced lesson from
    // billable to non-billable, the handle_attendance_update trigger has just issued
    // a credit note, and the parent has no idea until they open the app.
    //
    // AWAITED ON PURPOSE, bounded to 3s. leaveScreen() below is a router.replace
    // that unmounts this screen, so an unawaited request is issued milliseconds
    // before its own destruction — and a coach who locks the phone kills it. Held
    // here, the existing save spinner covers the wait; the attendance rows are
    // already committed above, so this can only delay the toast, never the save.
    // Silent on failure by decision: the admin's Credit Notes page has the Resend
    // button, and a failed email is not something the coach can act on (§8.27).
    //
    // GUARDED so the COMMON save pays nothing. A credit note can only arise when a
    // lesson LEAVES 'present'/'trial_paid'; every other save — the normal one — would
    // otherwise wait on an edge-function cold start plus five queries to be told there
    // was nothing to do. The server stays authoritative; this only skips the call when
    // a note is impossible.
    const savedStatuses = Object.fromEntries(
      rows.map((r) => [r.student_id, r.status as string | null])
    );
    if (mayHaveIssuedCreditNote(loadedStatuses.current, savedStatuses)) {
      await notifyCreditNoteEmails(supabase, finalSessionId);
    }

    setSaving(false);
    showToast("Attendance saved.", "success");
    leaveScreen();
  }

  // The spinner also covers the gap between a param change and the reload
  // landing. The effect runs after paint, so without `isShowingDate` there is
  // a frame where the header names the new lesson above the previous one's
  // roster — and a tap is faster than a frame is long.
  if (loading || !isShowingDate(resolved, date)) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50 items-center justify-center">
        <ActivityIndicator size="large" color="#0ea5e9" />
      </SafeAreaView>
    );
  }

  // This date cannot be marked. Shown INSTEAD of the roster rather than as a
  // toast over it: a roster the coach can fill in but never save is worse than
  // no roster, and the reason belongs where the work would have happened.
  if (blocked && !blocked.ok) {
    return (
      <SafeAreaView className="flex-1 bg-sky-50">
        <View className="flex-row items-center px-5 pt-4 pb-3">
          <TouchableOpacity onPress={() => leaveScreen()} className="mr-3">
            <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-lg font-bold text-gray-900">
              Mark Attendance
            </Text>
            <Text className="text-xs text-gray-500">
              {classTitle} · {formatDate(date)}
            </Text>
          </View>
        </View>

        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="lock-closed-outline" size={44} color="#cbd5e1" />
          <Text className="text-base font-bold text-gray-900 mt-3 text-center">
            {blocked.title}
          </Text>
          <Text className="text-sm text-gray-500 mt-2 text-center leading-5">
            {blocked.detail}
          </Text>
          <TouchableOpacity
            onPress={() => leaveScreen()}
            className="mt-6 px-5 py-3 rounded-xl bg-sky-500"
          >
            <Text className="text-white font-semibold">Back to class</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // A lesson I am shadowing, or one another coach was rostered to cover, is
  // READ-ONLY here — the database refuses my write either way. The roster still
  // renders: a trainee is on the poolside to learn who is expected, and a coach
  // whose lesson was covered is entitled to see what happened in their class.
  const readOnly = !canMark(role);
  const notice = roleNotice(role);

  return (
    <SafeAreaView className="flex-1 bg-sky-50">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3">
        <TouchableOpacity onPress={() => leaveScreen()} className="mr-3">
          <Ionicons name="chevron-back" size={24} color="#0ea5e9" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">
            {readOnly ? "Lesson Attendance" : "Mark Attendance"}
          </Text>
          <Text className="text-xs text-gray-500">
            {classTitle} · {formatDate(date)}
          </Text>
        </View>
        {students.length > 0 && !readOnly && (
          <TouchableOpacity
            onPress={() => setMenuOpen((v) => !v)}
            className="flex-row items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5"
          >
            <Text className="text-xs font-semibold text-sky-600">Set all</Text>
            <Ionicons
              name={menuOpen ? "chevron-up" : "chevron-down"}
              size={14}
              color="#0ea5e9"
            />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10 gap-3"
        showsVerticalScrollIndicator={false}
      >
        {notice ? (
          // Said where the work would have happened, exactly like `blocked`
          // above — and unlike `blocked` the roster still follows it, because
          // seeing who is expected is the whole reason a shadow is here.
          <View className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <View className="flex-row items-center gap-2">
              <Ionicons name="eye-outline" size={16} color="#6d28d9" />
              <Text className="text-sm font-bold text-violet-900">
                {notice.title}
              </Text>
            </View>
            <Text className="text-xs text-violet-800 mt-1 leading-5">
              {notice.detail}
            </Text>
          </View>
        ) : (
          <Text className="text-sm text-gray-500 mb-1">
            Tap a status for each student
          </Text>
        )}

        {students.length === 0 ? (
          <View className="bg-white rounded-2xl p-6 items-center border border-gray-100">
            <Text className="text-gray-400 text-sm">No students enrolled</Text>
          </View>
        ) : (
          students.map((student) => {
            const state = attendance[student.id] ?? {
              top: "unmarked",
              sub: null,
            };
            return (
              <View
                key={student.id}
                className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
              >
                {/* Student name */}
                <View className="flex-row items-center gap-3 mb-3">
                  <View className="w-9 h-9 rounded-full bg-sky-100 items-center justify-center">
                    <Text className="text-sky-600 font-bold text-sm">
                      {student.full_name.charAt(0)}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-gray-800">
                    {student.full_name}
                  </Text>
                  {student.attendedOnly && (
                    // Not a weekly regular — say which kind. A TRIAL is
                    // someone the coach is meeting for the first time and the
                    // status they pick decides what the family is charged; a
                    // MAKE-UP is an enrolled child guesting from another class
                    // for this one lesson.
                    <View
                      className={`px-2 py-0.5 rounded-full ${
                        student.isTrial
                          ? "bg-sky-100"
                          : student.isMakeup
                            ? "bg-emerald-100"
                            : "bg-amber-100"
                      }`}
                    >
                      <Text
                        className={`text-[10px] font-semibold ${
                          student.isTrial
                            ? "text-sky-700"
                            : student.isMakeup
                              ? "text-emerald-700"
                              : "text-amber-700"
                        }`}
                      >
                        {student.isTrial
                          ? "Trial"
                          : student.isMakeup
                            ? "Make-up"
                            : "Not enrolled"}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Unmarked indicator */}
                {state.top === "unmarked" && (
                  <View className="flex-row items-center gap-1.5 mb-2">
                    <View className="w-2 h-2 rounded-full bg-gray-300" />
                    <Text className="text-xs text-gray-400 font-medium">
                      Not yet marked
                    </Text>
                  </View>
                )}

                {/* Public-holiday void — read-only. Set by the admin; a coach
                    cannot change it (the DB guard refuses), so no buttons show. */}
                {state.top === "holiday" && (
                  <View className="flex-row items-center gap-1.5 mb-1">
                    <View className="w-2 h-2 rounded-full bg-purple-400" />
                    <Text className="text-xs text-purple-500 font-medium">
                      Public holiday — no charge
                    </Text>
                  </View>
                )}

                {/* Top-level status buttons. A make-up guest gets the ordinary
                    statuses only: the trial statuses price by the trial rate,
                    and a make-up is not a trial. Affordance, not the guard —
                    the engine prices a mismark at the class rate. Hidden for a
                    holiday row, which is read-only. */}
                {state.top !== "holiday" && (
                <View className="flex-row gap-2">
                  {TOP_STATUSES.filter(
                    ({ key }) => !(student.isMakeup && key === "trial")
                  ).map(({ key, label, ring, bg }) => {
                    const isSelected = state.top === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        disabled={readOnly}
                        onPress={() => setTop(student.id, key)}
                        className={`flex-1 py-2 rounded-xl border-2 items-center ${
                          isSelected
                            ? `${ring} ${bg}`
                            : "border-gray-200 bg-gray-50"
                        } ${readOnly && !isSelected ? "opacity-50" : ""}`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            isSelected ? "text-white" : "text-gray-500"
                          }`}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                )}

                {/* Cancelled sub-type */}
                {state.top === "cancelled" && (
                  <View className="mt-3 flex-row gap-2 items-center">
                    <Text className="text-xs text-gray-500 mr-1">Reason:</Text>
                    {[
                      { key: "rain", label: "Rain" },
                      { key: "coach", label: "Coach" },
                    ].map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        disabled={readOnly}
                        onPress={() => setSub(student.id, key)}
                        className={`px-4 py-1.5 rounded-full border ${
                          state.sub === key
                            ? "bg-orange-500 border-orange-500"
                            : "bg-white border-gray-300"
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            state.sub === key ? "text-white" : "text-gray-600"
                          }`}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Trial sub-type */}
                {state.top === "trial" && (
                  <View className="mt-3 flex-row gap-2 items-center">
                    <Text className="text-xs text-gray-500 mr-1">Trial type:</Text>
                    {[
                      { key: "paid", label: "Paid" },
                      { key: "free", label: "Free" },
                    ].map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        disabled={readOnly}
                        onPress={() => setSub(student.id, key)}
                        className={`px-4 py-1.5 rounded-full border ${
                          state.sub === key
                            ? "bg-blue-500 border-blue-500"
                            : "bg-white border-gray-300"
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            state.sub === key ? "text-white" : "text-gray-600"
                          }`}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}

        {/* ── Coaches present ────────────────────────────────────────────
            Renders NOTHING when the class has no shadows, so a business that
            has never assigned one gains no new furniture on its screens.

            Pre-ticked on purpose. The failure mode of a blank list is a coach
            who forgets and silently costs a trainee their pay, which appears
            nowhere; the failure mode of a pre-ticked one is an overpayment,
            which appears as a line on the Wages page and can be seen. */}
        {!readOnly && shadowsHere.length > 0 && (
          <View className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
            <Text className="text-sm font-semibold text-gray-900">
              Coaches present
            </Text>
            <Text className="mt-0.5 text-xs text-gray-500">
              Untick anyone who wasn&apos;t here — they won&apos;t be paid for
              this lesson.
            </Text>
            {shadowsHere.map((sh) => (
              <TouchableOpacity
                key={sh.coach_id}
                onPress={() =>
                  setShadowsHere((prev) =>
                    prev.map((x) =>
                      x.coach_id === sh.coach_id
                        ? { ...x, present: !x.present }
                        : x
                    )
                  )
                }
                className="mt-3 flex-row items-center"
              >
                <View
                  className={`h-5 w-5 items-center justify-center rounded border ${
                    sh.present
                      ? "bg-blue-500 border-blue-500"
                      : "bg-white border-gray-300"
                  }`}
                >
                  {sh.present && (
                    <Text className="text-xs font-bold text-white">✓</Text>
                  )}
                </View>
                {/* ⚠ THE NAME IS ITS OWN LEAF <Text>, DIRECTLY INSIDE THE
                    TOUCHABLE. RN-web puts the press handler on the Pressable and
                    a click on a nested Text child is swallowed silently — the
                    same trap every marking driver in this repo works around. A
                    name wrapped in an outer Text with a sibling span is not a
                    leaf at all, so it cannot be pressed by text and the tick
                    becomes untestable. */}
                <Text
                  className={`ml-2.5 text-sm ${
                    sh.present ? "text-gray-900" : "text-gray-400"
                  }`}
                >
                  {sh.name}
                </Text>
                <Text className="ml-1 text-xs text-gray-400">· shadowing</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* No save button at all when the lesson is not mine to mark. A
            disabled one would still read as "this is my job, and it is
            broken"; its absence plus the notice above says whose job it is. */}
        {!readOnly && (
          <PrimaryButton
            label={saving ? "Saving…" : "Save Attendance"}
            onPress={handleSave}
            className="mt-2"
          />
        )}
      </ScrollView>

      {/* Set-all dropdown (rendered last so it stacks above the list) */}
      {menuOpen && (
        <>
          <Pressable
            onPress={() => setMenuOpen(false)}
            className="absolute left-0 right-0 top-0 bottom-0 z-40"
          />
          <View className="absolute right-5 top-14 z-50 w-52 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
            {SET_ALL_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => onSetAll(opt)}
                className={`flex-row items-center gap-2.5 px-4 py-3 ${
                  i > 0 ? "border-t border-gray-100" : ""
                }`}
              >
                <View className={`h-2.5 w-2.5 rounded-full ${opt.dot}`} />
                <Text className="text-sm text-gray-800">{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
