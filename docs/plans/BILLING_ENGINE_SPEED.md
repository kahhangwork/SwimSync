# Billing engine speed — measured, fixed, proven equivalent (2026-11-16)

**Status:** engine + migration built and tested locally; **not deployed** (held for the user's review of these numbers).
Harness: `supabase/functions/generate-invoices/bench/` (`bench.sh`, `run.ts`, `seed.ts`, `compare.py`).

## 1. The problem

Generating October 2026 on prod took **30+ s** for **7 invoices**. Nothing recorded a run's duration.

## 2. What was measured, before changing anything

**From prod's own timestamps** (October's run, `invoices.generated_at` / `invoice_email_sent_at`):

| Step | Gap | Round trips | ⇒ cost per round trip |
|---|---|---|---|
| Phase 2, per parent | 1.21 s | 4 (existing? · balance · insert · items) | **~300 ms** |
| Email, per invoice | 0.65 s | 2 DB + 1 Resend | ~300 ms DB |

~300 ms is a trans-Pacific round trip. The admin API answered from **Vercel iad1** (`x-vercel-id: sin1::iad1::…`),
Supabase runs an Edge Function in the region nearest its caller, and the DB is in **ap-southeast-1**. Two causes,
multiplied: **round-trip count × round-trip cost**. Database work itself is ~2 ms per query (local, L0).

**Baseline engine (`main` @ `eb79bb2`), seeded month, `LATENCY_MS=300` calibrated to the figure above:**

| Seed | Invoices | Requests | Local (L0) | **Modelled prod (iad1)** | of which generation |
|---|---|---|---|---|---|
| 6 classes × 2 (≈ October) | 11 | 135 | 1.1 s | **39.6 s** | 30.4 s |
| 12 × 5 | 59 | 507 | 5.1 s | **144 s** | 101.8 s |
| 30 × 6 | 179 | 1,455 | 15.4 s | **411 s** | 285.6 s |

The model reproduces October (6×2 → 30 s of generation). By phase at 6×2: phase 1 reads 40 requests (~6 per class),
phase 2 49 (~4–5 per parent), emails 36 (3 per invoice), guards 6, clock 1.

## 3. What was done

1. **Vercel region → `sin1`** (user, dashboard, both projects, 2026-11-16). Verified: all admin API routes answer
   `sin1::sin1::…`. **Dashboard-only — not in git** (record in `docs/DEPLOYMENT.md`).
2. **Batched reads** (`core.ts`). Phase 1: one query per table per tenant-month (`lesson_sessions`,
   `trial_bookings`, `student_class_enrolments`, `attendance`, `parent_students`, `students`), grouped in memory; the
   per-class loop body is unchanged and sees the same rows. Phase 2: "already invoiced" and balances read once.
   **Writes stay per parent, in order** (insert → items → `apply_credit_to_invoice` → re-read).
   - `.in()` chunks of **100** (local: 200 uuids pass, 300 → 414; prod's limit unknown).
   - **Keyset paging by exact count** — never stops at a short page (a lower `max_rows` cannot truncate), and a row
     inserted mid-read cannot shift an existing one off a page.
   - **A batched read error throws** (before any write). The per-class reads it replaces swallowed errors as "no rows".
3. **Emails** (`email.ts`): 5 in claim → send → settle at once, each invoice's own sequence unchanged; **a rate gate
   holds Resend starts to `RESEND_MAX_PER_SECOND` (default 2)**. A 429 maps to `rejected` → claim released → the email
   waits for the next run, so the gate is a delivery fix: from Singapore, *sequential* sends already run ~4–5/s.
4. **Run duration**: `billing_runs.duration_ms` (migration `20261116000100`, nullable; generation only — the row is
   written before emails); `run_timings_ms` in the response; one `[generate-invoices] timings` log line per run.

## 4. After

Requests: **135 → 85 · 507 → 325 · 1,455 → 930.** Every read is now constant in classes and parents; what grows is
2 writes per parent (+2 with credit) and 3 calls per email.

| Seed | Before, iad1 (as on 2026-11-16 AM) | Batching only, iad1 | **Now: sin1 + batching, cap 2/s** | sin1 + batching, cap 10/s |
|---|---|---|---|---|
| 6 × 2 | 39.6 s | 20.8 s | **5.8 s** (generation 0.5 s) | 1.8 s |
| 12 × 5 | 144 s | 75.7 s | **30.9 s** (generation 1.5 s) | 7.8 s |
| 30 × 6 | 411 s | 213 s | **94.5 s** (generation 4.7 s) | 23.2 s |

Model: sin1 = 5 ms per DB call, Resend 200 ms (US-hosted, from SG); iad1 = 300 ms per DB call, Resend 60 ms. At sin1
**the email cap is now the whole wait**: 2/s is Resend's strictest documented default (its docs also say 5 and 10).
**Confirm the team's real limit on Resend → Usage and set `supabase secrets set RESEND_MAX_PER_SECOND=<n>`.**

## 5. Equivalence — byte-identical

Each pair: the same deterministic seed (fixed parent and student ids), billed once by `main`'s engine
(`git archive main`) and once by the new one — **each also billing its own September seed month**, so the credit
notes October draws on are themselves engine output. Compared row by row with every uuid mapped to a stable label
and only `id`, `public_token` and timestamps (`*_at`, value present/absent still compared) dropped:
`invoices` (incl. `reference_number`, `due_date`, status, every amount), `invoice_items`, `credit_notes`,
`credit_applications`, `package_applications`, `parent_tenant_balances`, `billing_periods`, and the engine's returned
`created` list (incl. item order).

| Seed | Invoices | Items | Credit notes / applications | Package applications | Result |
|---|---|---|---|---|---|
| 4 × 2 (siblings share a class) | 9 | 40 | 2 / 2 | 4 | **IDENTICAL** |
| 6 × 2 | 13 | 58 | 2 / 2 | 4 | **IDENTICAL** |
| 12 × 5 | 61 | 254 | 2 / 2 | 4 | **IDENTICAL** |
| 30 × 6 | 181 | 732 | 2 / 2 | 3 | **IDENTICAL** |

Also IDENTICAL at `LATENCY_MS` 5 and 300 and at email caps 2 and 10 (9 further runs).

**The comparison is not vacuous** — proven: a mutant engine dropping one parent link per class → DIFFERENT (names
the short invoice and the lost seal); a single +1 cent on one line → DIFFERENT. And one real DIFFERENT was chased to
its cause before it was dismissed: with random student ids, two siblings in one class on one date are ordered by
`student_id`, so two *seeds* ordered them differently — identical items and amounts. Fixed in the seed, not the engine.

## 6. Tests (each proven red without its fix, §7.25)

| Test | Red against |
|---|---|
| `speed.test.ts` reads do not grow with classes/parents | `main`: `GET lesson_sessions: 2 for 1 class but 5 for 4` |
| `speed.test.ts` emails spaced to the cap | `main`: `send 1 started 7 ms after the previous` |
| `speed.test.ts` complete under a server row cap | short-page mutant: rows 0003–0006 lost |
| `speed.test.ts` keyset paging on real PostgREST | `>=` mutant: `every row` |
| `runLog.test.ts` duration stored / per-tenant on cron | `main`'s runLog: duration not stored |
| `billing_runs.test.sql` +4 (exists, integer, nullable, ≥ 0) | column dropped: 4 failures |
| `speed.test.ts` concurrent workers never double-send | passes on both — a safety pin, not a fix test |

Deno suite 320/320 **twice**; pgTAP 2153 green; CI guards (test dates, SG date, clock, G5) green.

## 7. Accepted consequences

- **Reads move earlier by one run (~ms).** "Already invoiced" and balances are read before the per-parent loop. UNIQUE
  `(parent_id, tenant_id, billing_month)` remains the real double-bill guard (a concurrent run inside the window → this
  run's insert fails, logged, not sealed by it); the balance stays an estimate the RPC trues up (a credit note issued
  inside the window lands on next month's invoice — never lost, never doubled).
- **The rate gate is per isolate** — two simultaneous Generate presses could each send at the cap.
- **At cap 2/s a large month's emails are slower than uncapped** sequential sends would be — uncapped would hit 429s.

## 8. Proof on prod (after deploy)

`select billing_month, ran_at, invoices_created, duration_ms from billing_runs order by ran_at desc limit 5;` — the
next admin run should read **under ~1 s** for an October-sized month (modelled 0.5 s), against ~30 s before.
