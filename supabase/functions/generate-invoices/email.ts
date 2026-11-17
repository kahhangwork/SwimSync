// Facade (EDGE_FUNCTIONS_REFACTOR_PLAN.md B10): index.ts, bench/run.ts and the tests
// import the invoice-email API from here. Re-exports only — the code lives in
// domain/emailTemplates.ts (pure) and domain/emailDelivery.ts (send, claim, settle).

export * from "./domain/emailTemplates.ts";
export * from "./domain/emailDelivery.ts";
