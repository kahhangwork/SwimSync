"use client";

/**
 * Lesson Coaches — who taught one lesson, when it was not the class's coach.
 *
 * A permanent handover already works: set_class_terms() moves classes.coach_id
 * and writes a class_rates row. What had no representation at all was the
 * ONE-OFF cover, and a business that cannot record one either pays the wrong
 * coach or keeps the truth in WhatsApp.
 *
 * THREE THINGS ON THIS SCREEN ARE LOAD-BEARING, and each of them is a rule from
 * the migration rather than a UI preference — the detail now lives with the code
 * that enforces it:
 *
 * 1. THE MAIN COACH IS ALWAYS WRITTEN THROUGH assign_session_coach() (never an
 *    insert/upsert — the partial unique index). See dao/substitutes.repo.ts.
 * 2. THIS SCREEN NEVER HANDLES A lesson_session_id WHEN WRITING — the RPC takes
 *    (class, DATE, coach) and resolves-or-creates. See dao/substitutes.repo.ts.
 * 3. SHADOWS ARE NOT HERE — a shadow is a dated CLASS assignment, on Classes.
 * 4. ASSIGNING A COVER MOVES THE LESSON OFF THE CLASS COACH'S MARKING LIST, and
 *    that is stated on screen because unmarked attendance blocks billing (§8i).
 *
 * Composition only (Admin L-B): state + loads + writes in domain/useSubstitutes
 * (the load-bearing loadGen stale-guard included), row mapping in
 * domain/substituteRows, data in dao/substitutes.repo, markup in ui/.
 * See docs/refactor/BATCH_B_PLAN.md.
 */

import { PageHeader } from "@/components/PageHeader";
import { useSubstitutes } from "./domain/useSubstitutes";
import { SubstitutesFilters } from "./ui/SubstitutesFilters";
import { SubstitutesTable } from "./ui/SubstitutesTable";

export default function LessonCoachesPage() {
  const s = useSubstitutes();

  return (
    <div>
      <PageHeader
        title="Substitutes"
        subtitle="Who is teaching each lesson — assign a substitute when the class's coach is away"
      />

      <SubstitutesFilters
        classes={s.classes}
        classId={s.classId}
        month={s.month}
        onClass={s.selectClass}
        onMonth={s.selectMonth}
      />

      <p className="mb-4 max-w-3xl text-xs text-gray-500">
        A lesson with no assignment is taught by the class&rsquo;s own coach —
        that is the normal state, and nothing needs recording for it. Assigning
        a substitute moves that <strong>one</strong> lesson onto their list: they
        mark the attendance and are paid their own rate, and the class&rsquo;s
        coach is paid nothing for it. A shadow sees the lesson and is paid their
        own rate as well, but never marks it.
      </p>

      {s.pickerError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the classes and coaches: {s.pickerError}. Names may show
          as &ldquo;Unknown coach&rdquo; and the pickers may be empty — reload
          before assigning anybody.
        </div>
      )}

      {s.loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the roster: {s.loadError}. The lessons below are
          incomplete — do not read an empty row as &ldquo;no substitute&rdquo;.
        </div>
      )}

      {s.message && (
        <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {s.message}
        </div>
      )}

      {!s.selected ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          Choose a class to see its lessons.
        </div>
      ) : (
        <SubstitutesTable
          selected={s.selected}
          coaches={s.coaches}
          lessons={s.lessons}
          loading={s.loading}
          loadError={s.loadError}
          busy={s.busy}
          picking={s.picking}
          pickedCoach={s.pickedCoach}
          setPickedCoach={s.setPickedCoach}
          setPicking={s.setPicking}
          openPicker={s.openPicker}
          handleAssign={s.handleAssign}
          handleRemove={s.handleRemove}
        />
      )}
    </div>
  );
}
