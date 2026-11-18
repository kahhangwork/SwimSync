// test/guards.test.ts — split verbatim out of core.test.ts (EDGE_FUNCTIONS_REFACTOR_PLAN.md B13).
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

Deno.test("auto mode honours the auto_invoice_enabled switch", async () => {
  const s = await newScenario({ billing: monthEnded("2026-04") });
  try {
    const a = await s.addSession("2026-04-18"); await s.mark(a, "present");
    // The switch is PER TENANT now (was a global app_settings row): one school
    // turning automatic billing off must not turn it off for every other
    // business on the platform.
    await s.db
      .from("tenants")
      .update({ auto_invoice_enabled: false })
      .eq("id", s.tenantId);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "auto", billing_month: "2026-04", now: s.now });
    assertEquals(res.status, "auto_disabled");
    // early return before any processing
    assertEquals(res.invoices_created, undefined);
    const inv = await getInvoice(s.db, s.parentId, "2026-04");
    assertEquals(inv, null);
  } finally {
    await s.teardown();   // the tenant row goes with it
  }
});

Deno.test("a suspended tenant gets no invoicing — auto AND manual, even forced", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-05") });
  try {
    const j = await s.addSession("2026-04-03");
    await s.mark(j, "present");
    await s.completeMonth("2026-04");
    // The service-role client passes the tenants guard (it refuses only
    // current_user = 'authenticated') — same door /api/suspend-tenant's RPC
    // uses, minus the audit row this test does not need.
    await s.db
      .from("tenants")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", s.tenantId);

    for (const args of [
      { mode: "auto" as const },
      { mode: "manual" as const, force: true },
    ]) {
      const res = await generateInvoices(s.db, {
        tenant_id: s.tenantId, billing_month: "2026-04", now: s.now, ...args });
      assertEquals(res.status, "tenant_suspended");
      assertEquals(res.invoices_created, undefined);
    }
    const inv = await getInvoice(s.db, s.parentId, "2026-04");
    assertEquals(inv, null);
  } finally {
    await s.teardown();
  }
});

// ── Configurable run day ───────────────────────────────────────────────────
// The automatic path waits until the BUSINESS's run day (tenants.invoice_run_day;
// the global app_settings key is dead since 2026-09-24). Manual runs ignore it
// entirely. ⚠ No test here writes app_settings — the row is shared by every
// scenario and every sibling session (ENGINE_TENANT_RUN_DAY_PLAN.md, RISK 4). `now` is injected so these do not depend on the actual
// day of the month.

Deno.test("run day: auto run before the configured day generates nothing", async () => {
  // enrolledAt at the billing month so earlier months are genuinely empty — an
  // enrolment defaulting to now() with a far-future billing month leaves the
  // intervening months unmarked, which the ordering-guard correctly blocks on.
  const s = await newScenario({ price: 30, enrolledAt: "2027-03-01" });
  try {
    const a = await s.addSession("2027-03-06"); await s.mark(a, "present");

    // 3 April, run day 7 -> too early.
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-03",
      now: new Date("2027-04-03T02:00:00Z"),
    });

    assertEquals(res.status, "before_run_day");
    assertEquals(await getInvoice(s.db, s.parentId, "2027-03"), null);

    const { data: sealed } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", "2027-03")
      .maybeSingle();
    assertEquals(sealed, null); // must not seal a month it declined to bill
  } finally {
    await s.teardown();
  }
});

Deno.test("run day: auto run on the configured day generates normally", async () => {
  const s = await newScenario({ price: 30, enrolledAt: "2027-04-01" });
  try {
    const a = await s.addSession("2027-04-03"); await s.mark(a, "present");
    await s.completeMonth("2027-04", undefined, new Date("2027-05-07T02:00:00Z")); // the month's other Saturdays rained off

    // 7 May, run day 7 -> due today (boundary: >= not >).
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-04",
      now: new Date("2027-05-07T02:00:00Z"),
    });

    assertEquals(res.invoices_created, 1);
    assertEquals((await getInvoice(s.db, s.parentId, "2027-04"))!.gross, 30);
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2027-04");
    await s.teardown();
  }
});

Deno.test("run day: a MANUAL run before the day generates anyway", async () => {
  // The admin pressing Generate is an explicit instruction — a schedule meant
  // for the unattended cron must never block it.
  const s = await newScenario({ price: 30, enrolledAt: "2027-05-01" });
  try {
    const a = await s.addSession("2027-05-01"); await s.mark(a, "present");
    await s.completeMonth("2027-05", undefined, new Date("2027-06-01T02:00:00Z"));

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual",
      force: true,
      billing_month: "2027-05",
      now: new Date("2027-06-01T02:00:00Z"), // day 1, well before day 7
    });

    assertEquals(res.invoices_created, 1);
    assertEquals((await getInvoice(s.db, s.parentId, "2027-05"))!.gross, 30);
  } finally {
    await s.teardown();
  }
});

Deno.test("run day: honours a changed setting, and SGT decides the day", async () => {
  const s = await newScenario({ price: 30, enrolledAt: "2027-06-01" });
  try {
    const a = await s.addSession("2027-06-05"); await s.mark(a, "present");
    await s.completeMonth("2027-06", undefined, new Date("2027-07-14T17:00:00Z"));
    // The BUSINESS's run day — its own tenant, so nothing to restore.
    await s.db
      .from("tenants")
      .update({ invoice_run_day: 15 })
      .eq("id", s.tenantId);

    // Day 14 in SGT -> still too early for a run day of 15.
    const early = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-06",
      now: new Date("2027-07-14T02:00:00Z"),
    });
    assertEquals(early.status, "before_run_day");

    // 14 Jul 17:00 UTC is already the 15th in Singapore — the guard must read
    // the SGT day, not the UTC one, or it fires a day late every month.
    const due = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2027-06",
      now: new Date("2027-07-14T17:00:00Z"),
    });
    assertEquals(due.invoices_created, 1);
  } finally {
    // teardown() deletes this tenant's billing_periods; no month-wide delete.
    await s.teardown();
  }
});

// ⚠ RISK 1 (ENGINE_TENANT_RUN_DAY_PLAN.md): TWO tests in OPPOSITE directions.
// The old code read the shared global key; one test alone passes on the old
// code whenever that key happens to sit on the right side of `today`. 2a fails
// the old code for any global <= 10, 2b for any global > 5 — together, always.
// Months 2028-05/06 are used by no other Deno test.

Deno.test("run day: reads the BUSINESS's run day — later than the global one", async () => {
  const s = await newScenario({ price: 30, enrolledAt: "2028-05-01" });
  const now = new Date("2028-06-10T02:00:00Z"); // SGT day 10
  try {
    const a = await s.addSession("2028-05-06"); await s.mark(a, "present");
    await s.completeMonth("2028-05", undefined, now);
    await s.db
      .from("tenants")
      .update({ invoice_run_day: 15 })
      .eq("id", s.tenantId);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2028-05",
      now,
    });

    assertEquals(res.status, "before_run_day");
    assertEquals(await getInvoice(s.db, s.parentId, "2028-05"), null);
    const { data: sealed } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("tenant_id", s.tenantId)
      .eq("billing_month", "2028-05")
      .maybeSingle();
    assertEquals(sealed, null); // declined to bill -> must not seal
  } finally {
    await s.teardown();
  }
});

Deno.test("run day: reads the BUSINESS's run day — earlier than the global one", async () => {
  const s = await newScenario({ price: 30, enrolledAt: "2028-06-01" });
  const now = new Date("2028-07-05T02:00:00Z"); // SGT day 5
  try {
    const a = await s.addSession("2028-06-03"); await s.mark(a, "present");
    await s.completeMonth("2028-06", undefined, now);
    await s.db
      .from("tenants")
      .update({ invoice_run_day: 3 })
      .eq("id", s.tenantId);

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "auto",
      billing_month: "2028-06",
      now,
    });

    assertEquals(res.invoices_created, 1);
    assertEquals((await getInvoice(s.db, s.parentId, "2028-06"))!.gross, 30);
  } finally {
    await s.teardown();
  }
});

// ⚠ RISK 2: a tenant whose settings cannot be read must FAIL CLOSED in auto
// mode — a default run day there is an early bill that then seals the month.
// A non-existent tenant is the cheap way to make the read come back empty.
Deno.test("run day: auto run for an unreadable business skips, never defaults", async () => {
  const db = svc();
  const ghost = crypto.randomUUID();
  const res = await generateInvoices(db, {
    tenant_id: ghost,
    mode: "auto",
    billing_month: "2028-05",
    now: new Date("2028-06-20T02:00:00Z"), // past every possible run day
  });

  assertEquals(res.status, "tenant_unreadable");
  const { data: sealed } = await db
    .from("billing_periods")
    .select("billing_month")
    .eq("tenant_id", ghost);
  assertEquals(sealed ?? [], []);
});

Deno.test("an IN-PROGRESS month is refused outright, and nothing is sealed", async () => {
  // REPLACES "a future lesson in the CURRENT month is not a gap", which billed
  // an in-progress month deliberately and asserted it succeeded. That is now
  // exactly what must NOT happen, and the old behaviour was the bug:
  //
  //   The completeness window clamps to today (core.ts), so a mid-month run
  //   saw only the lessons that had already happened, judged the month
  //   COMPLETE, billed them — and SEALED the month. Every remaining lesson was
  //   then permanently unbillable: later runs short-circuit on the seal, and
  //   the already-exists guard skips the parent even if it is reopened.
  //
  // The clamp itself is kept in core.ts as defence in depth but is now
  // unreachable on the billing path, which is why it has no test of its own.
  const now = new Date("2026-01-15T02:00:00Z"); // Thu 15 Jan SGT — mid-month
  const s = await newScenario({ price: 30, billing: monthEnded("2026-01") });
  try {
    // Saturdays up to the 15th: 3, 10. The 17/24/31 have not happened yet.
    for (const d of ["2026-01-03", "2026-01-10"]) {
      const id = await s.addSession(d);
      await s.mark(id, "present");
    }

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId,
      mode: "manual", force: false, billing_month: "2026-01", now });

    assertEquals(res.status, "month_not_ended");
    assertEquals(await getInvoice(s.db, s.parentId, "2026-01"), null);

    // The seal is the irreversible half — assert it explicitly.
    const { data: period } = await s.db
      .from("billing_periods")
      .select("billing_month")
      .eq("billing_month", "2026-01")
      .eq("tenant_id", s.tenantId)
      .maybeSingle();
    assertEquals(period, null, "an in-progress month must never be sealed");
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2026-01");
    await s.teardown();
  }
});

// ── The completed-month guard ───────────────────────────────────────────────
// A billing month may only be billed once it has ENDED. Until this guard
// existed the engine validated only the YYYY-MM *format*, so a mid-month run
// billed the lessons so far and SEALED the month, stranding the rest forever.
//
// The guard is a month-boundary clock computation, which is the code family
// that has shipped bugs here twice (§7.7 UTC/SGT day boundary, §7.12
// UTC-derived billing month). The boundary cases below are therefore the point
// of this block, not decoration — especially "first instant", where the SGT
// date and the UTC date disagree and a naive implementation refuses a month
// that is genuinely due.

Deno.test("guard: the current month is refused, in BOTH modes and under force", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-05") });
  try {
    const mid = new Date("2027-05-15T02:00:00Z"); // 15 May SGT — month in progress
    for (const opts of [
      { mode: "manual", force: false },
      { mode: "manual", force: true }, // force must NOT bypass this
      { mode: "auto", force: false },
      { mode: "auto", force: true },
    ]) {
      const res = await generateInvoices(s.db, {
        tenant_id: s.tenantId, billing_month: "2027-05", now: mid, ...opts,
      });
      assertEquals(
        res.status,
        "month_not_ended",
        `${opts.mode} force=${opts.force} should refuse an in-progress month`,
      );
      assertEquals(res.invoices_created, undefined); // returned before any work
    }
  } finally {
    await s.teardown();
  }
});

Deno.test("guard: a FUTURE month is refused", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2027-05") });
  try {
    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2028-01", now: new Date("2027-05-15T02:00:00Z"),
    });
    assertEquals(res.status, "month_not_ended");
  } finally {
    await s.teardown();
  }
});

Deno.test("guard: THE BOUNDARY — July is refused at 23:59 SGT on 31 Jul, allowed at 00:00 SGT on 1 Aug", async () => {
  // The row that matters. 00:00 SGT on 1 August is 16:00 UTC on 31 JULY, so an
  // implementation reading UTC calendar fields computes "previous month = June"
  // and refuses July — the month that has just become due. That is §7.12
  // restated: the engine runs in UTC and the business runs in SGT.
  const s = await newScenario({ price: 30, billing: monthEnded("2026-07") });
  try {
    const a = await s.addSession("2026-07-04"); await s.mark(a, "present");
    await s.completeMonth("2026-07");

    // One minute BEFORE the month ends, in SGT.
    const lastInstant = monthEnded("2026-07", { at: "not-yet-ended" });
    const before = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2026-07", now: lastInstant.now,
    });
    assertEquals(before.status, "month_not_ended", "23:59 SGT on 31 Jul is still July");

    // The very first instant it is billable.
    const firstInstant = monthEnded("2026-07", { at: "first-instant" });
    const after = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true,
      billing_month: "2026-07", now: firstInstant.now,
    });
    assertEquals(after.invoices_created, 1, "00:00 SGT on 1 Aug must bill July");
    assertEquals((await getInvoice(s.db, s.parentId, "2026-07", s.tenantId))!.gross, 30);
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2026-07");
    await s.teardown();
  }
});

Deno.test("guard: the year rollover — December is billable at 00:00 SGT on 1 January", async () => {
  const s = await newScenario({ price: 30, billing: monthEnded("2026-12") });
  try {
    const a = await s.addSession("2026-12-05"); await s.mark(a, "present");
    await s.completeMonth("2026-12");

    const res = await generateInvoices(s.db, {
      tenant_id: s.tenantId, mode: "manual", force: true, billing_month: "2026-12",
      now: monthEnded("2026-12", { at: "first-instant" }).now, // 1 Jan 2027 00:00 SGT
    });
    assertEquals(res.invoices_created, 1);
  } finally {
    await s.db.from("billing_periods").delete().eq("billing_month", "2026-12");
    await s.teardown();
  }
});
