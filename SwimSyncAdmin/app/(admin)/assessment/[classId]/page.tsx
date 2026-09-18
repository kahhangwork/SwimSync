"use client";

// Assess one class: the grid, grouped by level.
//
// The `since` date arrives in the URL from the index page and is written back
// into the Back link, so a multi-day assessment round survives moving between
// classes — and survives midnight, which a page defaulting to today would not.
// Opening this page cold still defaults to today (SGT), because "I am assessing
// now" is the overwhelmingly common case.
//
// Data is read in flat queries rather than one deep embed: a to-many embed
// under a filter is the §7.216 trap, and this screen's whole job is to show
// every child, so a silently narrowed result is the one failure it must not have.
//
// Composition only (Admin L-D): state + load in domain/useAssessClass (which
// also binds the grid's injected writes), the roster mapping in
// domain/assessClassRows, data in dao/assessClass.repo, markup in ui/. See
// docs/refactor/BATCH_D_PLAN.md.

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { useAssessClass } from "./domain/useAssessClass";
import { ClassProgressPanel } from "./ui/ClassProgressPanel";
import { ClassGridSection } from "./ui/ClassGridSection";

export default function AssessClassPage() {
  const s = useAssessClass();

  return (
    <div>
      <PageHeader
        title={s.info?.title ?? "Assess class"}
        subtitle={
          s.info
            ? `${s.info.day_of_week} ${s.info.start_time?.slice(0, 5) ?? ""}${
                s.info.location ? ` · ${s.info.location}` : ""
              }`
            : undefined
        }
        action={
          <Link
            href={`/assessment?since=${s.since}`}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            ← All classes
          </Link>
        }
      />

      <ClassProgressPanel since={s.since} setSince={s.setSince} progress={s.progress} pct={s.pct} />

      <ClassGridSection s={s} />
    </div>
  );
}
