// Constants of the billing engine, moved verbatim out of core.ts
// (EDGE_FUNCTIONS_REFACTOR_PLAN.md B1).

// Attendance statuses that result in a charge to the parent.
// Per PRD 5.4: only Present and Paid Trial are billable.
export const BILLABLE = new Set(["present", "trial_paid"]);

// The batched reads' limits. Why each is what it is: the "Batched reads" block
// beside readPaged (core.ts until B2, then dao/).
export const IN_CHUNK = 100;
export const PAGE = 1000;
