// Benchmark + equivalence dump for generate-invoices (BILLING ENGINE SPEED, 2026-11-16).
// Results and method: docs/plans/BILLING_ENGINE_SPEED.md. Local stack only; it seeds its
// own tenant and tears it down. NOT part of test.sh — run it by hand (./bench/bench.sh).
//
//   ENGINE_DIR=<dir with core.ts/email.ts/runLog.ts>  engine under test (default: this one)
//   SEED_ENGINE_DIR=<dir>   engine that bills the SEPTEMBER seed month. Pin it to ONE engine
//                           for a before/after pair so the two seeds are identical.
//   LATENCY_MS=300          added per Supabase request (300 ≈ the measured iad1 → SG cost)
//   RESEND_MS=60            simulated Resend latency (≈60 from US-East, ≈200 from SG)
//   RATE=2                  Resend sends/second cap passed to the engine (its default is 2)
//   CLASSES=12 PER_CLASS=5  seed size
//   OUT=<file.json>         normalized dump; compare two with compare.py
//   KEEP=1                  skip teardown (inspect the seeded tenant)
//
// An old engine to compare against:
//   git archive <sha> supabase/functions/generate-invoices | tar -x -C /tmp/old
//   ENGINE_DIR=/tmp/old/supabase/functions/generate-invoices ...
// Replays index.ts's orchestration (withDbNow → generateInvoices → recordRuns →
// emailCreatedInvoices → retryUnsentInvoiceEmails) with an instrumented client.
import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { MONTH, seedMonth } from "./seed.ts";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ENGINE_DIR = (Deno.env.get("ENGINE_DIR") ?? REPO).replace(/\/$/, "");
const SEED_ENGINE_DIR = (Deno.env.get("SEED_ENGINE_DIR") ?? ENGINE_DIR).replace(/\/$/, "");
const LATENCY_MS = Number(Deno.env.get("LATENCY_MS") ?? 0);
const RESEND_MS = Number(Deno.env.get("RESEND_MS") ?? 60);
const CLASSES = Number(Deno.env.get("CLASSES") ?? 12);
const PER_CLASS = Number(Deno.env.get("PER_CLASS") ?? 5);
const OUT = Deno.env.get("OUT");

const core = await import(`file://${ENGINE_DIR}/core.ts`);
const email = await import(`file://${ENGINE_DIR}/email.ts`);
const runLog = await import(`file://${ENGINE_DIR}/runLog.ts`);
const seedCore = await import(`file://${SEED_ENGINE_DIR}/core.ts`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Instrumentation ─────────────────────────────────────────────────────────
type Req = { phase: string; method: string; target: string; t0: number; ms: number };
const reqs: Req[] = [];
let phase = "idle";
let measuring = false;
const realFetch = globalThis.fetch.bind(globalThis);

function target(url: string): string {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/rest\/v1\//, "");
  return p;
}

function subPhase(method: string, url: string): void {
  if (phase.startsWith("email") || phase === "runlog" || phase === "clock") return;
  const t = target(url);
  const q = decodeURIComponent(new URL(url).search);
  if (phase === "guards" && method === "GET" && t === "classes" && q.includes("price_per_lesson")) phase = "phase1_reads";
  else if (phase === "phase1_reads" && t === "package_applications") phase = "drawn_check";
  else if ((phase === "phase1_reads" || phase === "drawn_check") &&
    (t === "invoices" || t === "parent_tenant_balances" || (t === "billing_periods" && method === "POST"))) phase = "phase2_writes";
}

async function instrumented(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!measuring) return realFetch(input, init);
  if (url.startsWith("https://api.resend.com")) {
    const t0 = performance.now();
    await sleep(RESEND_MS);
    reqs.push({ phase, method, target: "RESEND", t0, ms: performance.now() - t0 });
    return new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 200, headers: { "content-type": "application/json" } });
  }
  subPhase(method, url);
  const t0 = performance.now();
  if (LATENCY_MS) await sleep(LATENCY_MS);
  const res = await realFetch(input, init);
  // Body is consumed by the caller; time to headers is what a round trip costs.
  reqs.push({ phase, method, target: target(url), t0, ms: performance.now() - t0 });
  return res;
}
globalThis.fetch = instrumented as typeof fetch;

// ── Seed ────────────────────────────────────────────────────────────────────
const tSeed = performance.now();
const seeded = await seedMonth({ classes: CLASSES, perClass: PER_CLASS, generate: seedCore.generateInvoices });
console.error(`seeded ${CLASSES}×${PER_CLASS} in ${((performance.now() - tSeed) / 1000).toFixed(1)}s (tenant ${seeded.s.tenantId})`);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const engineDb = createClient(SUPABASE_URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: instrumented as typeof fetch },
});

let exitCode = 0;
try {
  // ── Timed run (index.ts orchestration, manual, scoped — the admin button) ──
  let opts = { mode: "manual", billing_month: MONTH, tenant_id: seeded.s.tenantId, now: seeded.now } as Record<string, unknown>;
  const marks: [string, number][] = [];
  measuring = true;
  const T0 = performance.now();
  phase = "clock"; marks.push([phase, performance.now()]);
  // withDbNow would replace `now` with the DB clock; the bench pins the seed's
  // clock instead, but still pays the app_now round trip it costs in prod.
  await engineDb.rpc("app_now");
  phase = "guards"; marks.push([phase, performance.now()]);
  const result = await core.generateInvoices(engineDb, opts);
  const tGen = performance.now();
  phase = "runlog"; marks.push([phase, performance.now()]);
  await runLog.recordRuns(engineDb, runLog.toRunRows(result, opts));
  phase = "email_created"; marks.push([phase, performance.now()]);
  const env = { apiKey: "re_bench_fake", appUrl: "https://swimsync.sg", maxPerSecond: Number(Deno.env.get("RATE") ?? 0) || undefined };
  const { emailsSent } = await email.emailCreatedInvoices(engineDb, result.created ?? [], env);
  phase = "email_retry"; marks.push([phase, performance.now()]);
  let retried = 0;
  for (const run of result.per_tenant ?? [result]) {
    if (!run.tenant_id || !email.shouldRetryTenantEmails(run.status, true)) continue;
    const r = await email.retryUnsentInvoiceEmails(engineDb, run.tenant_id, run.billing_month, {
      ...env, excludeIds: (run.created ?? []).map((c: { invoice_id: string }) => c.invoice_id),
    });
    retried += r.emailsRetried;
  }
  const T1 = performance.now();
  measuring = false;

  // ── Report ────────────────────────────────────────────────────────────────
  const phases = ["clock", "guards", "phase1_reads", "drawn_check", "phase2_writes", "runlog", "email_created", "email_retry"];
  const firstAt = new Map<string, number>();
  for (const r of reqs) if (!firstAt.has(r.phase)) firstAt.set(r.phase, r.t0);
  for (const [p, t] of marks) if (!firstAt.has(p)) firstAt.set(p, t);
  const order = phases.filter((p) => firstAt.has(p)).sort((a, b) => firstAt.get(a)! - firstAt.get(b)!);
  const rows = order.map((p, i) => {
    const start = firstAt.get(p)!;
    const end = i + 1 < order.length ? firstAt.get(order[i + 1])! : T1;
    const rs = reqs.filter((r) => r.phase === p);
    const byTarget: Record<string, number> = {};
    for (const r of rs) byTarget[`${r.method} ${r.target}`] = (byTarget[`${r.method} ${r.target}`] ?? 0) + 1;
    return { phase: p, ms: Math.round(end - start), requests: rs.length, byTarget };
  });
  const summary = {
    engine: ENGINE_DIR === REPO ? "repo" : ENGINE_DIR,
    latency_ms: LATENCY_MS,
    seed: `${CLASSES} classes × ${PER_CLASS}`,
    status: result.status,
    invoices_created: result.invoices_created,
    emails_sent: emailsSent,
    emails_retried: retried,
    total_ms: Math.round(T1 - T0),
    generate_ms: Math.round(tGen - T0),
    total_requests: reqs.length,
    phases: rows,
  };
  console.log(JSON.stringify(summary, null, 1));
  if (!String(result.status).startsWith("complete")) { console.error("RUN DID NOT COMPLETE:", result.message); exitCode = 3; }

  // ── Normalized dump ───────────────────────────────────────────────────────
  if (OUT) {
    const db = seeded.s.db;
    const tid = seeded.s.tenantId;
    const labels = new Map(seeded.labels);
    const invs = (await db.from("invoices").select("*").eq("tenant_id", tid)).data ?? [];
    for (const i of invs) labels.set(i.id, `INV:${labels.get(i.parent_id)}:${i.billing_month}`);
    const cns = (await db.from("credit_notes").select("*").eq("tenant_id", tid)).data ?? [];
    for (const c of cns) labels.set(c.id, `CN:${c.reference_number}`);
    const items = (await db.from("invoice_items").select("*").in("invoice_id", invs.map((i) => i.id))).data ?? [];
    for (const it of items) labels.set(it.id, `ITEM:${labels.get(it.invoice_id)}:${labels.get(it.lesson_session_id)}:${labels.get(it.student_id)}`);
    const pkgs = (await db.from("parent_packages").select("*").eq("tenant_id", tid)).data ?? [];
    for (const p of pkgs) labels.set(p.id, `PKG:${labels.get(p.parent_id)}`);
    const prods = (await db.from("package_products").select("id").eq("tenant_id", tid)).data ?? [];
    for (const p of prods) labels.set(p.id, `PROD`);
    labels.set(tid, "TENANT"); labels.set(seeded.s.coachProfileId, "COACH_PROFILE"); labels.set(seeded.s.coachId, "COACH");
    labels.set(seeded.s.categoryId, "CAT1"); labels.set(seeded.s.categoryId2, "CAT2");
    const sessions = (await db.from("lesson_sessions").select("id, class_id, session_date").in("class_id", [...seeded.labels.keys()])).data ?? [];
    for (const s of sessions) if (!labels.has(s.id)) labels.set(s.id, `${labels.get(s.class_id)}@${s.session_date}`);
    const att = (await db.from("attendance").select("id, lesson_session_id, student_id").in("lesson_session_id", sessions.map((s) => s.id))).data ?? [];
    for (const a of att) labels.set(a.id, `ATT:${labels.get(a.lesson_session_id)}:${labels.get(a.student_id)}`);

    const capps = (await db.from("credit_applications").select("*").or(
      `invoice_id.in.(${invs.map((i) => i.id).join(",") || "00000000-0000-0000-0000-000000000000"}),credit_note_id.in.(${cns.map((c) => c.id).join(",") || "00000000-0000-0000-0000-000000000000"})`,
    )).data ?? [];
    const papps = (await db.from("package_applications").select("*").in("parent_package_id", pkgs.map((p) => p.id))).data ?? [];
    const bals = (await db.from("parent_tenant_balances").select("*").eq("tenant_id", tid)).data ?? [];
    const periods = (await db.from("billing_periods").select("*").eq("tenant_id", tid)).data ?? [];

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const DROP = new Set(["id", "public_token"]);
    // deno-lint-ignore no-explicit-any
    const norm = (rows: any[]) =>
      rows.map((r) => {
        // deno-lint-ignore no-explicit-any
        const o: Record<string, any> = {};
        for (const k of Object.keys(r).sort()) {
          if (DROP.has(k) || /_at$/.test(k)) { o[k] = r[k] === null ? null : "<dropped>"; continue; }
          const v = r[k];
          o[k] = typeof v === "string" && UUID.test(v) ? (labels.get(v) ?? `UNMAPPED:${k}`) : v;
        }
        return o;
      }).map((o) => JSON.stringify(o)).sort();
    const dump = {
      invoices: norm(invs), invoice_items: norm(items), credit_notes: norm(cns),
      credit_applications: norm(capps), package_applications: norm(papps),
      parent_tenant_balances: norm(bals), billing_periods: norm(periods),
      created_result: (result.created ?? []).map((c: Record<string, unknown>) => JSON.stringify({ ...c, invoice_id: labels.get(c.invoice_id as string), parent_id: labels.get(c.parent_id as string), tenant_id: "TENANT", items: (c.items as Record<string, unknown>[]).map((i) => ({ ...i, student_id: labels.get(i.student_id as string) })) })).sort(),
      result_status: result.status, sealed: result.sealed,
    };
    await Deno.writeTextFile(OUT, JSON.stringify(dump, null, 1));
    console.error(`dump → ${OUT}: ${invs.length} invoices, ${items.length} items, ${capps.length} credit apps, ${papps.length} package apps, ${cns.length} credit notes`);
  }
} catch (e) {
  console.error("BENCH FAILED:", e);
  exitCode = 1;
} finally {
  measuring = false;
  if (!Deno.env.get("KEEP")) await seeded.cleanup();
}
Deno.exit(exitCode);
