// The coach My Pay tab's entity type (docs/refactor/BATCH_FGH_PLAN.md, app fence) —
// moved verbatim from app/(coach)/pay/index.tsx.

/** What this coach is owed. Read-only, and only ever their OWN — a colleague's
 *  earnings must not be inferable. RLS scopes it to their coaches.id. */
export type MyPayout = {
  id: string;
  period_month: string;
  gross_amount: number;
  status: "draft" | "paid";
};
