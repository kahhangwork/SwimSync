"use client";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { useMakeups } from "./domain/useMakeups";
import { PastUnmarkedPanel } from "./ui/PastUnmarkedPanel";
import { UpcomingTable } from "./ui/UpcomingTable";
import { BookMakeupModal } from "./ui/BookMakeupModal";

/**
 * Make-ups — an ENROLLED child guesting into one lesson of ANOTHER class in
 * the same category, to make up a missed lesson (rain, illness, a parent
 * cancellation). The mirror of Trials: a trial is for a child not yet in a
 * class; a make-up is for a child already in one.
 *
 * A make-up is NOT an enrolment and NOT attendance. Booking says only "this
 * child is expected at this one lesson"; the coach marks them like anyone
 * else. A package family's attended make-up draws from the package; an ad-hoc
 * family pays their OWN class's price for it, not the host's.
 *
 * WHY A PAGE rather than a button on Students: a booking you cannot see is a
 * booking you forget, and a forgotten one HOLDS THE BILLING MONTH OPEN. The
 * "Past — needs marking" list is the important half of this screen. *
 * Composition only (Admin L-D): state + loads + writes in domain/useMakeups,
 * the row mapping and the form's derived values in domain/makeupRows, data in
 * dao/makeups.{repo,rpc}, markup in ui/. See docs/refactor/BATCH_D_PLAN.md.
 */

export default function MakeupsPage() {
  const m = useMakeups();

  if (m.loading) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <PageHeader
        title="Make-ups"
        subtitle="A child joining another class for one lesson, to make up a missed one"
        action={<Button onClick={() => m.setBookOpen(true)}>Book a make-up</Button>}
      />

      {/* ── Past and unmarked: the half that matters ───────────────────────── */}
      <PastUnmarkedPanel m={m} />

      <UpcomingTable m={m} />

      <p className="mt-4 max-w-2xl text-xs text-gray-500">
        A make-up stays in the child&apos;s own kind of class — group with
        group, private with private. If the family has a prepaid package, the
        attended make-up draws from it; otherwise it bills at the child&apos;s
        own class price. To repeat a lesson with the child&apos;s <em>own</em>{" "}
        class on another day, use <strong>Extra lesson</strong> on the{" "}
        <Link href="/classes" className="font-semibold text-blue-600 hover:underline">
          Classes
        </Link>{" "}
        page instead.
      </p>

      {/* ── Book ───────────────────────────────────────────────────────────── */}
      <BookMakeupModal m={m} />
    </div>
  );
}
