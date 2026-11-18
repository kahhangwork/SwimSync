// test/fixtureGuard.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
// Integration tests for the billing engine (core.ts) against the local
// Supabase stack. Run with ./test.sh (or export SERVICE_ROLE_KEY first, then
// `deno test --allow-net --allow-env core.test.ts`). Requires `supabase start`.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { generateInvoices } from "../core.ts";
import { emailCreatedInvoices, retryUnsentInvoiceEmails } from "../domain/emailDelivery.ts";
import {
  newScenario,
  monthEnded,
  getInvoice,
  checkInvariants,
  svc,
} from "./helpers.ts";

// THE CLOCK IS PART OF THE FIXTURE, NOT AN AFTERTHOUGHT.
// The engine refuses a billing month that has not ended, so every test that
// bills a month must say when it is running. `monthEnded("YYYY-MM")` supplies
// the month, a clock at which it is billable, and an enrolment date early
// enough for the whole month's lessons to derive — as one inseparable fact.
// Pass `now: s.now` to generateInvoices; never re-derive a date at the call
// site. See test/helpers.ts for why (short version: `docs/GOTCHAS.md` §7.25).

Deno.test("fixture guard: a scenario that expects NO lessons is refused at construction", async () => {
  // The structural half of the test-suite fix. A fixture whose clock and month
  // yield zero expected lessons makes the completeness gate vacuously true, so
  // the test passes without exercising anything (§7.17 inside §7.25). This is
  // enforced rather than reviewed for, and this test is what proves it enforced.
  await assertRejects(
    () =>
      newScenario({
        price: 30,
        billing: monthEnded("2026-01"),
        enrolledAt: "2026-03-01", // starts AFTER the billing month — nothing is due
      }),
    Error,
    "vacuous fixture",
  );
});
