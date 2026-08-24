"use client";

// One lesson, for the tenant admin: mark attendance (incl. a per-lesson
// public-holiday void), assign/remove a substitute, and book a make-up or trial
// INTO this lesson. Reached from the Calendar (double-click) and the Lessons
// list; addressed by (classId, date) — NEVER a session id (§7.64): the row may
// not exist yet, and this page creates it only when the admin saves marks.
//
// THE SAVE IS THE COACH APP'S SAVE — lib/adminAttendanceSave.ts mirrors it step
// for step (session resolve-or-insert → one upsert of the CHANGED rows → audit
// → bounded credit-note email), with every step's error surfaced. Every DB
// guard the coach meets applies here unchanged; there is NO override.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { colourFor } from "@/lib/classColours";
import { dayOfWeekOf, formatSgDate, todayInSg, toSgDate, type DayOfWeek } from "@/lib/lessonDates";
import { formatTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { expectedStudentsOn, studentsEnrolledOn, type EnrolmentSpan } from "@/lib/attendanceCompleteness";
import { attributeLessons, termsCoachOn, type AbsenceRow, type ClassRateRow, type ClassShadowRow, type SubstituteRow } from "@/lib/lessonAttribution";
import { fetchMarkableFloor } from "@/lib/markableFloor";
import { formatCount, isFull } from "@/lib/calendarLessons";
import { saveAdminAttendance, type SaveEntry } from "@/lib/adminAttendanceSave";
import { supabaseSaveDeps } from "@/lib/adminAttendanceSaveDeps";
import {
  STATUS_LABEL,
  SET_ALL_OPTIONS,
  optionsForKind,
  holidayTransitions,
  lessonMarkability,
  rowEditable,
  capitalise,
  type DbStatus,
  type RosterKind,
} from "@/lib/lessonMarking";
import { filterEligibleKids } from "@/lib/makeupSearch";

type ClassInfo = {
  id: string;
  title: string;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
  location_name: string;
  coach_id: string;
  category_id: string;
  colour: string | null;
  capacity: number | null;
  is_active: boolean;
  deactivated_at: string | null;
};

type RosterRow = {
  studentId: string;
  name: string;
  kind: RosterKind;
  /** The booking id for a guest (to cancel it). */
  bookingId: string | null;
  /** False for a marked row whose child is no longer expected (left the class). */
  expected: boolean;
  prev: DbStatus | null;
};

type CoachOpt = { id: string; name: string };

type EligibleKid = {
  id: string;
  full_name: string;
  home_classes: { id: string; title: string; category_id: string }[];
  home_class_titles: string[];
};

export default function LessonPage() {
  const params = useParams<{ classId: string; date: string }>();
  const classId = params.classId;
  const date = params.date;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cls, setCls] = useState<ClassInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Set when the admin cancelled this lesson in advance (cancel_lesson). */
  const [cancelled, setCancelled] = useState<{ reason: string | null } | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [draft, setDraft] = useState<Record<string, DbStatus | null>>({});
  const [coaches, setCoaches] = useState<CoachOpt[]>([]);
  const [attr, setAttr] = useState<{ mainId: string | null; isCover: boolean; subRowId: string | null; shadowIds: string[] } | null>(null);
  const [termsCoachId, setTermsCoachId] = useState<string | null>(null);
  const [floor, setFloor] = useState<string | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [holidayDays, setHolidayDays] = useState<number>(7);
  const [kids, setKids] = useState<EligibleKid[]>([]);
  const [trialKids, setTrialKids] = useState<{ id: string; full_name: string }[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  // ── Save / action state ─────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmHoliday, setConfirmHoliday] = useState<number | null>(null);
  const [coachPick, setCoachPick] = useState("");
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachMsg, setCoachMsg] = useState<string | null>(null);
  const [bookKind, setBookKind] = useState<"makeup" | "trial" | null>(null);
  const [bookQuery, setBookQuery] = useState("");
  const [bookKid, setBookKid] = useState("");
  const [bookHome, setBookHome] = useState("");
  const [bookBusy, setBookBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  // Advance-cancel / restore (plan Phase B, Step B4). Every rule is enforced by
  // cancel_lesson()/restore_lesson() themselves — future-only, no guests, no
  // marks, not into a billed month — and their message is RENDERED, not
  // pre-empted (§7.32: a limit only the admin screen applies is not a limit).
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const today = todayInSg();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!validDate) {
      setLoading(false);
      setLoadError("That date isn't valid.");
      return;
    }
    let stale = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      const floorP = fetchMarkableFloor();
      const [{ data: sess }, clsRes, sessionRes, coachesRes, enrolRes, trialsRes, makeupsRes, ratesRes, shadowsRes, tenantRes, kidsRes] =
        await Promise.all([
          supabase.auth.getSession(),
          supabase
            .from("classes")
            .select("id, title, day_of_week, start_time, end_time, location_id, locations(name), coach_id, category_id, colour, capacity, is_active, deactivated_at, class_categories(default_capacity)")
            .eq("id", classId)
            .maybeSingle(),
          supabase.from("lesson_sessions").select("id, cancelled_at, cancellation_reason").eq("class_id", classId).eq("session_date", date).maybeSingle(),
          supabase.from("coaches").select("id, profiles(full_name)"),
          supabase
            .from("student_class_enrolments")
            .select("student_id, enrolled_at, unenrolled_at, students(full_name)")
            .eq("class_id", classId),
          supabase.from("trial_bookings").select("id, student_id, students(full_name)").eq("class_id", classId).eq("session_date", date).is("cancelled_at", null),
          supabase.from("makeup_bookings").select("id, student_id, students(full_name)").eq("class_id", classId).eq("session_date", date).is("cancelled_at", null),
          supabase.from("class_rates").select("class_id, effective_from, paid_coach_id").eq("class_id", classId),
          supabase.from("class_shadow_coaches").select("class_id, coach_id, effective_from, effective_to").eq("class_id", classId),
          supabase.from("tenants").select("holiday_extension_days").limit(1).maybeSingle(),
          supabase
            .from("students")
            .select("id, full_name, is_active, student_class_enrolments(is_active, classes(id, title, category_id))")
            .order("full_name"),
        ]);
      if (stale) return;

      const firstErr = clsRes.error ?? sessionRes.error ?? coachesRes.error ?? enrolRes.error ?? trialsRes.error ?? makeupsRes.error ?? ratesRes.error ?? shadowsRes.error;
      if (firstErr) {
        setLoadError(firstErr.message);
        setLoading(false);
        return;
      }
      if (!clsRes.data) {
        setLoadError("That class does not exist, or is not in your business.");
        setLoading(false);
        return;
      }

      const c: any = clsRes.data;
      const info: ClassInfo = {
        id: c.id,
        title: c.title,
        day_of_week: c.day_of_week,
        start_time: c.start_time,
        end_time: c.end_time,
        location_name: c.locations?.name ?? "",
        coach_id: c.coach_id,
        category_id: c.category_id,
        colour: c.colour ?? null,
        capacity: c.capacity ?? c.class_categories?.default_capacity ?? null,
        is_active: c.is_active !== false,
        deactivated_at: c.deactivated_at ?? null,
      };
      setCls(info);
      setActorId(sess.session?.user.id ?? null);
      setHolidayDays(Number(tenantRes.data?.holiday_extension_days ?? 7));
      const sid = (sessionRes.data?.id as string | undefined) ?? null;
      setSessionId(sid);
      const sessRow = sessionRes.data as { cancelled_at?: string | null; cancellation_reason?: string | null } | null;
      setCancelled(sessRow?.cancelled_at ? { reason: sessRow.cancellation_reason ?? null } : null);

      const coachList: CoachOpt[] = ((coachesRes.data ?? []) as any[])
        .map((x) => ({ id: x.id, name: x.profiles?.full_name ?? "Unknown coach" }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCoaches(coachList);

      // Attendance + substitute only exist when the session does.
      let marks = new Map<string, DbStatus>();
      let subs: SubstituteRow[] = [];
      let subRowId: string | null = null;
      let absences: AbsenceRow[] = [];
      if (sid) {
        const [attRes, subRes, absRes] = await Promise.all([
          supabase.from("attendance").select("student_id, status").eq("lesson_session_id", sid),
          supabase.from("session_coaches").select("id, lesson_session_id, coach_id").eq("lesson_session_id", sid),
          supabase.from("session_coach_absences").select("lesson_session_id, coach_id").eq("lesson_session_id", sid),
        ]);
        if (stale) return;
        marks = new Map(((attRes.data ?? []) as any[]).map((a) => [a.student_id, a.status as DbStatus]));
        subs = ((subRes.data ?? []) as any[]).map((s) => ({ lesson_session_id: s.lesson_session_id, coach_id: s.coach_id }));
        subRowId = ((subRes.data ?? []) as any[])[0]?.id ?? null;
        absences = (absRes.data ?? []) as AbsenceRow[];
      }

      // Who is expected: the SAME union the billing gate uses.
      const spans: EnrolmentSpan[] = ((enrolRes.data ?? []) as any[]).map((e) => ({
        studentId: e.student_id,
        from: toSgDate(e.enrolled_at),
        until: e.unenrolled_at ? toSgDate(e.unenrolled_at) : null,
      }));
      const names = new Map<string, string>();
      for (const e of (enrolRes.data ?? []) as any[]) names.set(e.student_id, e.students?.full_name ?? "Unknown");
      const guests: { id: string; student_id: string; kind: RosterKind; name: string }[] = [
        ...((trialsRes.data ?? []) as any[]).map((b) => ({ id: b.id, student_id: b.student_id, kind: "trial" as const, name: b.students?.full_name ?? "Unknown" })),
        ...((makeupsRes.data ?? []) as any[]).map((b) => ({ id: b.id, student_id: b.student_id, kind: "makeup" as const, name: b.students?.full_name ?? "Unknown" })),
      ];
      for (const g of guests) names.set(g.student_id, g.name);
      const bookedByDate = new Map<string, string[]>([[date, guests.map((g) => g.student_id)]]);
      const enrolledSet = new Set(studentsEnrolledOn(date, spans));
      const expected = expectedStudentsOn(date, spans, bookedByDate);
      const rows: RosterRow[] = expected.map((id) => {
        const g = guests.find((x) => x.student_id === id);
        return {
          studentId: id,
          name: names.get(id) ?? "Unknown",
          kind: enrolledSet.has(id) ? "enrolled" : g?.kind ?? "trial",
          bookingId: enrolledSet.has(id) ? null : g?.id ?? null,
          expected: true,
          prev: marks.get(id) ?? null,
        };
      });
      // A marked row for a child no longer expected (left the class) is still
      // shown, read-only-ish, so the admin sees it — and it is a correction.
      for (const [id, st] of marks) {
        if (!expected.includes(id)) rows.push({ studentId: id, name: names.get(id) ?? "Former student", kind: "enrolled", bookingId: null, expected: false, prev: st });
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setRoster(rows);
      setDraft(Object.fromEntries(rows.map((r) => [r.studentId, r.prev])));

      const a = attributeLessons({
        lessons: [{ lesson_session_id: sid ?? "pending", class_id: classId, session_date: date }],
        substitutes: subs,
        classRates: (ratesRes.data ?? []) as ClassRateRow[],
        shadows: (shadowsRes.data ?? []) as ClassShadowRow[],
        absences,
      }).get(sid ?? "pending");
      setAttr({ mainId: a?.main_coach_id ?? null, isCover: a?.is_cover ?? false, subRowId, shadowIds: a?.shadow_coach_ids ?? [] });
      setTermsCoachId(termsCoachOn((ratesRes.data ?? []) as ClassRateRow[], classId, date));

      const kidRows = (kidsRes.data ?? []) as any[];
      setKids(
        kidRows
          .filter((k) => k.is_active)
          .map((k) => {
            const enrolled = (k.student_class_enrolments ?? [])
              .filter((e: any) => e.is_active && e.classes)
              .map((e: any) => ({ id: e.classes.id, title: e.classes.title, category_id: e.classes.category_id }));
            if (enrolled.length === 0) return null;
            return { id: k.id, full_name: k.full_name, home_classes: enrolled, home_class_titles: enrolled.map((e: any) => e.title) };
          })
          .filter(Boolean) as EligibleKid[]
      );
      setTrialKids(
        kidRows
          .filter((k) => k.is_active && !(k.student_class_enrolments ?? []).some((e: any) => e.is_active))
          .map((k) => ({ id: k.id, full_name: k.full_name }))
      );

      setFloor(await floorP);
      if (stale) return;
      setLoading(false);
    })();
    return () => {
      stale = true;
    };
  }, [classId, date, validDate, reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  // ── Derived ─────────────────────────────────────────────────────────────
  const markability = useMemo(
    () =>
      cls
        ? lessonMarkability({ date, today, classDayOfWeek: cls.day_of_week, classTitle: cls.title, sessionExists: sessionId !== null, windowFloor: floor })
        : null,
    [cls, date, today, sessionId, floor]
  );
  const newRowsAllowed = markability?.ok ?? false;
  const notALesson = !!cls && !sessionId && dayOfWeekOf(date) !== cls.day_of_week;
  const isFuture = date > today;

  const enrolledCount = roster.filter((r) => r.expected && r.bookingId === null).length;
  const guestCount = roster.filter((r) => r.expected && r.bookingId !== null).length;
  const full = !!cls && isFull(enrolledCount, guestCount, cls.capacity);

  const dirty = roster.some((r) => (draft[r.studentId] ?? null) !== r.prev);
  const mainName = coaches.find((c) => c.id === attr?.mainId)?.name ?? "—";
  // The coach the class rate already pays teaches this lesson anyway, so
  // assigning them records no cover — the DB refuses it (20260821000100). Exclude
  // that coach from the picker so the UI never offers what the DB will reject.
  // Falls back to the class's own coach before rates have loaded.
  const excludedCoachId = termsCoachId ?? cls?.coach_id ?? null;
  const classCoachName = coaches.find((c) => c.id === excludedCoachId)?.name ?? "the class's coach";
  const substituteOptions = coaches.filter((c) => c.id !== excludedCoachId);

  // ── Save ────────────────────────────────────────────────────────────────
  async function doSave() {
    if (!cls || !actorId) return;
    setSaving(true);
    setSaveMsg(null);
    const entries: SaveEntry[] = roster
      .filter((r) => draft[r.studentId] !== null && draft[r.studentId] !== undefined)
      .map((r) => ({ studentId: r.studentId, status: draft[r.studentId] as string, prevStatus: r.prev }));
    const res = await saveAdminAttendance({ deps: supabaseSaveDeps(), classId, date, actorProfileId: actorId, knownSessionId: sessionId, entries });
    setSaving(false);
    if (res.ok) {
      setSaveMsg({ kind: "ok", text: res.sent === 0 ? "Nothing to save." : `Saved ${res.sent} mark${res.sent === 1 ? "" : "s"}.${res.emailed ? " A credit-note email was requested." : ""}` });
      reload();
    } else {
      setSaveMsg({ kind: "error", text: res.message });
      if (res.step === "audit") reload();
    }
  }

  function requestSave() {
    const n = holidayTransitions(roster.map((r) => ({ studentId: r.studentId, kind: r.kind, prev: r.prev, next: draft[r.studentId] ?? null })));
    if (n > 0) setConfirmHoliday(n);
    else void doSave();
  }

  function setAll(status: DbStatus) {
    setDraft((d) => {
      const next = { ...d };
      for (const r of roster) {
        if (!rowEditable(r.prev !== null, newRowsAllowed)) continue;
        if (!optionsForKind(r.kind).includes(status)) continue;
        next[r.studentId] = status;
      }
      return next;
    });
  }

  // ── Coaches ─────────────────────────────────────────────────────────────
  async function assignCoach() {
    if (!coachPick) return;
    setCoachBusy(true);
    setCoachMsg(null);
    const { error } = await supabase.rpc("assign_session_coach", { p_class_id: classId, p_session_date: date, p_coach_id: coachPick });
    setCoachBusy(false);
    if (error) {
      setCoachMsg(`Could not assign: ${error.message}`);
      return;
    }
    setCoachPick("");
    reload();
  }
  async function removeCover() {
    if (!attr?.subRowId) return;
    setCoachBusy(true);
    const { error } = await supabase.from("session_coaches").delete().eq("id", attr.subRowId);
    setCoachBusy(false);
    if (error) {
      setCoachMsg(`Could not remove: ${error.message}`);
      return;
    }
    reload();
  }

  // ── Guests ──────────────────────────────────────────────────────────────
  const bookKidRow = kids.find((k) => k.id === bookKid);
  const homeClass =
    bookKidRow?.home_classes.find((c) => c.id === bookHome) ??
    (bookKidRow?.home_classes.length === 1 ? bookKidRow.home_classes[0] : undefined);
  // Eligible for a make-up INTO this lesson: active, enrolled somewhere in the
  // same category, and NOT in this class. The RPC re-checks all of it (§7.32).
  const makeupCandidates = useMemo(() => {
    if (!cls) return [];
    return filterEligibleKids(
      kids.filter((k) => k.home_classes.some((c) => c.category_id === cls.category_id) && !k.home_classes.some((c) => c.id === cls.id)),
      bookQuery
    );
  }, [kids, cls, bookQuery]);

  async function doBook() {
    if (!cls) return;
    setBookBusy(true);
    setBookError(null);
    const { error } =
      bookKind === "makeup"
        ? await supabase.rpc("book_makeup", { p_class_id: classId, p_session_date: date, p_student_id: bookKid, p_home_class_id: homeClass?.id ?? null })
        : await supabase.rpc("book_trial", { p_class_id: classId, p_session_date: date, p_student_id: bookKid });
    setBookBusy(false);
    if (error) {
      setBookError(error.message);
      return;
    }
    setBookKind(null);
    setBookKid("");
    setBookHome("");
    setBookQuery("");
    reload();
  }
  function requestBook() {
    if (!bookKid) {
      setBookError("Choose a child.");
      return;
    }
    if (bookKind === "makeup" && bookKidRow && bookKidRow.home_classes.length > 1 && !homeClass) {
      setBookError("Choose which class this make-up replaces.");
      return;
    }
    void doBook();
  }
  // ── Cancel / restore the whole lesson ───────────────────────────────────
  async function doCancelLesson() {
    setCancelBusy(true);
    setCancelError(null);
    const { error } = await supabase.rpc("cancel_lesson", { p_class_id: classId, p_date: date, p_reason: cancelReason });
    setCancelBusy(false);
    if (error) {
      setCancelError(error.message);
      return;
    }
    setCancelOpen(false);
    setCancelReason("");
    reload();
  }
  async function doRestoreLesson() {
    setCancelBusy(true);
    setSaveMsg(null);
    const { error } = await supabase.rpc("restore_lesson", { p_class_id: classId, p_date: date });
    setCancelBusy(false);
    if (error) {
      setSaveMsg({ kind: "error", text: `Could not restore the lesson: ${error.message}` });
      return;
    }
    reload();
  }

  async function cancelBooking(row: RosterRow) {
    if (!row.bookingId) return;
    const fn = row.kind === "trial" ? "cancel_trial_booking" : "cancel_makeup_booking";
    const { error } = await supabase.rpc(fn, { p_booking_id: row.bookingId });
    if (error) {
      setSaveMsg({ kind: "error", text: `Could not cancel the booking: ${error.message}` });
      return;
    }
    reload();
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const backHref = `/calendar?view=day&date=${date}`;

  if (loading) {
    return (
      <div>
        <PageHeader title="Lesson" />
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }
  if (loadError || !cls) {
    return (
      <div>
        <PageHeader title="Lesson" />
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError ?? "Not found."}</div>
        <Link href="/calendar" className="mt-3 inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Calendar
        </Link>
      </div>
    );
  }

  const colour = colourFor(cls.colour);
  const countText = formatCount(enrolledCount, guestCount, cls.capacity);

  return (
    <div>
      <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Calendar · {formatSgDate(date, { weekday: "short", day: "numeric", month: "short" })}
      </Link>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className={cn("inline-block h-3 w-3 rounded-full", colour.dot)} />
            {cls.title}
          </span>
        }
        subtitle={`${formatSgDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${formatTime(cls.start_time)} – ${formatTime(cls.end_time)} · ${cls.location_name}`}
        action={
          <div className="flex items-center gap-3">
            {/* Cancel is offered only for a FUTURE lesson of a running class —
                the RPC refuses today/past anyway (the coach's cancelled_rain /
                cancelled_coach mark is that path). Restore whenever cancelled;
                its sealed-month refusal is rendered from the RPC. */}
            {cancelled ? (
              <Button size="sm" variant="outline" data-testid="restore-lesson" onClick={doRestoreLesson} disabled={cancelBusy}>
                {cancelBusy ? "Restoring…" : "Restore this lesson"}
              </Button>
            ) : (
              !notALesson && isFuture && cls.is_active && (
                <Button size="sm" variant="outline" data-testid="cancel-lesson" onClick={() => { setCancelError(null); setCancelOpen(true); }}>
                  Cancel this lesson
                </Button>
              )
            )}
            <Link href="/classes" className="text-sm text-sky-700 hover:underline">
              Classes page →
            </Link>
          </div>
        }
      />

      {cancelled && (
        <div data-testid="lesson-cancelled" className="mb-4 rounded-xl border border-gray-300 bg-gray-50 p-4 text-sm text-gray-800">
          <p className="font-semibold">This lesson is cancelled.</p>
          <p className="mt-1">
            {cancelled.reason ? <>Reason: <span className="italic">{cancelled.reason}</span>. </> : null}
            Parents see it struck out under Upcoming, the coach has nothing to mark, and the billing month does not wait for it.
            Guests cannot be booked into it. If it is going ahead after all, restore it.
          </p>
        </div>
      )}

      {notALesson ? (
        <div data-testid="not-a-lesson" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">This class doesn&apos;t run on {capitalise(dayOfWeekOf(date) ?? "that day")}.</p>
          <p className="mt-1">
            {cls.title} runs on {capitalise(cls.day_of_week)}s and there is no lesson scheduled on {formatSgDate(date)}. If the lesson genuinely moved, schedule it as an extra lesson from the Classes page first.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* ── Attendance ─────────────────────────────────────────────── */}
          <section className="lg:col-span-2 rounded-xl border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
              <h2 className="font-semibold text-gray-900">Attendance</h2>
              <span data-testid="lesson-count" className={cn("rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold tabular-nums", full && "bg-red-50 text-red-700")} title="enrolled + guests / max">
                {countText}
                {full && " · FULL"}
              </span>
              {!cls.is_active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Retired class</span>}
              <div className="ml-auto flex items-center gap-2">
                <label className="text-xs text-gray-500">Set all</label>
                <select
                  aria-label="Set all to"
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                  value=""
                  disabled={isFuture || roster.length === 0 || !!cancelled}
                  onChange={(e) => {
                    if (e.target.value) setAll(e.target.value as DbStatus);
                  }}
                >
                  <option value="">Set all to…</option>
                  {SET_ALL_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {markability && !markability.ok && (
              <div data-testid="markability" className={cn("mx-4 mt-3 rounded-lg px-3 py-2 text-sm", isFuture ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-900")}>
                <span className="font-semibold">{markability.title}.</span> {markability.detail}
                {!isFuture && roster.some((r) => r.prev !== null) && (
                  <span> Rows that already have a mark can still be corrected.</span>
                )}
              </div>
            )}

            {roster.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">Nobody is expected at this lesson — no enrolled children on this date and no guests booked.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2">Student</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => {
                    const editable = !isFuture && rowEditable(r.prev !== null, newRowsAllowed);
                    const changed = (draft[r.studentId] ?? null) !== r.prev;
                    return (
                      <tr key={r.studentId} data-testid="roster-row" data-student={r.studentId} className={cn("border-t border-gray-100", changed && "bg-amber-50/40")}>
                        <td className="px-4 py-2">
                          <span className="font-medium text-gray-900">{r.name}</span>
                          {r.kind !== "enrolled" && (
                            <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                              {r.kind === "trial" ? "Trial" : "Make-up"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <StatusButtons
                            name={r.name}
                            kind={r.kind}
                            value={draft[r.studentId] ?? null}
                            disabled={!editable}
                            onChange={(next) => setDraft((d) => ({ ...d, [r.studentId]: next }))}
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          {r.bookingId && (
                            <button type="button" onClick={() => cancelBooking(r)} className="text-xs text-red-600 hover:underline">
                              Cancel booking
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-3">
              <Button onClick={requestSave} disabled={saving || !dirty || isFuture || !!cancelled} data-testid="save-attendance">
                {saving ? "Saving…" : "Save attendance"}
              </Button>
              {dirty && !saving && <span className="text-xs text-gray-500">Unsaved changes</span>}
              {saveMsg && (
                <span data-testid="save-message" className={cn("text-sm", saveMsg.kind === "ok" ? "text-emerald-700" : "text-red-700")}>
                  {saveMsg.text}
                </span>
              )}
            </div>
          </section>

          {/* ── Coaches + Guests ─────────────────────────────────────────── */}
          <div className="space-y-4">
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="mb-2 font-semibold text-gray-900">Coaches</h2>
              <p className="text-sm">
                Teaching: <span className="font-medium">{mainName}</span>
                {attr?.isCover && <span className="ml-1 font-semibold text-red-600">(Sub)</span>}
              </p>
              {attr && attr.shadowIds.length > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  Shadow: {attr.shadowIds.map((id) => coaches.find((c) => c.id === id)?.name ?? "Unknown").join(", ")} (read-only; managed on the Classes page)
                </p>
              )}
              <div className="mt-3">
                <p className="text-xs font-medium text-gray-600">Assign a substitute for this lesson</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Covers this one lesson only — it does not change {classCoachName}, the class&apos;s regular coach.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <select aria-label="Substitute coach" className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" value={coachPick} onChange={(e) => setCoachPick(e.target.value)} disabled={coachBusy}>
                    <option value="">Choose a substitute…</option>
                    {substituteOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" onClick={assignCoach} disabled={!coachPick || coachBusy}>
                    Assign
                  </Button>
                </div>
              </div>
              {attr?.subRowId && (
                <Button variant="outline" size="sm" onClick={removeCover} disabled={coachBusy} className="mt-3">
                  Remove substitute (back to {classCoachName})
                </Button>
              )}
              {coachMsg && <p className="mt-2 text-xs text-red-700">{coachMsg}</p>}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="mb-2 font-semibold text-gray-900">Guests</h2>
              <p className="text-xs text-gray-500">
                {guestCount === 0 ? "No trial or make-up guests booked into this lesson." : `${guestCount} guest${guestCount === 1 ? "" : "s"} booked — they appear in the attendance table above.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => { setBookKind("makeup"); setBookError(null); }} disabled={date < today || !!cancelled}>
                  Book a make-up into this lesson
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setBookKind("trial"); setBookError(null); }} disabled={date < today || !!cancelled}>
                  Book a trial into this lesson
                </Button>
              </div>
              {date < today && <p className="mt-2 text-xs text-gray-400">Bookings are for today or a future lesson.</p>}
            </section>
          </div>
        </div>
      )}

      {/* ── Cancel this lesson (reason required) ───────────────────────── */}
      <Modal title={`Cancel ${cls.title} on ${formatSgDate(date)}?`} open={cancelOpen} onClose={() => setCancelOpen(false)}>
        <div className="space-y-3 text-sm">
          <p className="text-gray-600">
            The whole lesson is called off — rain, the coach away. Every parent sees it struck out under Upcoming with your reason,
            the coach has nothing to mark, and the billing month does not wait for it. A single child not coming is an absence, not this.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Reason (the parents and the coach see this)</span>
            <input
              aria-label="Cancellation reason"
              data-testid="cancel-reason"
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
              placeholder="e.g. Heavy rain forecast — pool closed"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              disabled={cancelBusy}
            />
          </label>
          {cancelError && <p data-testid="cancel-error" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{cancelError}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setCancelOpen(false)} disabled={cancelBusy}>
              Keep the lesson
            </Button>
            <Button className="flex-1" data-testid="confirm-cancel-lesson" onClick={doCancelLesson} disabled={cancelBusy || cancelReason.trim() === ""}>
              {cancelBusy ? "Cancelling…" : "Cancel the lesson"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Confirm: holiday void ───────────────────────────────────────── */}
      <Modal title="Void as a public holiday?" open={confirmHoliday !== null} onClose={() => setConfirmHoliday(null)}>
        <p className="text-sm text-gray-700">
          This marks <strong>{confirmHoliday}</strong> student{confirmHoliday === 1 ? "" : "s"} as <em>public holiday</em>: the lesson bills nothing for them and each of their prepaid packages is extended by <strong>{holidayDays} day{holidayDays === 1 ? "" : "s"}</strong>. A billed lesson turning into a holiday issues a credit note. This can be reversed by marking them again.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setConfirmHoliday(null)}>
            Cancel
          </Button>
          <Button className="flex-1" data-testid="confirm-holiday" onClick={() => { setConfirmHoliday(null); void doSave(); }}>
            Void {confirmHoliday} as holiday
          </Button>
        </div>
      </Modal>

      {/* ── Book a guest ────────────────────────────────────────────────── */}
      <Modal title={bookKind === "trial" ? "Book a trial into this lesson" : "Book a make-up into this lesson"} open={bookKind !== null} onClose={() => setBookKind(null)}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {cls.title} · {formatSgDate(date)} · currently {countText}{full ? " (full)" : ""}
          </p>
          {bookKind === "makeup" ? (
            <>
              <input
                aria-label="Search child"
                placeholder="Child's name or their class…"
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={bookQuery}
                onChange={(e) => { setBookQuery(e.target.value); setBookKid(""); setBookHome(""); }}
              />
              <select aria-label="Child" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" value={bookKid} onChange={(e) => { setBookKid(e.target.value); setBookHome(""); }}>
                <option value="">Choose a child ({makeupCandidates.length})…</option>
                {makeupCandidates.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.full_name} — {k.home_class_titles.join(", ")}
                  </option>
                ))}
              </select>
              {bookKidRow && bookKidRow.home_classes.length > 1 && (
                <select aria-label="Which class does this make-up replace" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" value={bookHome} onChange={(e) => setBookHome(e.target.value)}>
                  <option value="">Which class does this make-up replace?</option>
                  {bookKidRow.home_classes.filter((c) => c.category_id === cls.category_id).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-gray-500">Only children enrolled in another same-category class are offered; the booking rules are re-checked when you book.</p>
            </>
          ) : (
            <>
              <select aria-label="Trial child" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" value={bookKid} onChange={(e) => setBookKid(e.target.value)}>
                <option value="">Choose a child not yet in a class ({trialKids.length})…</option>
                {trialKids.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.full_name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">A trial child must not be enrolled anywhere. To add a brand-new child, use the Trials page.</p>
            </>
          )}
          {full && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="full-notice">
              This lesson is full ({countText}). The database will refuse a booking — raise the class&apos;s maximum on the Classes page to add one.
            </p>
          )}
          {bookError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{bookError}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setBookKind(null)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={requestBook} disabled={bookBusy} data-testid="book-guest">
              {bookBusy ? "Booking…" : "Book"}
            </Button>
          </div>
        </div>
      </Modal>

      <p className="mt-3 text-xs text-gray-400">
        Saving writes attendance exactly as the coach app does; the marking window, weekday rule, capacity and credit-note lock are enforced by the database and cannot be overridden here. Substitutes and shadows follow the Lesson Coaches rules.
      </p>
    </div>
  );
}

// ── Status buttons — the coach app's shape (top status + a reason), not a dropdown ──
type Top = "present" | "absent" | "cancelled" | "trial" | "holiday";
function topOf(s: DbStatus | null): Top | null {
  if (!s) return null;
  if (s === "cancelled_rain" || s === "cancelled_coach") return "cancelled";
  if (s === "trial_paid" || s === "trial_free") return "trial";
  return s;
}
const TOP_LABEL: Record<Top, string> = { present: "Present", absent: "Absent", cancelled: "Cancelled", trial: "Trial", holiday: "Holiday" };
const TOP_ACTIVE: Record<Top, string> = {
  present: "bg-emerald-600 text-white border-emerald-600",
  absent: "bg-red-600 text-white border-red-600",
  cancelled: "bg-sky-600 text-white border-sky-600",
  trial: "bg-violet-600 text-white border-violet-600",
  holiday: "bg-gray-700 text-white border-gray-700",
};

function StatusButtons({
  name,
  kind,
  value,
  disabled,
  onChange,
}: {
  name: string;
  kind: RosterKind;
  value: DbStatus | null;
  disabled: boolean;
  onChange: (next: DbStatus) => void;
}) {
  const allowed = optionsForKind(kind);
  const tops: Top[] = (["present", "absent", "cancelled", "trial", "holiday"] as Top[]).filter((t) =>
    t === "cancelled" ? allowed.includes("cancelled_rain") : t === "trial" ? allowed.includes("trial_paid") : allowed.includes(t as DbStatus)
  );
  const top = topOf(value);
  const pick = (t: Top) => {
    if (t === "cancelled") onChange(value === "cancelled_coach" ? "cancelled_coach" : "cancelled_rain");
    else if (t === "trial") onChange(value === "trial_free" ? "trial_free" : "trial_paid");
    else onChange(t);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Status for ${name}`}>
      {tops.map((t) => (
        <button
          key={t}
          type="button"
          data-status={t}
          aria-pressed={top === t}
          disabled={disabled}
          onClick={() => pick(t)}
          className={cn(
            "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
            top === t ? TOP_ACTIVE[t] : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          )}
        >
          {TOP_LABEL[t]}
        </button>
      ))}
      {top === "cancelled" && (
        <span className="ml-1 inline-flex overflow-hidden rounded-lg border border-sky-300 text-xs" role="group" aria-label={`Cancellation reason for ${name}`}>
          {(["cancelled_rain", "cancelled_coach"] as const).map((s) => (
            <button key={s} type="button" data-status={s} aria-pressed={value === s} disabled={disabled} onClick={() => onChange(s)}
              className={cn("px-2 py-1", value === s ? "bg-sky-100 font-semibold text-sky-900" : "bg-white text-gray-600 hover:bg-gray-50")}>
              {s === "cancelled_rain" ? "Rain" : "Coach"}
            </button>
          ))}
        </span>
      )}
      {top === "trial" && (
        <span className="ml-1 inline-flex overflow-hidden rounded-lg border border-violet-300 text-xs" role="group" aria-label={`Trial type for ${name}`}>
          {(["trial_paid", "trial_free"] as const).map((s) => (
            <button key={s} type="button" data-status={s} aria-pressed={value === s} disabled={disabled} onClick={() => onChange(s)}
              className={cn("px-2 py-1", value === s ? "bg-violet-100 font-semibold text-violet-900" : "bg-white text-gray-600 hover:bg-gray-50")}>
              {s === "trial_paid" ? "Paid" : "Free"}
            </button>
          ))}
        </span>
      )}
      {top === null && <span className="text-xs text-gray-400">Not marked</span>}
    </div>
  );
}
