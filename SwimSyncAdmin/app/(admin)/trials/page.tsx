"use client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { useTrials } from "./domain/useTrials";
import { UnpricedNotice } from "./ui/UnpricedNotice";
import { PastUnmarkedPanel } from "./ui/PastUnmarkedPanel";
import { UpcomingTable } from "./ui/UpcomingTable";
import { TrialPricesSection } from "./ui/TrialPricesSection";
import { BookTrialModal } from "./ui/BookTrialModal";
import { ConvertTrialModal } from "./ui/ConvertTrialModal";

/**
 * Trials — booking a child into ONE lesson, and what a trial costs.
 *
 * A trial is NOT an enrolment and NOT attendance. Booking says only "this child
 * is expected at this lesson"; the coach then marks them like anyone else, and
 * the status they choose decides what the family is charged.
 *
 * WHY THIS PAGE EXISTS AT ALL rather than a button tucked onto Students: a
 * booking you cannot see is a booking you forget, and a forgotten one now HOLDS
 * THE BILLING MONTH OPEN. The "Past — needs marking" list is the important half
 * of this screen. *
 * Composition only (Admin L-D): state + loads + writes in domain/useTrials, the
 * row mapping + lesson dates in domain/trialRows, the Convert guard in
 * domain/trialConvert, data in dao/trials.{repo,rpc}, markup in ui/. See
 * docs/refactor/BATCH_D_PLAN.md.
 */

export default function TrialsPage() {
  const t = useTrials();

  if (t.loading) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <PageHeader
        title="Trials"
        subtitle="A child trying one lesson, before they join a class"
        action={<Button onClick={() => t.setBookOpen(true)}>Book a trial</Button>}
      />

      {/* ── The reminder (see ui/UnpricedNotice) ─────────────────────────── */}
      <UnpricedNotice t={t} />

      {/* ── Past and unmarked: the half that matters ───────────────────────── */}
      <PastUnmarkedPanel t={t} />

      <UpcomingTable t={t} />

      {/* ── Trial prices ───────────────────────────────────────────────────── */}
      <TrialPricesSection t={t} />

      {/* ── Book ───────────────────────────────────────────────────────────── */}
      <BookTrialModal t={t} />

      {/* ── Convert a trial to an enrolment ─────────────────────────────────── */}
      <ConvertTrialModal t={t} />
    </div>
  );
}
