// The engine's database clock (clock.ts, docs/plans/PIN_DRIVER_CLOCK_PLAN.md).
//
// What these pin, in order of what would hurt most:
//   ⚠ RISK 1 — off a local stack, a DB clock that disagrees with the wall clock
//     THROWS (a parse/offset bug could move the month-not-ended and run-day
//     guards by a day on prod). Locally the same skew is a pin, and is honoured.
//   An Invalid Date never becomes opts.now (§7.357).
//   A body `now` is always replaced — the wire never reaches the clock.
//   One retry on an RPC error, then a throw naming the cause.
//
// Pure: the RPC is stubbed. No shared-database mutation — an "integration test
// under a pin" would move the shared DB's clock while the suite runs (plan,
// "Deno (engine)").

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type ClockRpc,
  dbNow,
  isLocalSupabaseUrl,
  MAX_PROD_SKEW_MS,
  parseDbNow,
  withDbNow,
} from "./clock.ts";

const LOCAL = "http://127.0.0.1:54321";
const PROD = "https://abcdefghijklmnop.supabase.co";
const PG_SHAPE = "2026-09-30T23:59:00.123456+00:00"; // date-literal-ok: a parsed RPC shape, never a write
const PG_EPOCH = Date.UTC(2026, 8, 30, 23, 59, 0, 123);

/** A stub client answering app_now() from a queue of responses. */
function stub(...responses: { data: unknown; error: unknown }[]): ClockRpc & { calls: number } {
  const s = {
    calls: 0,
    rpc(fn: "app_now") {
      assertEquals(fn, "app_now");
      const r = responses[Math.min(s.calls, responses.length - 1)];
      s.calls++;
      return Promise.resolve(r);
    },
  };
  return s;
}
const ok = (data: unknown) => ({ data, error: null });
const fail = (message: string) => ({ data: null, error: { message } });
const noSleep = () => Promise.resolve();

// ── parseDbNow ────────────────────────────────────────────────────────────────

Deno.test("parseDbNow: reads PostgREST's timestamptz shape (microseconds truncated to ms)", () => {
  assertEquals(parseDbNow(PG_SHAPE).getTime(), PG_EPOCH);
});

Deno.test("parseDbNow: null, a number and a non-date string all throw", () => {
  for (const bad of [null, 1790812740000, "not a date", ""]) {
    let threw = false;
    try {
      parseDbNow(bad);
    } catch (e) {
      threw = true;
      assert((e as Error).message.startsWith("could not read the database clock"), (e as Error).message);
    }
    assert(threw, `expected a throw for ${JSON.stringify(bad)}`);
  }
});

Deno.test("parseDbNow: an Invalid Date throws — it is `instanceof Date` but not a date (§7.357)", () => {
  // V8 rejects the T + short-offset form that Postgres accepts.
  assert(new Date("2026-10-01T07:59+08") instanceof Date); // date-literal-ok: the parse hazard itself
  let threw = false;
  try {
    parseDbNow("2026-10-01T07:59+08"); // date-literal-ok: the parse hazard itself
  } catch {
    threw = true;
  }
  assert(threw);
});

// ── isLocalSupabaseUrl ────────────────────────────────────────────────────────

Deno.test("isLocalSupabaseUrl: the four local hosts are local; prod, junk and unset are not", () => {
  for (const u of ["http://kong:8000", "http://localhost:54321", LOCAL, "http://host.docker.internal:54321"]) {
    assert(isLocalSupabaseUrl(u), u);
  }
  for (const u of [PROD, "https://localhost.evil.example", "not a url", "", undefined]) {
    assert(!isLocalSupabaseUrl(u), String(u));
  }
});

// ── dbNow ─────────────────────────────────────────────────────────────────────

Deno.test("dbNow: local URL, a 10-day skew is a PIN — returns the database's value", async () => {
  const wall = PG_EPOCH + 10 * 86_400_000;
  const d = await dbNow(stub(ok(PG_SHAPE)), { supabaseUrl: LOCAL, wallNow: () => wall, sleep: noSleep });
  assertEquals(d.getTime(), PG_EPOCH);
});

Deno.test("dbNow: prod URL, a 10-minute skew THROWS (fail closed)", async () => {
  const wall = PG_EPOCH + 10 * 60_000;
  await assertRejects(
    () => dbNow(stub(ok(PG_SHAPE)), { supabaseUrl: PROD, wallNow: () => wall, sleep: noSleep }),
    Error,
    "from the wall clock",
  );
});

Deno.test("dbNow: prod URL, a skew inside the limit returns the database's value", async () => {
  const wall = PG_EPOCH + MAX_PROD_SKEW_MS - 1_000;
  const d = await dbNow(stub(ok(PG_SHAPE)), { supabaseUrl: PROD, wallNow: () => wall, sleep: noSleep });
  assertEquals(d.getTime(), PG_EPOCH);
});

Deno.test("dbNow: one RPC error is retried once, then the value is used", async () => {
  const c = stub(fail("blip"), ok(PG_SHAPE));
  const d = await dbNow(c, { supabaseUrl: LOCAL, wallNow: () => PG_EPOCH, sleep: noSleep });
  assertEquals(c.calls, 2);
  assertEquals(d.getTime(), PG_EPOCH);
});

Deno.test("dbNow: two RPC errors throw, naming the cause", async () => {
  const c = stub(fail("connection refused"));
  await assertRejects(
    () => dbNow(c, { supabaseUrl: LOCAL, wallNow: () => PG_EPOCH, sleep: noSleep }),
    Error,
    "could not read the database clock: connection refused",
  );
  assertEquals(c.calls, 2);
});

Deno.test("dbNow: an unparseable value throws (no retry — the database answered)", async () => {
  const c = stub(ok(12345));
  await assertRejects(
    () => dbNow(c, { supabaseUrl: LOCAL, wallNow: () => PG_EPOCH, sleep: noSleep }),
    Error,
    "could not read the database clock",
  );
  assertEquals(c.calls, 1);
});

// ── withDbNow — what the handler calls ────────────────────────────────────────

Deno.test("withDbNow: ALWAYS replaces opts.now, keeping every other option", async () => {
  const body = { mode: "auto" as const, tenant_id: "t", now: new Date(0) };
  const out = await withDbNow(body, stub(ok(PG_SHAPE)), { supabaseUrl: LOCAL, wallNow: () => PG_EPOCH, sleep: noSleep });
  assertEquals(out.now?.getTime(), PG_EPOCH);
  assertEquals(out.mode, "auto");
  assertEquals(out.tenant_id, "t");
  assertEquals(body.now.getTime(), 0, "the caller's object is not mutated");
});

Deno.test("withDbNow: a JSON-body `now` string is replaced by a real Date", async () => {
  const body = JSON.parse('{"now":"2001-01-01T00:00:00Z"}') as { now?: Date }; // date-literal-ok: a hostile body, never a write
  const out = await withDbNow(body, stub(ok(PG_SHAPE)), { supabaseUrl: LOCAL, wallNow: () => PG_EPOCH, sleep: noSleep });
  assert(out.now instanceof Date);
  assertEquals(out.now.getTime(), PG_EPOCH);
});
