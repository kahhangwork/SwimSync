// The marking screen's spine (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 3): the state
// load() fills, both refs, and load() itself — moved verbatim from
// app/(coach)/classes/[id]/attendance.tsx, network calls bound in dao/.
//
// ⚠ load is returned as a PLAIN FUNCTION, recreated every render, exactly as it was on
// the route: the route's [id, date] effect calls it (§7.64 — those deps are
// load-bearing and stay on the route, byte-identical). NO useCallback: the save hooks
// read render-time state. (The cancelled notice once read the `classTitle` state
// from this closure — the previous render's value; it takes cls.title now.) ⚠ This hook never calls useLocalSearchParams — the route reads
// the params once and passes the same `id`/`date` everywhere (§7.64's header/roster
// split re-enters through a second read).
import { useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { mergeRoster } from "@/lib/attendanceRoster";
import { checkMarkableDate, type MarkableCheck } from "@/lib/attendanceWindow";
import type { ResolvedSession } from "@/lib/attendanceSession";
import { todayInSg, type DayOfWeek } from "@/lib/lessonDates";
import { lessonRole, canMark, type LessonRole } from "@/lib/coachRoster";
import type { AttState, DBStatus, StudentRow } from "../types";
import {
  cancelledBlock,
  enrolledOn,
  guestRows,
  initialAttendance,
  loadedStatusesOf,
  shadowRows,
} from "./attendanceRows";
import {
  loadAttendance,
  loadClass,
  loadMakeupBookings,
  loadMyCoach,
  loadMyRosterRow,
  loadSession,
  loadTrialBookings,
} from "../dao/markAttendance.repo";
import {
  fetchFloor,
  isActiveClassShadow,
  isMainOnSession,
  sessionShadowCoaches,
} from "../dao/markAttendance.rpc";

export function useAttendanceLoad(id: string, date: string) {
  const session = useAppStore((s) => s.session);

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
      loadClass(id),
      session?.id
        ? loadMyCoach(session.id)
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

    // The roster AS IT WAS ON THIS DATE, both ends inclusive — see enrolledOn.
    const enrolledOnDate: StudentRow[] = enrolledOn(cls.student_class_enrolments, date);

    // The business's marking floor, STARTED here so it overlaps the session
    // lookup below rather than delaying the screen by a round trip. Awaited at
    // the check. fetchMarkableFloor resolves on every path and never rejects,
    // so leaving it in flight cannot become an unhandled rejection.
    const markableFloorPromise = fetchFloor();

    // Resolve the session from (class_id, date) — or leave null, which means
    // "create it on save". Never from a URL param; see the note on the params
    // above. The pair is unique, so this is the only answer there is.
    const { data: existingSession } = await loadSession(id, date);
    const sid: string | null = existingSession?.id ?? null;

    if (token !== loadToken.current) return;

    // A lesson the admin CANCELLED in advance takes no marks. Said here, in the
    // same place a closed date is refused — and this is the cosmetic half: the
    // database trigger (guard_attendance_date, 20260821000700) refuses the
    // write whatever this screen shows, so a stale screen cannot mark it.
    if (existingSession?.cancelled_at) {
      const reason = (existingSession as any).cancellation_reason as string | null;
      // ⚠ cls.title, NOT the `classTitle` state: setClassTitle above has not
      // re-rendered yet, so the state is the PREVIOUS lesson's title — "" on a
      // cold open ("cancelled this lesson"), the OLD class on a change in place.
      setBlocked(cancelledBlock(cls.title, date, reason));
      // ⚠ AND RESOLVE THE DATE, like the `!cls` branch. The route's render guard
      // is isShowingDate(resolved, date); without this the notice was set but
      // the spinner held forever (BACKLOG, fixed 2026-09-24).
      setResolved({ date, sessionId: sid });
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
          ? loadMyRosterRow(sid)
          : Promise.resolve({ data: null as { coach_id: string } | null }),
        // ⚠ AN RPC, NOT A FILTERED TABLE READ, AND `me` IS THE REASON.
        // A client-side `coach_id = me.id` filter is null-unsafe here: `me` is
        // resolved from a session that is NOT hydrated when this screen is
        // deep-linked, so the filter matches nothing and the coach silently
        // resolves to "covered" — measured, and it cost this screen a real
        // failure (§7.141). coach_is_active_class_shadow() reads
        // current_coach_id() server-side, which cannot be absent, and is also
        // admin-proof in a way `select *` on the table is not.
        isActiveClassShadow(id),
        // With no session row there is nothing to ask about.
        sid ? isMainOnSession(sid) : Promise.resolve(ownsClass),
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
      const { data: shadowRoster } = await sessionShadowCoaches(id, date);

      if (token !== loadToken.current) return;

      setShadowsHere(shadowRows(shadowRoster));
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
      ? await loadAttendance(sid)
      : { data: [] as any[] };

    // Children booked for a TRIAL on this date. They are not enrolled — a trial
    // is a visit, not a standing arrangement — so without this they would never
    // appear, never be marked, and the billing month could never close.
    const { data: booked } = await loadTrialBookings(id, date);

    // And children booked for a MAKE-UP: enrolled elsewhere, guesting into
    // this one lesson. Same mechanism, same stakes — an unmarked make-up
    // holds the billing month open.
    const { data: makeupBooked } = await loadMakeupBookings(id, date);

    if (token !== loadToken.current) return;

    const roster = mergeRoster(
      enrolledOnDate,
      guestRows(attData),
      guestRows(booked),
      guestRows(makeupBooked)
    );

    setStudents(roster);

    const initAtt = initialAttendance(roster, attData, sid);

    setAttendance(initAtt);
    // The statuses AS LOADED, for the credit-note-email check — see loadedStatusesOf.
    loadedStatuses.current = loadedStatusesOf(initAtt);
    setLoading(false);
  }

  return {
    classTitle,
    students,
    attendance,
    setAttendance,
    loadedStatuses,
    resolved,
    setResolved,
    loading,
    blocked,
    shadowsHere,
    setShadowsHere,
    role,
    load,
  };
}
