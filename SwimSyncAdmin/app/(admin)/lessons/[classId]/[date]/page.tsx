"use client";

// One lesson, for the tenant admin: mark attendance (incl. a per-lesson
// public-holiday void), assign/remove a substitute, and book a make-up or trial
// INTO this lesson. Reached from the Calendar (double-click) and the Lessons
// list; addressed by (classId, date) — NEVER a session id (§7.64): the row may
// not exist yet, and this page creates it only when the admin saves marks.
//
// THE SAVE IS THE COACH APP'S SAVE — domain/adminAttendanceSave.ts mirrors it step
// for step (session resolve-or-insert → one upsert of the CHANGED rows → audit
// → bounded credit-note email), with every step's error surfaced. Every DB
// guard the coach meets applies here unchanged; there is NO override.


import { useParams } from "next/navigation";
import { useLessonDetail } from "./domain/useLessonDetail";
import { useAttendanceSave } from "./domain/useAttendanceSave";
import { useSubstitute } from "./domain/useSubstitute";
import { useGuestBooking } from "./domain/useGuestBooking";
import { useCancelLesson } from "./domain/useCancelLesson";
import { LessonLoading, LessonLoadError } from "./ui/LessonState";
import { LessonHeader } from "./ui/LessonHeader";
import { CancelledBanner } from "./ui/CancelledBanner";
import { NotALesson } from "./ui/NotALesson";
import { AttendancePanel } from "./ui/AttendancePanel";
import { CoachesPanel } from "./ui/CoachesPanel";
import { GuestsPanel } from "./ui/GuestsPanel";
import { CancelLessonModal } from "./ui/CancelLessonModal";
import { HolidayConfirmModal } from "./ui/HolidayConfirmModal";
import { BookGuestModal } from "./ui/BookGuestModal";

export default function LessonPage() {
  const params = useParams<{ classId: string; date: string }>();
  const classId = params.classId;
  const date = params.date;

  const ld = useLessonDetail(classId, date);
  const { loading, loadError, cls, cancelled, notALesson, reload } = ld;

  // Hook order is the saveMsg dependency order (plan §3): the save slice owns
  // saveMsg, so it is created before the two slices that also write it.
  const sv = useAttendanceSave({
    classId,
    date,
    cls,
    actorId: ld.actorId,
    sessionId: ld.sessionId,
    roster: ld.roster,
    draft: ld.draft,
    setDraft: ld.setDraft,
    newRowsAllowed: ld.newRowsAllowed,
    reload,
  });
  const sub = useSubstitute({ classId, date, cls, coaches: ld.coaches, termsCoachId: ld.termsCoachId, attr: ld.attr, reload });
  const gb = useGuestBooking({ classId, date, cls, kids: ld.kids, reload, setSaveMsg: sv.setSaveMsg });
  const cx = useCancelLesson(classId, date, reload, sv.setSaveMsg);

  // ── Render ──────────────────────────────────────────────────────────────
  // Everything below this switch unmounts on every reload (§7.249) — which is
  // why every piece of state lives in a domain/ hook above, never in ui/.
  if (loading) return <LessonLoading />;
  if (loadError || !cls) return <LessonLoadError loadError={loadError} />;

  return (
    <div>
      <LessonHeader date={date} cls={cls} ld={ld} cx={cx} />

      {cancelled && <CancelledBanner cancelled={cancelled} />}

      {notALesson ? (
        <NotALesson date={date} cls={cls} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* ── Attendance ─────────────────────────────────────────────── */}
          <AttendancePanel cls={cls} ld={ld} sv={sv} gb={gb} />

          {/* ── Coaches + Guests ─────────────────────────────────────────── */}
          <div className="space-y-4">
            <CoachesPanel ld={ld} sub={sub} />
            <GuestsPanel date={date} ld={ld} gb={gb} />
          </div>
        </div>
      )}

      <CancelLessonModal date={date} cls={cls} cx={cx} />
      <HolidayConfirmModal ld={ld} sv={sv} />
      <BookGuestModal date={date} cls={cls} ld={ld} gb={gb} />

      <p className="mt-3 text-xs text-gray-400">
        Saving writes attendance exactly as the coach app does; the marking window, weekday rule, capacity and credit-note lock are enforced by the database and cannot be overridden here. Substitutes and shadows follow the Lesson Coaches rules.
      </p>    </div>
  );
}
