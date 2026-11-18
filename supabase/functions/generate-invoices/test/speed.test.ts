// Billing engine speed (2026-11-16). What these pin:
//
//   1. ROUND TRIPS DO NOT GROW WITH CLASSES OR PARENTS. October 2026 took 30+ s
//      on prod because the engine asked one question per class (six queries)
//      and two per parent, at ~300 ms a round trip. The reads are now one per
//      table per tenant-month; a regression back to per-row reads turns this
//      red. RED on the pre-change engine: lesson_sessions 1 vs 4, invoices 1 vs 4.
//   2. EMAILS RESPECT RESEND'S PER-SECOND LIMIT. A 429 is mapped to "rejected"
//      and the email waits for the next run, so the gate is a delivery fix, not
//      a nicety. RED on the pre-change engine: sends start milliseconds apart.
//   3. CONCURRENT SENDS NEVER DOUBLE-SEND — the claim row-lock still decides.
//   4. A BATCHED READ IS COMPLETE even when the server caps rows below the page
//      size (paging by the exact count, never by a short page).
//
// Byte-identical invoices before vs after are proven separately, on a seeded
// month, by the comparison recorded in the commit (see docs/TESTING.md §5).

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";
import { generateInvoices, readPaged } from "../core.ts";
import { emailCreatedInvoices } from "../email.ts";
import { getInvoice, monthEnded, newScenario, type Scenario } from "./helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

/** A service-role client that counts every PostgREST request as "METHOD table". */
function countingClient(): { db: SupabaseClient; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const counted: typeof fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname.replace(/^\/rest\/v1\//, "")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return fetch(input, init);
  };
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: counted },
  });
  return { db, counts };
}

/** Add `n` more classes to a scenario, each with its OWN new parent and child,
 *  every expected lesson marked present. Returns the extra auth users to delete. */
async function addFamilies(s: Scenario, n: number, month: string): Promise<string[]> {
  const users: string[] = [];
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "sunday"];
  for (let i = 0; i < n; i++) {
    const { data: cls, error: cErr } = await s.db.from("classes").insert({
      coach_id: s.coachId,
      title: `Speed ${i} ${s.tag}`,
      day_of_week: days[i % days.length],
      start_time: "09:00",
      end_time: "10:00",
      location_id: s.locationId,
      price_per_lesson: 30,
      category_id: s.categoryId,
    }).select("id").single();
    if (cErr || !cls) throw new Error(`class: ${cErr?.message}`);
    await s.setRate({ from: `${month}-01`, price: 30 + i, classId: cls.id });

    const { data: u, error: uErr } = await s.db.auth.admin.createUser({
      email: `speed-${i}-${s.tag}@test.local`,
      password: "password123",
      email_confirm: true,
      user_metadata: { full_name: `Speed Parent ${i}`, role: "parent" },
    });
    if (uErr || !u.user) throw new Error(`parent: ${uErr?.message}`);
    users.push(u.user.id);
    const { data: p } = await s.db.from("parents").select("id").eq("profile_id", u.user.id).single();
    const { data: kid } = await s.db.from("students").insert({
      full_name: `Speed Kid ${i}`, assignment_status: "assigned", is_active: true, tenant_id: s.tenantId,
    }).select("id").single();
    await s.db.from("parent_students").insert({ parent_id: p!.id, student_id: kid!.id });
    await s.db.from("student_class_enrolments").insert({
      student_id: kid!.id, class_id: cls.id, is_active: true, enrolled_at: `${month}-01`,
    });
    // completeMonth sessions every expected date; flip each to present so the
    // class bills (cancelled_rain bills nothing).
    await s.completeMonth(month, cls.id);
    const { data: sess } = await s.db.from("lesson_sessions").select("id").eq("class_id", cls.id);
    for (const x of sess ?? []) await s.mark(x.id, "present", kid!.id);
  }
  return users;
}

async function run(classesBeyondOne: number): Promise<Map<string, number>> {
  const month = "2026-05";
  const s = await newScenario({ price: 30, billing: monthEnded(month) });
  let users: string[] = [];
  try {
    const a = await s.addSession(`${month}-02`);
    await s.mark(a, "present");
    await s.completeMonth(month);
    users = await addFamilies(s, classesBeyondOne, month);
    const { db, counts } = countingClient();
    const res = await generateInvoices(db, {
      tenant_id: s.tenantId, mode: "manual", billing_month: month, now: s.now,
    });
    assert(String(res.status).startsWith("complete"), `fixture did not bill: ${res.status} ${res.message ?? ""}`);
    assertEquals(res.invoices_created, 1 + classesBeyondOne, "one invoice per family");
    assert(res.timings_ms && res.timings_ms.total >= 0, "the run reports its own timing");
    // Not vacuous: the scenario's own parent really was billed.
    assert(await getInvoice(s.db, s.parentId, month), "scenario parent has an invoice");
    return counts;
  } finally {
    await s.teardown();
    for (const id of users) await s.db.auth.admin.deleteUser(id);
  }
}

Deno.test("speed: reads do NOT grow with classes or parents (one per table per tenant-month)", async () => {
  const small = await run(0); // 1 class, 1 family
  const big = await run(3); //   4 classes, 4 families
  // Every READ the engine makes costs the same for 4 classes as for 1.
  for (const table of [
    "lesson_sessions",
    "trial_bookings",
    "student_class_enrolments",
    "attendance",
    "parent_students",
    "students",
    "invoices",
    "parent_tenant_balances",
  ]) {
    assertEquals(
      big.get(`GET ${table}`) ?? 0,
      small.get(`GET ${table}`) ?? 0,
      `GET ${table}: ${small.get(`GET ${table}`) ?? 0} for 1 class but ${big.get(`GET ${table}`) ?? 0} for 4`
    );
  }
  // ...while the WRITES stay per parent, in order (the shape the plan keeps).
  assertEquals(small.get("POST invoices"), 1);
  assertEquals(big.get("POST invoices"), 4);
  assertEquals(big.get("POST invoice_items"), 4);
});

// ── Emails ───────────────────────────────────────────────────────────────────

async function billedOne(month: string) {
  const s = await newScenario({ price: 30, billing: monthEnded(month) });
  const a = await s.addSession(`${month}-06`);
  await s.mark(a, "present");
  await s.completeMonth(month);
  const res = await generateInvoices(s.db, {
    tenant_id: s.tenantId, mode: "manual", billing_month: month, now: s.now,
  });
  if (!res.created?.length) throw new Error("vacuous fixture — no invoice was generated");
  return { s, created: res.created };
}

function resendRecorder(starts: number[], keys: string[]): typeof fetch {
  const orig = globalThis.fetch;
  return ((url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("api.resend.com")) {
      starts.push(Date.now());
      keys.push((init?.headers as Record<string, string>)?.["Idempotency-Key"] ?? "");
      return Promise.resolve(new Response(JSON.stringify({ id: "e" }), { status: 200 }));
    }
    return orig(url as string | URL | Request, init);
  }) as typeof fetch;
}

Deno.test("speed: invoice emails are spaced to the Resend per-second limit", async () => {
  const fx = [];
  for (let i = 0; i < 4; i++) fx.push(await billedOne("2026-06"));
  const orig = globalThis.fetch;
  const starts: number[] = [];
  const keys: string[] = [];
  globalThis.fetch = resendRecorder(starts, keys);
  try {
    // What the gate GUARANTEES is a schedule, not a gap. It stamps each turn as the
    // worker passes it, ≥ `spacing` after the previous stamp; the first stamp is at
    // or after t0; a send starts after its own stamp. So the i-th send (0-based)
    // starts ≥ t0 + (i − 1) × spacing — four sends make the last floor 400 ms, which
    // an ungated batch (all claims in a few ms) cannot reach. The gap between two
    // fetch STARTS is NOT guaranteed: a worker resumed late after its turn shrinks
    // the next gap (163 ms once, BACKLOG 2026-11-18) with the gate working as built.
    const spacing = 200; // maxPerSecond: 5
    const t0 = Date.now();
    const out = await emailCreatedInvoices(
      fx[0].s.db,
      fx.flatMap((f) => f.created),
      { apiKey: "re_test", maxPerSecond: 1000 / spacing }
    );
    assertEquals(out.emailsSent, 4);
    assertEquals(starts.length, 4);
    starts.sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      // −5 ms: Date.now() granularity between the two clocks reads, not slack for the gate.
      const floor = (i - 1) * spacing;
      assert(starts[i] - t0 >= floor - 5, `send ${i} started ${starts[i] - t0} ms after t0 (needs ≥ ${floor})`);
    }
  } finally {
    globalThis.fetch = orig;
    for (const f of fx) await f.s.teardown();
  }
});

Deno.test("speed: concurrent workers never double-send one invoice (the claim decides)", async () => {
  const { s, created } = await billedOne("2026-07");
  const orig = globalThis.fetch;
  const starts: number[] = [];
  const keys: string[] = [];
  globalThis.fetch = resendRecorder(starts, keys);
  try {
    // The same invoice five times — five workers race for one claim.
    const out = await emailCreatedInvoices(s.db, Array(5).fill(created[0]), {
      apiKey: "re_test", maxPerSecond: 50,
    });
    assertEquals(keys.length, 1, `Resend called ${keys.length} times for one invoice`);
    assertEquals(out.emailsSent, 1);
  } finally {
    globalThis.fetch = orig;
    await s.teardown();
  }
});

// ── Paging ───────────────────────────────────────────────────────────────────

/** A fake counted query over `total` rows that never returns more than `cap`,
 *  supporting the keyset calls readPaged makes (gt → order → limit). */
function cappedQuery(total: number, cap: number, opts: { count?: number | null; error?: string } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: String(i).padStart(4, "0") }));
  return () => {
    let after: string | null = null;
    const q = {
      gt: (_k: string, v: string) => { after = v; return q; },
      order: () => q,
      limit: (n: number) => {
        const rest = rows.filter((r) => after === null || r.id > after);
        return Promise.resolve({
          data: opts.error ? null : rest.slice(0, Math.min(n, cap)),
          error: opts.error ? { message: opts.error } : null,
          count: opts.count === undefined ? rest.length : opts.count,
        });
      },
    };
    return q;
  };
}

Deno.test("speed: a batched read is complete when the server caps rows below the page", async () => {
  // A cap of 3 is far below the engine's page of 1000 — the case where
  // "stop at a short page" would silently drop every row after the third.
  const got = await readPaged<{ id: string }>(cappedQuery(7, 3), "id", "fake");
  assertEquals(got.map((r) => r.id), ["0000", "0001", "0002", "0003", "0004", "0005", "0006"]);
});

Deno.test("speed: a batched read THROWS on an error or a missing count (fail closed)", async () => {
  await assertRejects(() => readPaged(cappedQuery(2, 10, { error: "boom" }), "id", "fake"), Error, "boom");
  await assertRejects(() => readPaged(cappedQuery(2, 10, { count: null }), "id", "fake"), Error, "no row count");
});

Deno.test("speed: keyset paging against REAL PostgREST returns every row exactly once", async () => {
  // Real paging only happens past 1000 rows, which no fixture reaches — so page
  // 2 rows at a time over a class's sessions and compare to one unpaged read.
  // This is the part a fake cannot prove: `gt` on a uuid key and the per-page
  // remaining count, as the server actually answers them.
  const s = await newScenario({ price: 30, billing: monthEnded("2026-08") });
  try {
    await s.completeMonth("2026-08"); // one session per expected Saturday (5)
    const all = (await s.db.from("lesson_sessions").select("id").eq("class_id", s.classId)).data ?? [];
    assert(all.length >= 4, `fixture too small to page: ${all.length} sessions`);
    const paged = await readPaged<{ id: string }>(
      () => s.db.from("lesson_sessions").select("id, session_date", { count: "exact" }).eq("class_id", s.classId),
      "id", "lesson_sessions", 2,
    );
    assertEquals(paged.length, all.length, "every row");
    assertEquals(new Set(paged.map((r) => r.id)).size, all.length, "no row twice");
    assertEquals(new Set(paged.map((r) => r.id)), new Set(all.map((r) => r.id)), "the same rows");
  } finally {
    await s.teardown();
  }
});
