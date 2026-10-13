// Parent Requests — one pending claim: the parent's words beside the roster
// record, so the admin can answer "are these the same child?".

import { Button } from "@/components/Button";
import { PackageChip } from "@/components/PackageChip";
import { formatSgDate } from "@/lib/lessonDates";
import { familyLabel } from "@/lib/packageCoverage";
import type { Claim } from "../types";
import { claimDayLabel, reasonLabel } from "../domain/claimsRows";

type Props = {
  c: Claim;
  contested: boolean;
  busy: string | null;
  pkgByParent: Map<string, number>;
  onApprove: (c: Claim) => void;
  onDecline: (c: Claim) => void;
};

export function PendingClaimCard(p: Props) {
  const { c } = p;
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      {p.contested && (
        <p className="mb-3 rounded-card border border-status-warning-border bg-status-warning-bg px-3 py-2 text-label font-semibold text-status-warning-text">
          More than one parent has asked about this child. Approving one
          declines the others — check carefully which is right.
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {/* What the parent typed */}
        <div>
          <p className="text-label font-medium text-ink-muted">
            The parent says
          </p>
          <p className="mt-1 font-semibold text-ink">{c.claimed_name}</p>
          <p className="text-body text-ink-muted">
            {c.claimed_dob
              ? `Born ${formatSgDate(c.claimed_dob, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}`
              : "No date of birth given"}
          </p>
          <p className="mt-2 text-body text-ink-secondary">
            {c.parent_name}
            <span className="ml-1.5">
              <PackageChip
                coverage={familyLabel(p.pkgByParent, c.parent_id)}
                title={
                  p.pkgByParent.has(c.parent_id)
                    ? "The claimant family's prepaid balance at your business"
                    : "The claimant family holds no prepaid package — billed per lesson by invoice"
                }
              />
            </span>
          </p>
          <p className="text-body text-ink-muted">{c.parent_email}</p>
          <p className="text-body text-ink-muted">
            {c.parent_phone ?? "No phone on file"}
          </p>
          <p className="mt-2 text-label text-ink-muted">
            {c.certainty === "confirmed"
              ? "They said this IS their child"
              : "They said they were NOT SURE"}{" "}
            · asked{" "}
            {claimDayLabel(c.created_at)}
          </p>
        </div>

        {/* What is actually on the roster */}
        <div>
          <p className="text-label font-medium text-ink-muted">
            On your roster
          </p>
          <p className="mt-1 font-semibold text-ink">{c.student_name}</p>
          <p className="text-body text-ink-muted">
            {c.student_dob
              ? `Born ${formatSgDate(c.student_dob, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}`
              : "No date of birth recorded"}
          </p>
          <p className="mt-2 text-body font-medium text-ink-secondary">
            {c.lessons} lesson{c.lessons === 1 ? "" : "s"} recorded
          </p>
          <p className="mt-2 text-label text-ink-muted">
            {reasonLabel(c.match_reason)}
          </p>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <Button onClick={() => p.onApprove(c)} disabled={p.busy === c.id}>
          Approve
        </Button>
        <Button
          variant="outline"
          onClick={() => p.onDecline(c)}
          disabled={p.busy === c.id}
        >
          Not their child
        </Button>
      </div>
    </div>
  );
}
