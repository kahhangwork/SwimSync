// The five-step status scale (DESIGN.md → Colors → Status scale): which TONE a
// status word is shown in. One meaning per colour, in all three apps.
// TWIN FILE: SwimSyncAdmin/lib/statusTone.ts is identical apart from this line.
//
//   neutral  nothing to do yet          (Absent, Inactive, Not run yet)
//   info     waiting on someone else    (Claimed, Pending, Reserved)
//   warning  needs doing soon           (Outstanding — i.e. Due, Unassigned)
//   danger   stuck or overdue           (Overdue, Failed)
//   success  done                       (Paid, Present, Closed)
//
// Red is ONLY for stuck (DESIGN's Red Means Stuck Rule): a plain unpaid invoice
// within its month is amber. This file maps WORDS; the colour classes live in
// each app's components/ui/Tag, because the app's Tailwind does not scan lib/ (a
// class string here would be purged with no error — §7.191's trap).
//
// "Due" vs "Overdue": there is NO due-date source (no due_date column, none in
// the PRD — checked 2026-10-11), so an unpaid invoice is "Outstanding" = Due,
// amber. "Overdue" is a key for the day one exists; never derive it in a client
// from a month or an invoice's age — that is a business rule, not a style.
//
// Matching is on the word before any qualifier — "Cancelled (Rain)" and
// "Void · duplicate" take Cancelled's and Void's tones. An unknown word is
// neutral: never invent urgency.

export type StatusTone = "neutral" | "info" | "warning" | "danger" | "success";

const TONES: Record<string, StatusTone> = {
  // success — done
  Paid: "success",
  Present: "success",
  Assigned: "success",
  Active: "success",
  Converted: "success",
  Applied: "success",
  "Credit Applied": "success",
  Used: "success",
  Closed: "success",
  Marked: "success",
  Approved: "success",
  "Nothing to bill": "success",
  // info — waiting on someone else
  Claimed: "info",
  Pending: "info",
  Reserved: "info",
  Trial: "info",
  // warning — needs doing soon
  Outstanding: "warning",
  Due: "warning",
  Unassigned: "warning",
  "Not billed yet": "warning",
  Open: "warning",
  // danger — stuck or overdue
  Overdue: "danger",
  Failed: "danger",
  // neutral — everything else is spelled out so a reader sees it was decided
  Absent: "neutral",
  Cancelled: "neutral",
  "Public Holiday": "neutral",
  Inactive: "neutral",
  Disabled: "neutral",
  Void: "neutral",
  Reversed: "neutral",
  Available: "neutral",
  Expired: "neutral",
  "Not Marked": "neutral",
  "Not run yet": "neutral",
  Declined: "neutral",
  Withdrawn: "neutral",
};

/** The word's DECIDED tone (its own key, or its head word's before a qualifier),
 *  or undefined when nobody decided it — the neutral fallback is a safety net,
 *  not a decision. statusTone.test.ts requires every rendered word to have one. */
export function knownTone(status: string): StatusTone | undefined {
  // Own keys only: a plain object answers "toString" / "constructor" with a function.
  const own = (k: string) => (Object.prototype.hasOwnProperty.call(TONES, k) ? TONES[k] : undefined);
  return own(status) ?? own(status.split(/ \(| · /)[0]);
}

export function statusTone(status: string): StatusTone {
  return knownTone(status) ?? "neutral";
}
