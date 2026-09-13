// Parent Requests — one pending claim: the parent's words beside the roster
// record, so the admin can answer "are these the same child?".

import { Button } from "@/components/Button";
import { PackageChip } from "@/components/PackageChip";
import { formatSgDate } from "@/lib/lessonDates";
import { familyLabel } from "@/lib/packageCoverage";
import type { Claim } from "../types";
import { reasonLabel } from "../domain/claimsRows";

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
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {p.contested && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          More than one parent has asked about this child. Approving one
          declines the others — check carefully which is right.
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {/* What the parent typed */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            The parent says
          </p>
          <p className="mt-1 font-semibold text-gray-900">{c.claimed_name}</p>
          <p className="text-sm text-gray-500">
            {c.claimed_dob
              ? `Born ${formatSgDate(c.claimed_dob, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}`
              : "No date of birth given"}
          </p>
          <p className="mt-2 text-sm text-gray-700">
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
          <p className="text-sm text-gray-500">{c.parent_email}</p>
          <p className="text-sm text-gray-500">
            {c.parent_phone ?? "No phone on file"}
          </p>
          <p className="mt-2 text-xs text-gray-400">
            {c.certainty === "confirmed"
              ? "They said this IS their child"
              : "They said they were NOT SURE"}{" "}
            · asked{" "}
            {formatSgDate(c.created_at.slice(0, 10), {
              day: "numeric",
              month: "short",
            })}
          </p>
        </div>

        {/* What is actually on the roster */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            On your roster
          </p>
          <p className="mt-1 font-semibold text-gray-900">{c.student_name}</p>
          <p className="text-sm text-gray-500">
            {c.student_dob
              ? `Born ${formatSgDate(c.student_dob, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}`
              : "No date of birth recorded"}
          </p>
          <p className="mt-2 text-sm font-medium text-gray-700">
            {c.lessons} lesson{c.lessons === 1 ? "" : "s"} recorded
          </p>
          <p className="mt-2 text-xs text-gray-400">
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
