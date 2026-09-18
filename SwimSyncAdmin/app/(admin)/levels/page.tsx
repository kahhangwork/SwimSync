"use client";

// This business's swimming-level ladder.
//
// Replaces the fixed beginner/intermediate/advanced enum, which was never
// populated and was never the right shape — a ladder is a business's own
// vocabulary ("Seahorse", "SwimSafer Level 3"), not a three-way split SwimSync
// chooses for everyone. Until now the CLASS NAME carried the level, which works
// for one coach with four classes and stops the moment anyone wants to track
// progress WITHIN a class.
//
// ORDER IS THE POINT. A ladder sorted alphabetically puts "Advanced" above
// "Beginner", which is why sort_order exists and why this page lets it be set
// rather than inferring it from the label.
//
// Levels are per business (RLS scopes every query here), and a student may only
// be given a level from their own business — enforced in the database, since no
// single-row policy can see across that reference.//
// Composition only (Admin L-D): state + loads + writes in domain/useLevels, the
// ladder mapping in domain/levelRows, the grade-scale helpers in
// domain/skillScale, data in dao/levels.repo, markup in ui/. See
// docs/refactor/BATCH_D_PLAN.md.

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { useLevels } from "./domain/useLevels";
import { LevelsTable } from "./ui/LevelsTable";
import { LevelFormModal } from "./ui/LevelFormModal";
import { RemoveLevelModal } from "./ui/RemoveLevelModal";
import { GradeScaleModal } from "./ui/GradeScaleModal";

export default function LevelsPage() {
  const lv = useLevels();

  return (
    <div>
      <PageHeader
        title="Swimming Levels"
        subtitle="Your own level ladder. Students are placed on it from the Students page."
      />

      <div className="mb-4 flex gap-2">
        <Button onClick={lv.openCreate}>Add level</Button>
        <Button variant="outline" onClick={() => { lv.setScaleError(null); lv.setScaleOpen(true); }}>
          Grading scale
        </Button>
      </div>

      {/* A one-line hint at what the scale is for, shown only once a scale
          exists (it always does — seeded per business). */}
      {lv.gradeScale.length > 0 ? (
        <p className="mb-4 text-xs text-gray-500">
          Coaches grade each child&rsquo;s skills on your{" "}
          <span className="font-medium text-gray-700">
            {lv.gradeScale.map((g) => g.label).join(" → ")}
          </span>{" "}
          scale. The top grade counts a skill as done.
        </p>
      ) : null}

      <LevelsTable l={lv} />

      <LevelFormModal l={lv} />

      <RemoveLevelModal l={lv} />

      {/* ── Grade scale editor (see ui/GradeScaleModal for why it lives here) ── */}
      <GradeScaleModal l={lv} />
    </div>
  );
}
