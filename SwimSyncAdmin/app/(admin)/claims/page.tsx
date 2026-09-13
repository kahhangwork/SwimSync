"use client";

import { PageHeader } from "@/components/PageHeader";
import { useClaims } from "./domain/useClaims";
import { PendingClaimCard } from "./ui/PendingClaimCard";
import { DecidedClaims } from "./ui/DecidedClaims";
import { ApproveClaimModal } from "./ui/ApproveClaimModal";

/**
 * Parent Requests — a parent saying "I think that child on your roster is mine".
 *
 * ⚠ APPROVING IS THE HIGHEST-BLAST-RADIUS ACTION IN THE ADMIN PANEL.
 * It attaches a parent account to a child, which hands them that child's
 * attendance, invoices and payment history. So this page is built around
 * giving the admin enough to actually decide, rather than around making the
 * decision fast:
 *
 *   • the parent's own words are shown NEXT TO the roster record, because the
 *     question is "are these the same child?" and one of the two alone cannot
 *     answer it;
 *   • the full name and date of birth are shown here — unlike the parent's
 *     side, which sees a masked version. The admin is entitled to their own
 *     business's data; the parent is not, until this is approved;
 *   • the lesson count is shown, because it is what makes the decision matter;
 *   • Approve is a two-step confirm naming BOTH parties.
 *
 * A parent with a pending request is BLOCKED from adding that child, so an
 * undecided queue is a family stuck at the door. Nothing emails the admin
 * about it — the sidebar badge is the whole notification.
 */
export default function ClaimsPage() {
  const p = useClaims();

  if (p.loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <PageHeader
        title="Parent Requests"
        subtitle="Parents asking to be linked to a child already on your roster"
      />

      {p.error && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">{p.error}</p>
        </div>
      )}

      {p.pending.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">Nothing waiting.</p>
          <p className="mt-1 text-xs text-gray-400">
            When a parent adds a child who looks like one already on your
            roster, their request appears here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {p.pending.map((c) => (
            <PendingClaimCard
              key={c.id}
              c={c}
              contested={p.contested.has(c.student_id)}
              busy={p.busy}
              pkgByParent={p.pkgByParent}
              onApprove={p.setConfirming}
              onDecline={p.decline}
            />
          ))}
        </div>
      )}

      <DecidedClaims
        decided={p.decided}
        showDecided={p.showDecided}
        setShowDecided={p.setShowDecided}
        busy={p.busy}
        onUndo={p.undo}
      />

      <ApproveClaimModal
        confirming={p.confirming}
        onClose={() => p.setConfirming(null)}
        nameChoice={p.nameChoice}
        setNameChoice={p.setNameChoice}
        busy={p.busy}
        onApprove={p.approve}
      />
    </div>
  );
}
