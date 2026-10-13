"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";

/** The last run's refusal for the month in the picker, as the Billing months
 *  card already holds it (the stored run's `blocking` list) — or null. */
export type GenerateBlockedReason = { monthLabel: string; count: number; onReview: () => void };

/** The invoice generation panel: the month picker + Generate button
 *  (generation slice). The automatic-generation toggle, run day and PayNow
 *  proxy moved to BillingSettingsCard in UI restyle 5.1 (BACKLOG S10).
 *
 *  ⚠ Generate's enabled condition is `generating` and nothing else — the
 *  engine is the authority on whether a month can bill. The Blocked-Action
 *  reason beside it (BACKLOG S4) shows what the LAST RUN said, which the page
 *  already has; it never disables the button (plan 5.1 ⚠ RISK 2: a client-side
 *  precondition that can disable Generate when the server would accept leaves
 *  a business unable to bill, with no recourse). */
export function GenerationPanel({
  genMonth,
  setGenMonth,
  latestBillableMonth,
  generating,
  onGenerate,
  genResult,
  blockedReason = null,
}: {
  genMonth: string;
  setGenMonth: (s: string) => void;
  latestBillableMonth: string;
  generating: boolean;
  onGenerate: () => void;
  genResult: string | null;
  blockedReason?: GenerateBlockedReason | null;
}) {
  return (
    <div className="mb-5 rounded-card border border-border bg-surface p-4">
      <SectionHeading>Generate invoices</SectionHeading>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-label font-medium text-ink-muted mb-1">
            Billing month
          </label>
          {/* Capped at the last COMPLETED month. This is an affordance, not
              the guard — `max` constrains neither a programmatically-set
              value nor every browser, so the engine refuses it too. */}
          <input
            type="month"
            value={genMonth}
            max={latestBillableMonth}
            onChange={(e) => setGenMonth(e.target.value)}
            className="h-9 rounded-control border border-border-strong bg-surface px-3 text-body text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary"
          />
        </div>
        <Button onClick={onGenerate} disabled={generating}>
          <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />
          {generating ? "Generating…" : "Generate Invoices"}
        </Button>
        {blockedReason && (
          <p data-testid="generate-blocked-reason" className="self-center text-body text-status-danger-text">
            Last run for {blockedReason.monthLabel} refused ·{" "}
            {blockedReason.count} lesson{blockedReason.count === 1 ? "" : "s"} unmarked{" "}
            <button
              type="button"
              onClick={blockedReason.onReview}
              className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover"
            >
              → Review
            </button>
          </p>
        )}
      </div>

      <p className="mt-3 text-body-secondary text-ink-secondary">
        Manual generation bills whatever attendance is marked for the chosen
        month (one invoice per parent, across all their children). It ignores
        the automatic on/off switch and never blocks the scheduled run.
      </p>
      {genResult && (
        <p
          className={`mt-2 text-body font-medium ${
            genResult.startsWith("Error") ? "text-status-danger-text" : "text-status-success-text"
          }`}
        >
          {genResult}
        </p>
      )}
    </div>
  );
}
