// Tests for the engine ordering-guard (orderingGuard.ts) — Item 1 of
// docs/plans/CREDIT_NOTE_AND_MARKABLE_FLOOR_PLAN.md.
//
// The property (P1–P4) over three consecutive months and the named cases (cron
// shape, force does not bypass, two-tenant isolation) plus the §7.18 cross-check
// that the guard's verdict matches the ENGINE's own complete/incomplete verdict.
//
// RED-PROOF (§7.25): the block assertions (P1 arm 1, P1 arm 2, cron, force,
// isolation) FAIL against the engine WITHOUT the guard — it seals the later month
// and strands the earlier one, so `status` is "complete — billing month sealed",
// not "earlier_month_unbilled". Proven by commenting out the guard call in
// core.ts and running this file: those tests go red. Recorded in the fork report.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateInvoices } from "./core.ts";
import { computeMarkableFloor } from "./orderingGuard.ts";
import { newScenario, type Scenario } from "./test-helpers.ts";

// One clock for the whole file (§7.33): 10:08 SGT on 8 Apr 2027, so
// previousBillingMonth(CLOCK) = 2027-03 and months 2027-01..2027-03 are all
// ended and billable.
const CLOCK = new Date("2027-04-08T02:00:00Z");
const M1 = "2027-01";
const M2 = "2027-02";
const M3 = "2027-03";
// A present Saturday in each month (the class defaults to Saturdays).
const PRESENT_DATE: Record<string, string> = {
  [M1]: "2027-01-02",
  [M2]: "2027-02-06",
  [M3]: "2027-03-06",
};

/** Seed a COMPLETE, BILLABLE month: one present lesson + the rest rained off. */
async function seedBillable(s: Scenario, month: string): Promise<void> {
  const sid = await s.addSession(PRESENT_DATE[month]);
  await s.mark(sid, "present");
  await s.completeMonth(month, undefined, CLOCK);
}

/** Seed a COMPLETE month with NOTHING billable — every expected lesson cancelled. */
async function seedAllCancelled(s: Scenario, month: string): Promise<void> {
  await s.completeMonth(month, undefined, CLOCK);
}

function bill(
  s: Scenario,
  month: string | undefined,
  opts: { mode?: string; force?: boolean } = {}
) {
  return generateInvoices(s.db, {
    tenant_id: s.tenantId,
    mode: opts.mode ?? "manual",
    force: opts.force ?? false,
    ...(month ? { billing_month: month } : {}),
    now: CLOCK,
  });
}

async function isSealed(s: Scenario, month: string): Promise<boolean> {
  const { data } = await s.db
    .from("billing_periods")
    .select("billing_month")
    .eq("tenant_id", s.tenantId)
    .eq("billing_month", month)
    .maybeSingle();
  return data !== null;
}

// ── computeMarkableFloor — the SQL markable_floor() replicated ────────────────
// service_role cannot EXECUTE the DB function, so the engine recomputes it;
// these pin it to the SQL semantics (LEAST(1st of last month, COALESCE(month
// after latest seal, created_at))).

Deno.test("floor: nothing sealed → LEAST(calendar floor, created_at)", () => {
  // now 2027-04-08 → calendar floor = 1st of last month = 2027-03-01.
  // created_at earlier → it wins.
  assertEquals(computeMarkableFloor(CLOCK, [], "2026-08-01"), "2026-08-01");
  // created_at LATER than the calendar floor → calendar floor wins.
  assertEquals(computeMarkableFloor(CLOCK, [], "2027-03-20"), "2027-03-01");
});

Deno.test("floor: one seal → month after it, when earlier than the calendar", () => {
  // max seal 2027-01 → month after = 2027-02-01, earlier than 2027-03-01.
  assertEquals(computeMarkableFloor(CLOCK, ["2027-01"], "2026-08-01"), "2027-02-01");
});

Deno.test("floor: seal term never exceeds the calendar floor (LEAST)", () => {
  // max seal 2027-02 → month after = 2027-03-01 == calendar floor.
  assertEquals(computeMarkableFloor(CLOCK, ["2027-01", "2027-02"], "2026-08-01"), "2027-03-01");
  // A seal in the current/last month cannot push the floor PAST the calendar.
  assertEquals(computeMarkableFloor(CLOCK, ["2027-03"], "2026-08-01"), "2027-03-01");
});

// ── P1 (blocks) ──────────────────────────────────────────────────────────────

Deno.test("P1 arm 1: an earlier BILLABLE unsealed month blocks, names the earliest", async () => {
  const s = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  try {
    await seedBillable(s, M1); // present, complete — but NOT billed
    await seedBillable(s, M3);
    const res = await bill(s, M3, { force: true });
    assertEquals(res.status, "earlier_month_unbilled");
    assertEquals(res.earlier_unbilled_month, M1); // earliest, though M2 also blocks
    assertEquals(res.invoices_created ?? 0, 0);
    assertEquals(await isSealed(s, M3), false); // nothing sealed on a refusal
  } finally {
    await s.teardown();
  }
});

Deno.test("P1 arm 2: an earlier UNMARKED month (>= floor) blocks, names it", async () => {
  const s = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  try {
    await seedBillable(s, M1);
    await bill(s, M1, { force: true }); // seal M1 → floor becomes 2027-02-01
    assertEquals(await isSealed(s, M1), true);
    // M2 left entirely unmarked (enrolment active, no sessions) — incomplete.
    await seedBillable(s, M3);
    const res = await bill(s, M3, { force: true });
    assertEquals(res.status, "earlier_month_unbilled");
    assertEquals(res.earlier_unbilled_month, M2);
    assertEquals(await isSealed(s, M3), false);
  } finally {
    await s.teardown();
  }
});

// ── P2 (skips) ───────────────────────────────────────────────────────────────

Deno.test("P2: an earlier ALL-CANCELLED month does NOT block (skippable)", async () => {
  const s = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  try {
    await seedBillable(s, M1);
    await bill(s, M1, { force: true }); // seal M1
    await seedAllCancelled(s, M2); // complete, nothing billable, never sealed
    await seedBillable(s, M3);
    const res = await bill(s, M3, { force: true });
    assertEquals(res.status, "complete — billing month sealed");
    assertEquals(await isSealed(s, M3), true);
    assertEquals(await isSealed(s, M2), false); // it was skippable, not sealed
  } finally {
    await s.teardown();
  }
});

Deno.test("P2: an EMPTY month before the enrolment does not block", async () => {
  // Enrol only from M2, so M1 is entirely before the customer existed — the
  // production shape (a month with no lessons is not a gap).
  const s = await newScenario({ price: 30, enrolledAt: `${M2}-01` });
  try {
    await seedBillable(s, M2);
    await bill(s, M2, { force: true }); // in order, M1 empty → no block
    assertEquals(await isSealed(s, M2), true);
    await seedBillable(s, M3);
    const res = await bill(s, M3, { force: true });
    assertEquals(res.status, "complete — billing month sealed");
  } finally {
    await s.teardown();
  }
});

// ── P3 (releases) ────────────────────────────────────────────────────────────

Deno.test("P3: billing the blocker releases the later month", async () => {
  const s = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  try {
    await seedBillable(s, M1);
    await bill(s, M1, { force: true }); // seal M1 → floor 2027-02-01
    await seedBillable(s, M3);
    // M2 unmarked → M3 blocked.
    assertEquals((await bill(s, M3, { force: true })).earlier_unbilled_month, M2);
    // Mark and bill M2.
    await seedBillable(s, M2);
    const m2 = await bill(s, M2, { force: true });
    assertEquals(m2.status, "complete — billing month sealed");
    // Now M3 flows.
    const m3 = await bill(s, M3, { force: true });
    assertEquals(m3.status, "complete — billing month sealed");
    assertEquals(await isSealed(s, M3), true);
  } finally {
    await s.teardown();
  }
});

// ── P4 (floor corollary) — in-order billing is byte-identical, never strands ──

Deno.test("P4/RISK3: in-order billing is unaffected — each month seals cleanly", async () => {
  const s = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  try {
    for (const m of [M1, M2, M3]) {
      await seedBillable(s, m);
      const res = await bill(s, m, { force: true });
      assertEquals(res.status, "complete — billing month sealed", `month ${m}`);
      assertEquals(await isSealed(s, m), true);
    }
  } finally {
    await s.teardown();
  }
});

Deno.test("RISK3 prod-shape: one sealed month, then the next in order — no block", async () => {
  const s = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  try {
    await seedBillable(s, M1);
    await bill(s, M1, { force: true });
    await seedBillable(s, M2);
    const res = await bill(s, M2, { force: true }); // in order — guard is a no-op
    assertEquals(res.status, "complete — billing month sealed");
  } finally {
    await s.teardown();
  }
});

// ── Named cases ──────────────────────────────────────────────────────────────

Deno.test("force: true does NOT bypass the ordering guard", async () => {
  const s = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  try {
    await seedBillable(s, M1); // unbilled billable earlier month
    await seedBillable(s, M3);
    const res = await bill(s, M3, { mode: "manual", force: true });
    assertEquals(res.status, "earlier_month_unbilled");
  } finally {
    await s.teardown();
  }
});

Deno.test("cron shape (no billing_month, auto) hits the guard identically", async () => {
  const s = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  try {
    await seedBillable(s, M1);
    await seedBillable(s, M3); // M3 = previousBillingMonth(CLOCK)
    const res = await bill(s, undefined, { mode: "auto" });
    assertEquals(res.status, "earlier_month_unbilled");
    assertEquals(res.earlier_unbilled_month, M1);
  } finally {
    await s.teardown();
  }
});

Deno.test("isolation: a blocked tenant does not stop a clean tenant in one cron run", async () => {
  const blocked = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  const clean = await newScenario({ price: 30, enrolledAt: `${M3}-01` });
  try {
    await seedBillable(blocked, M1); // earlier unbilled → will block on M3
    await seedBillable(blocked, M3);
    await seedBillable(clean, M3); // only M3 exists → nothing earlier

    // Cron: no tenant_id → every tenant, independently.
    const res = await generateInvoices(blocked.db, { mode: "auto", now: CLOCK });
    const byTenant = new Map(
      (res.per_tenant ?? []).map((r) => [r.tenant_id, r])
    );
    assertEquals(byTenant.get(blocked.tenantId)?.status, "earlier_month_unbilled");
    assertEquals(
      byTenant.get(clean.tenantId)?.status,
      "complete — billing month sealed"
    );
    assertEquals(await isSealed(clean, M3), true);
    assertEquals(await isSealed(blocked, M3), false);
  } finally {
    await clean.teardown();
    await blocked.teardown();
  }
});

// ── §7.18 cross-check: the guard's verdict matches the ENGINE's own verdict ───

Deno.test("cross-check: guard blocks EXACTLY the month the engine calls incomplete", async () => {
  const s = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  try {
    await seedBillable(s, M1);
    await bill(s, M1, { force: true }); // seal M1

    // M2 unmarked. The ENGINE, asked to bill M2 directly, calls it incomplete.
    const engineOnM2 = await bill(s, M2, { force: true });
    assertEquals(engineOnM2.status, "incomplete_attendance");
    assertEquals(await isSealed(s, M2), false);

    // The GUARD, asked to bill M3, blocks on that same M2.
    await seedBillable(s, M3);
    const guardOnM3 = await bill(s, M3, { force: true });
    assertEquals(guardOnM3.status, "earlier_month_unbilled");
    assertEquals(guardOnM3.earlier_unbilled_month, M2);
  } finally {
    await s.teardown();
  }
});

Deno.test("cross-check: an all-cancelled month the engine SEALS never blocks", async () => {
  const s = await newScenario({ price: 30, enrolledAt: `${M1}-01` });
  try {
    await seedBillable(s, M1);
    await bill(s, M1, { force: true });

    // M2 all-cancelled. The ENGINE seals it (a fully-marked month with no
    // billable lesson still seals — core.ts). So the guard must never block on it.
    await seedAllCancelled(s, M2);
    const engineOnM2 = await bill(s, M2, { force: true });
    assertEquals(engineOnM2.sealed, true);

    // Undo the seal to test the guard's own verdict on the un-sealed month.
    await s.db.from("billing_periods").delete()
      .eq("tenant_id", s.tenantId).eq("billing_month", M2);
    await seedBillable(s, M3);
    const guardOnM3 = await bill(s, M3, { force: true });
    assertEquals(guardOnM3.status, "complete — billing month sealed");
  } finally {
    await s.teardown();
  }
});
