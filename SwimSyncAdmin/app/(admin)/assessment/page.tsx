"use client";

// Assessment — pick a class to assess.
//
// WHAT THIS PAGE IS FOR. Assessment is a periodic EVENT, not a daily chore:
// every few months an admin tours every class and grades each child against
// their level's skills. This index is the tour's checklist — which classes are
// done for this round, and which are still outstanding.
//
// WHY "ASSESSING SINCE" LIVES HERE AND NOT ONLY ON THE GRID. A round is
// routinely multi-day. If this page always defaulted to today while the grid
// carried the date, then on day two every class assessed on day one would
// report zero — so the assessor would either re-tour them or stop trusting the
// counts. The date is therefore chosen here, carried into each class link, and
// carried back out again. It defaults to today (SGT) because the commonest case
// by far is "I am assessing now".
//
// ⚠ todayInSg(), NEVER new Date().toISOString().split("T")[0] — the latter is
// the UTC date, a day behind in Singapore before 08:00, and pairing it with a
// local getDay() is the §7.7 bug that shipped a real double-billing incident.
//
// Composition only (Admin L-D): state + load in domain/useAssessmentIndex, the
// checklist rows in domain/assessmentRows, data in dao/assessment.repo, markup
// in ui/. See docs/refactor/BATCH_D_PLAN.md.

import { PageHeader } from "@/components/PageHeader";
import { useAssessmentIndex } from "./domain/useAssessmentIndex";
import { SinceControl } from "./ui/SinceControl";
import { ClassChecklist } from "./ui/ClassChecklist";

export default function AssessmentIndexPage() {
  const a = useAssessmentIndex();

  return (
    <div>
      <PageHeader
        title="Assessment"
        subtitle="Grade each child against their level's skills, one class at a time."
      />

      <SinceControl since={a.since} setSince={a.setSince} />

      {a.error ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load the class list: {a.error}. Nothing here is a count you can
          trust until this succeeds — reload before assessing.
        </div>
      ) : null}

      {!a.loading && !a.error ? (
        <p className="mb-4 text-sm text-gray-600">
          {a.outstanding === 0
            ? `Every active class is fully assessed for this round.`
            : `${a.outstanding} of ${a.rows.length} ${
                a.rows.length === 1 ? "class" : "classes"
              } still to assess.`}
        </p>
      ) : null}

      <ClassChecklist rows={a.rows} loading={a.loading} since={a.since} today={a.today} />
    </div>
  );
}
