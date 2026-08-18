# Plan — engine ordering-guard for month stranding + engine-side credit lock + admin void

_Drafted 2026-08-18 via `/plan-with-confidence`; **revised same day after user review**:
Item 1 switched from the contiguity floor to an engine ordering-guard (rejection recorded
in Item 1), and all four open questions are resolved — see the foot. Three Wave-D
follow-ups (BACKLOG: "Sealing a LATER month strands an earlier unsealed one",
"Engine-side credit-note lock", "Admin action to void/reverse a credit note"). **Plan
only — nothing here is implemented, no migration authored.** All three are latent: prod
holds 0 credit notes and bills manually. One schema change in flight at a time (§7.55) —
the schema changes below are strictly sequential (Item 1 may need none), each landed +
applied + tested before the next starts._

---

## Item 1 — Sealing a LATER month strands an earlier unsealed one

### Root cause

`markable_floor()` anchors on **`MAX(billing_month)`** —
`supabase/migrations/20260806000200_markable_floor.sql:94` —

```sql
(SELECT (to_date(MAX(bp.billing_month), 'YYYY-MM') + INTERVAL '1 month')::date
   FROM billing_periods bp WHERE bp.tenant_id = p_tenant_id)
```

`MAX` is the latest **sealed** month, not the latest **contiguous** one. The engine seals
any completed month (`core.ts:1539–1566`, the `billing_periods` upsert), and nothing
forces sealing in order: an admin can bill September while July is blocked on one
forgotten lesson (explicit `billing_month`, `core.ts:225–228`), and even the **auto cron
does it unaided** — it only ever retries `previousBillingMonth(now)` (`core.ts:229`), so
a tenant whose August never billed gets September sealed in October and August's floor
term jumps from 1 Sep to 1 Oct. Once the floor passes the stranded month, its lessons are
unmarkable (`assert_markable_date`, `20260806000200:122–143`), the completeness gate
names a lesson nobody may record, the gate has no override **by design** (PRD §7.7,
refused on the record), and the month can never bill. §8.32's own failure mode through
the door §8.32 did not close (BACKLOG "Sealing a LATER month strands…", GOTCHAS-adjacent
worked example there).

**Refuted fixes (do not re-derive):**

- **"Floor at the earliest UNSEALED month"** fails because a month with nothing recorded
  is never sealed (`classesComplete > 0`, `core.ts:1539–1544`) — quiet months and every
  pre-business month are unsealed, so that floor reaches the beginning of time. Recorded
  in `20260806000200:34–43` and BACKLOG.
- **The contiguity gap-scan floor** ("month after the first sealed month whose successor
  is not sealed" — this plan's original Item 1) **rejected in user review 2026-08-18**:
  lowering the floor to reopen a stranded August also lowers the coach app's visible
  window — `backlogWindowStart` takes `min(floor, 1st-of-last-month)`
  (`SwimSyncApp/lib/lessonDates.ts:232`) — and `assert_markable_date` keys on the same
  floor, so the **sealed** months above the gap (Sep/Oct/Nov) are re-exposed to the
  coach for editing, in the UI *and* at the DB guard. A single floor date cannot express
  "August open, sealed months above it closed", so no floor formula can give the
  required guarantee that **sealed months stay closed**. Prevention has to live where
  the ordering is decided: the engine.

### Fix approach — engine ordering-guard (engine-only; floor UNCHANGED, no app change)

**`markable_floor()` is not touched.** The formula stays
`LEAST(1st of last month, month after latest sealed month, created_at)`
(`20260806000200`) — no migration to it, so the coach window is unchanged and sealed
months are never re-exposed. Instead, **the engine refuses to bill/seal a month M for a
tenant while an EARLIER unsealed month still has unbilled lessons**, failing that tenant
with "bill <earlier month> first" (name the **earliest** blocking month). Stranding is
prevented at the source: September cannot seal ahead of an August that still owes
billing, so the floor's `MAX(billing_month)+1` term never jumps past a real billable
month — August stays above the floor, markable and billable, until actually billed.

The guard applies **regardless of trigger** — manual explicit-month runs
(`core.ts:225–228`) *and* the auto cron. The cron only ever bills
`previousBillingMonth(now)` (`core.ts:229`), so today's stranding risk is manual
out-of-order billing — but a cron run sealing September while August is unbilled is
exactly the BACKLOG scenario, so the guard sits in `runGenerateInvoices` (`core.ts`),
not the handler. **No `force` bypass** — like the unmarked-attendance block and the
completed-month guard, an override could only produce a permanent underbill; the
skippable-empty-month rule below is the escape hatch, so no override is needed.

**The guard predicate — the crux, keyed on "has unbilled lessons", NOT "is sealed".**
An earlier unsealed month E blocks month M **iff** E has at least one lesson the engine
would still bill:

- a recorded `present`/`trial_paid` attendance in E not yet on an invoice, **or**
- an unmarked expected lesson in E that could still become billable — i.e. its date is
  `>= markable_floor(tenant)` so a coach can still mark it. Expected lessons are derived
  exactly as the completeness gate derives them (`expectedLessonDates` /
  `expectedStudentsOn`, `attendanceCompleteness.ts` — lazy session creation means
  session rows cannot be the source, PRD §7.5).

An **empty** month (no expected lessons, no bookings) or an **all-absent** month with
nothing left to bill is **skippable** — it does not block. Without that, every quiet
month and every pre-business month would deadlock billing forever (the same failure the
"earliest unsealed month" floor had). The below-floor qualifier on the unmarked arm only
matters for *pre-guard legacy* stranding (see Measurement): post-guard, a blocking month
is always above the floor by construction, because the guard is what stops the floor
passing it.

> ⚠ **RISK 1 MITIGATION — a false-positive block has no escape, so it must be impossible,
> not merely tested.** A predicate that *over*-counts (thinks an empty/all-absent/holiday
> month is billable) deadlocks a real tenant's billing forever — no `force`, by design.
> Two structural guards, both required:
> - **The predicate reuses the completeness gate's own derivation, it does not
>   re-implement it.** Call the exact `expectedStudentsOn`/`expectedLessonDates` path
>   (`attendanceCompleteness.ts`) the sealing decision already uses, so "would this month
>   bill?" and "does this month block?" cannot diverge (§7.18 — one definition, not two
>   copies of one rule). A month the engine would seal with zero invoices (all-absent,
>   holiday-only, retired-class-only) MUST classify as skippable; assert that as a named
>   test case, not a comment.
> - **Fail SKIPPABLE on any predicate error/uncertainty, never BLOCKING.** If the scan
>   throws or returns null for a month, treat it as "does not block" — a missed block is a
>   recoverable underbill caught by the §8.48 orphan report; a wrongful block is an
>   unrecoverable revenue halt. State this polarity in the code comment and pin it with a
>   test that feeds the predicate a malformed month and asserts billing proceeds.

> ⚠ **RISK 3 MITIGATION — the guard must be byte-identical on in-order billing.** Before
> writing the guard, capture the current Deno suite's credit/billing assertions as the
> regression net; after, every in-order permutation must pass **unchanged** (assertion:
> the existing `core.test.ts` count and outcomes are identical, not merely green). Add one
> test that replays prod's *actual* shape — exactly one sealed month (July 2026), then
> bills the next month in order — and asserts the guard does NOT fire. A changed
> in-order outcome is a blocker, not a diff to accept.

**Consequences, stated so they are not re-litigated:**

- **No manual "seal an empty month" button.** Empty months are auto-skippable, so none
  is needed — and a manual seal would let someone seal a month **without billing it**,
  bypassing the unmarked-attendance block and the completed-month guard (the load-bearing
  overrides CLAUDE.md forbids adding). The invariant "sealed ⇒ actually billed by the
  engine" stays intact.
- **No stuck floor.** The floor formula is unchanged, so sealing a later month advances
  the floor exactly as today; a skippable empty earlier month simply falls below it
  harmlessly, never sealed, never missed.
- **No deadlock.** An unsealed August with billable content holds `MAX(billing_month)`
  at July, so the floor's seal term stays 1 Aug — August remains markable and billable
  until it actually bills, at which point the guard releases September.

### Files / change surface

- `supabase/functions/generate-invoices/core.ts` — the guard, early in
  `runGenerateInvoices` (beside the month-ended and sealed-month guards,
  `core.ts:230–326` region); per-tenant refusal shaped like the existing
  unmarked-attendance refusal so the admin UI surfaces it unchanged.
- `supabase/functions/generate-invoices/index.ts` — only if the refusal needs a new
  response field; prefer reusing the existing error shape so it doesn't.
- **Possibly** one small DB helper (migration on a `db/…` branch, root checkout) if the
  "earlier unsealed month with unbilled lessons" scan is cleaner in SQL than in the
  engine's fetched rows — decide at implementation. If authored: `REVOKE ALL FROM
  PUBLIC; GRANT EXECUTE TO service_role;` only (§7.87/§7.35), rows in
  `function_grants.test.sql`, committed + rehearsed DOWN (§7.92/§7.93), and a remote
  grant dump after apply (§7.39/§7.89). If not authored, Item 1 ships with **no
  migration at all**.
- Deploy order (§7.60): (helper migration if any) → `supabase functions deploy
  generate-invoices` (a git push does NOT deploy it — confirm with `supabase functions
  list`) → no app deploy.

### Measure production FIRST (before writing anything)

The ordering-guard only prevents **future** stranding — a month already below the floor
today is NOT fixed by it. Run against prod; a non-zero result on (2) is an incident
needing **one-time remediation** — a deliberate, documented, per-tenant/month decision
made with the user, designed then, not pre-committed here — it is not something this
item's code cures:

```sql
-- (1) Businesses with a GAP in their sealed months (BACKLOG's query, verbatim):
SELECT bp.tenant_id, MAX(bp.billing_month) AS latest_sealed, count(*) AS sealed_months
  FROM billing_periods bp GROUP BY 1
 HAVING count(*) <> (
   EXTRACT(YEAR  FROM age(to_date(MAX(bp.billing_month),'YYYY-MM'),
                          to_date(MIN(bp.billing_month),'YYYY-MM'))) * 12
 + EXTRACT(MONTH FROM age(to_date(MAX(bp.billing_month),'YYYY-MM'),
                          to_date(MIN(bp.billing_month),'YYYY-MM'))) + 1);

-- (2) ALREADY STRANDED content: recorded lessons in an unsealed month whose month
--     sits BELOW that tenant's current floor (rows here = months the guard cannot
--     save; expect none):
SELECT c.tenant_id, to_char(ls.session_date,'YYYY-MM') AS month,
       count(*) AS sessions
  FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
 WHERE date_trunc('month', ls.session_date)::date
       < date_trunc('month', markable_floor(c.tenant_id))::date
   AND NOT EXISTS (SELECT 1 FROM billing_periods bp
                    WHERE bp.tenant_id = c.tenant_id
                      AND bp.billing_month = to_char(ls.session_date,'YYYY-MM'))
 GROUP BY 1,2 ORDER BY 1,2;
```

Note (2) sees only *recorded* stranding — a stranded month where nothing was ever
marked has no session rows (lazy creation, PRD §7.5); query (1)'s gap listing is the
tripwire for those, cross-checked against class schedules by hand if it fires. Expected
today per HANDOVER/BACKLOG: prod has sealed exactly one month (July 2026), has never
billed late, and recorded nothing before 2026-07-26 — so both should be empty. **If (2)
is non-empty**, report the tenant/months to the user and treat remediation as its own
decision before the guard ships; the guard would otherwise permanently block that
tenant's billing on a month nobody can mark.

> **RESULT (2026-08-18, run via `supabase db query --linked`):** query (1) → `[]` (no
> sealed-month gaps); query (2) → `[]` (no stranded content). Prod holds 1 sealed month
> (2026-07), 3 tenants, 24 lesson_sessions. **Measurement half of the gate PASSES — nothing
> to remediate.** The predicate dry-run (below) still runs pre-deploy once the guard exists.
>
> ⚠ **RISK 7 MITIGATION — prove no live tenant is blocked BEFORE deploy, not after.** A
> non-empty query (2) is a *deploy blocker*, not a note. Turn it into a gate: (a) run
> both queries against prod and paste the results into the ship checklist; (b) additionally
> run the finished guard predicate itself, read-only, over every prod tenant's next
> in-order billing month and assert it returns "does not block" for all of them — a
> real dry-run of the exact code, not a proxy query. If any tenant would be blocked, STOP
> and take the remediation decision with the user first. This is the one step that stands
> between the guard and a halted business.

### Tests — property matrix over sealing orderings (Deno; the engine owns the guard)

In `core.test.ts` (plus pgTAP for the SQL helper if one is authored — same matrix,
`SET LOCAL ROLE` per §7.16). Dates from one `now()` anchor, never hardcoded (§7.33).

**The property, not examples:** for three consecutive past months `{M1,M2,M3}` and each
content class per month — **billable** (marked-present lessons / unmarked expected
lessons), **empty** (no expected lessons), **all-absent** (fully marked, nothing to
bill) — replay **all 6 permutations** of billing order, asserting after every step:

- **P1 (blocks):** billing month `Mj` is REFUSED whenever some earlier `Mi` (i<j) is
  unsealed with billable content, and the error names the **earliest** such `Mi`
  ("bill Mi first"). Nothing is written, nothing sealed (§7.17 shape).
- **P2 (skips):** an earlier empty or all-absent month never blocks — `{M1 empty,
  bill M2 then M3}` succeeds with M1 never sealed.
- **P3 (releases):** after the blocking month bills, the previously refused month bills
  cleanly — in-order permutations are byte-identical to today's behaviour.
- **P4 (floor corollary):** after every step, no unsealed month with billable content
  sits below `markable_floor(tenant)` — the no-stranding invariant the guard exists for.

**Named cases** beside the matrix: cron-shaped run (no explicit `billing_month`) hits
the guard identically; `force: true` does not bypass it; two tenants — one blocked, one
clean — in the same run (per-tenant isolation, the blocked tenant's refusal doesn't
stop the clean tenant's seal).

**RED-proof (§7.25):** P1 and P4 must FAIL against the current engine (it happily seals
`{M1 billable, bill M3}` and strands M1). Record the red run before the fix. **Deno ×2**
(§7.15 — a completing run seals its month; leaked state makes a second run
short-circuit, so once proves nothing). Existing suite must stay green unchanged —
in-order billing is the only path prod has ever used, and it must not change by a byte.
No vitest/jest — no app change. `markable_floor.test.sql` untouched and green — the
floor is untouched.

### Rollback

Engine-only in the no-helper case: redeploy the previous `generate-invoices` build —
behaviour returns to today's (out-of-order sealing possible again; nothing already
sealed changes, no data loss). If the SQL helper was authored, its DOWN
(`DROP FUNCTION`) runs **after** the engine rollback, never before (the new engine
calls it by name; wrong order fails loud via `invoiceWriteFailed`, month left open —
never a silent underbill, but sequence it properly anyway). DOWN committed **and
rehearsed** before ship (§7.93).

---

## Item 2 — Engine-side credit-note lock

### Root cause

`20260818000100:263–267` gave the trigger's un-correction branch `FOR UPDATE` on the
note, closing the trigger-vs-trigger race. But the **engine's drawdown is lock-free and
non-transactional** — `supabase/functions/generate-invoices/core.ts:1396–1473`:

1. `core.ts:1403–1409` — plain `SELECT` of `status='available'` notes (no lock; a plain
   read does not even block on the trigger's `FOR UPDATE`).
2. `core.ts:1417–1424` — per-note `used` summed from `credit_applications` in a second
   round trip.
3. `core.ts:1437–1442` — `INSERT credit_applications`; `1445–1454` — flip to `applied`;
   `1461–1468` — balance decrement. **Each its own PostgREST transaction.**

Between (1) and (3) a coach's un-correction can commit `status='reversed'` and
`credit_balance -= amount`: the engine then inserts an application against a reversed
note and decrements the balance **again** — double-decrement (balance can go negative)
and an invoice discounted by credit the parent no longer holds. There is a second,
same-shaped hole with no concurrency at all: `credit` is computed from an early balance
read (`core.ts:1252–1264`) and written onto the invoice at insert (`core.ts:1268–1281`)
**before** the draw loop discovers what the notes can actually fund — if the pooled
balance and the note ledger disagree, `invoices.credit_applied` records the estimate, not
the truth.

### Fix approach — move the drawdown into ONE database transaction (RPC)

PostgREST cannot hold a multi-statement transaction, so the lock must live in the
database. New SQL function (migration), engine calls it via `.rpc()` (precedent:
`recompute_package_extensions`, `core.ts:1113–1119`):

```sql
apply_credit_to_invoice(p_parent_id UUID, p_tenant_id UUID,
                        p_invoice_id UUID, p_max NUMERIC) RETURNS NUMERIC
```

Body (single transaction, `SECURITY INVOKER`, service_role's table grants suffice):

- Lock the `parent_tenant_balances` row `FOR UPDATE` (create it if absent is NOT needed —
  a parent with no balance row draws nothing); re-read `credit_balance` **under the
  lock**; effective cap = `LEAST(p_max, balance)`.
- `SELECT … FROM credit_notes WHERE parent_id/tenant_id/status='available' ORDER BY
  issued_at, id FOR UPDATE` — serialises against the trigger's `FOR UPDATE`
  (`20260818000100:263–267`) and against Item 3's void.
- FIFO loop, porting `core.ts:1413–1457` faithfully: `used` = sum of that note's
  `credit_applications` (Item 3 later adds `AND reversed_at IS NULL` here — one line);
  self-heal flip for a zero-remainder 'available' note; partial draw leaves the note
  `available`; full consumption flips `status='applied'` + `applied_to_invoice_id` +
  `applied_at`; insert one `credit_applications` row per draw.
- Decrement the balance by the **actual** allocation; `RETURN` it.

Engine change (`core.ts`): delete lines 1396–1473; keep the pre-computation of `credit`
as an *estimate* for the invoice insert; after inserting invoice + items + package rows,
call the RPC with `p_max = gross − packageApplied` capped as today; if the returned
allocation ≠ the estimate, `UPDATE invoices SET credit_applied, net_amount, status`
(paid ⇔ net 0) to the truth and patch the `created[]` entry so the email states the real
figures. An RPC **error** sets `invoiceWriteFailed = true` and skips sealing — the
existing §7.17 retry path — never a silent zero-credit invoice.

> ⚠ **RISK 2 MITIGATION — the RPC commits independently, so a retry must not double-draw.**
> The RPC's draws + balance decrement commit in their own transaction; if any *later*
> engine step (the invoice truth-up, the seal) fails, the §7.17 retry re-enters and would
> draw the same credit a SECOND time — negative balances, invoices discounted by credit the
> parent never held. Two structural fixes, both required:
> - **Make `apply_credit_to_invoice` idempotent on `p_invoice_id`.** First statement under
>   the lock: if any non-reversed `credit_applications` already exist for `p_invoice_id`,
>   RETURN their sum and draw nothing. A retry is then a no-op, not a second draw.
> - **Fold the invoice truth-up INTO the RPC transaction.** Pass `gross` and
>   `packageApplied`; the RPC writes `credit_applied`/`net_amount`/`status` itself, in the
>   same transaction as the draw, deleting the post-draw engine write and the window where
>   credit is drawn but the invoice is not updated. The engine only reads the return for the
>   email. Any write that must remain post-RPC may only WIDEN what the RPC made consistent,
>   never re-draw.
> Pin both: a test that calls the RPC twice for one invoice and asserts the second call
> draws $0 and the balance moved exactly once (RED against a non-idempotent body).

Also fixes the estimate-vs-truth hole above for free: `credit_applied` now always equals
`SUM(credit_applications)` for the invoice — the 20260711000100 invariant, restored.

**Why not "lock in the trigger only"**: the trigger's lock only serialises writers that
also take locks. **Why not conditional-UPDATE claims from JS**: partial draws mean a note
must stay `available` while drawn against, so no single compare-and-swap exists; and the
balance decrement would still be a separate transaction.

### Files / migration / deploy order (migrations → engine → apps, §7.60)

- `supabase/migrations/2026XXXX_apply_credit_to_invoice.sql` — the function; grants per
  §7.87/§7.35 **both layers**: `REVOKE ALL … FROM PUBLIC;` `GRANT EXECUTE … TO
  service_role;` nothing to `authenticated`/`anon` (engine-only surface — note this is
  the *opposite* polarity of 20260806000200's floor functions).
- `supabase/rollback/2026XXXX_apply_credit_to_invoice_DOWN.sql` — `DROP FUNCTION`.
- `supabase/functions/generate-invoices/core.ts` — the swap above.
- Deploy: land migration on `main` → `supabase db push` (or migration apply) → **then**
  `supabase functions deploy generate-invoices` (a git push does NOT deploy it — confirm
  with `supabase functions list`) → no app deploy. Remote **grant dump** after the
  migration (§7.39/§7.89, `docs/DEPLOYMENT.md` §11.7) — a new function + grants is
  exactly the role×object cell that has burned three times.
- **Rollback order is the reverse**: redeploy the previous engine build first (it carries
  the old JS drawdown), *then* run the DOWN. Running the DOWN under the new engine fails
  loud (RPC error → `invoiceWriteFailed`, month left open) — never a silent underbill,
  but sequence it properly anyway.

### Tests

- **pgTAP** `credit_drawdown.test.sql` (new): FIFO order across notes (issued_at, then
  id) · partial draw leaves `available` and correct remainder · full draw flips
  `applied` + stamps `applied_to_invoice_id`/`applied_at` · allocation capped by balance
  · capped by `p_max` · a `reversed` note is never drawn · self-heal branch · tenant
  scoping (a sibling tenant's note untouched) · balance never negative · return value =
  sum of applications inserted. **RED-proof:** trivially red pre-migration (function
  absent) — state that plainly; the *behavioural* pins guard the port.
- **Deno ×2** (§7.15 — a completing run seals; once proves nothing): all existing credit
  tests in `core.test.ts` must pass **unchanged** through the RPC path — they are the
  port-regression net.
  > ⚠ **RISK 8 MITIGATION — the port-regression net only catches what it covers.** Before
  > relying on the existing suite, grep it and CONFIRM it exercises each branch the port
  > must preserve: partial draw (note stays `available`), full consumption (flip to
  > `applied` + stamps), multi-note FIFO order, self-heal of a zero-remainder note, and
  > balance-cap vs `p_max`-cap. Any branch not already asserted gets a new pgTAP case
  > BEFORE the port lands — a port validated by tests that never touch its riskiest branch
  > is unvalidated. Assertion: every bullet in the `credit_drawdown.test.sql` list maps to
  > a branch of the deleted JS, proven by removing that branch and watching the case go red. **New, genuinely RED-provable test (§7.25):** seed
  `parent_tenant_balances.credit_balance = 30` with only $20 of available notes → today's
  engine writes `credit_applied = 30` on the invoice while drawing 20 (RED against
  current `core.ts`); after the fix the invoice records 20. Run the whole suite twice.
- **Race rehearsal (manual, scripted, run once before ship — documented in the plan, not
  CI):** psql session A: `BEGIN;` un-correct an attendance row (trigger takes its
  `FOR UPDATE`), hold; session B: `SELECT apply_credit_to_invoice(...)` → observe B
  **block**; A `COMMIT` → B completes drawing $0 from the now-reversed note. This is the
  serialisation property itself, observed rather than argued.
- `function_grants.test.sql` — add the new function's rows (service_role EXECUTE yes;
  authenticated/anon no). RED pre-migration.
- No vitest/jest — no app change.

---

## Item 3 — Admin void action for a credit note (`CN001`'s destination)

### Root cause

`20260818000100:282–289` refuses to un-correct a lesson whose credit note is spent —
`RAISE … ERRCODE 'CN001'` — because reversing spent credit silently reopens a past
invoice; the refusal is deliberate and stays. But the recovery it names does not exist:
`SwimSyncApp/lib/attendanceSaveError.ts:8–13` tells the coach "…reversed manually, so
please contact support", and the admin credit-notes page
(`SwimSyncAdmin/app/(admin)/credit-notes/page.tsx`) is read-only apart from Resend — the
only real route today is hand-written SQL.

### Fix approach — a guarded, audited `void_credit_note()` RPC + admin UI

**Migration** (`db/void-credit-note` branch):

1. `ALTER TABLE credit_applications ADD COLUMN reversed_at TIMESTAMPTZ, reversed_by
   UUID;` — the ledger stays permanent (its 20260711000100 doctrine and PRD §5.6's
   "permanent records"); a void *marks* draws reversed rather than deleting history.
   (DELETE-with-audit-JSON was considered and rejected: it breaks the FK-backed trail
   and the `SUM(applications) = credit_applied` reconciliation story.)
2. `void_credit_note(p_note_id UUID, p_reason TEXT) RETURNS VOID`, `SECURITY DEFINER`,
   `SET search_path = public`:
   - `auth.uid()` required; tenant derived **from the note row**, never a parameter
     (the `schedule_extra_lesson` pattern, §7.42); authorise with
     `is_tenant_admin(v_tenant)` — **tenant admins of the note's business ONLY, no
     platform-admin void** (resolved Q3; mirrors the resend path's authority). Require
     non-blank `p_reason`.
   - `SELECT … FROM credit_notes WHERE id = p_note_id FOR UPDATE` — serialises against
     the trigger (`20260818000100:263–267`) and Item 2's engine lock. Refuse if already
     `reversed`.
   - **Unwind live draws** (the spent case CN001 exists for): for each
     `credit_applications` row with `reversed_at IS NULL`: stamp
     `reversed_at/reversed_by`; `UPDATE invoices SET credit_applied = credit_applied −
     amount, net_amount = net_amount + amount, status = 'outstanding'` (leave
     `paid_at`/`paid_marked_by` as history; `payment_records` untouched). **Resolved
     Q2: the invoice reopens to outstanding and NO auto-email goes to the parent in
     v1** — the admin communicates; a voided note is already hidden from the parent app.
     > ⚠ **RISK 4 MITIGATION — a reopened invoice may hold a `payment_records` row, and
     > code elsewhere may assume `paid ⇔ has payment_record`.** Before writing the unwind,
     > `grep -rn "payment_records\|status.*paid\|'paid'\|\"paid\"" SwimSyncAdmin SwimSyncApp
     > supabase` and confirm no consumer treats "has a payment record" or "was ever paid"
     > as "is settled" in a way an `outstanding` status now contradicts (the Invoices list
     > totals, the WhatsApp-reminder "outstanding" filter, `confirm_invoice_paid`'s
     > idempotency, the parent invoice view). Each hit is either shown to correctly key off
     > `status`, or fixed in THIS migration. Assertion, pinned in pgTAP: after voiding a
     > drawn note, the invoice is `outstanding`, its pre-existing `payment_records` rows are
     > byte-unchanged, and the outstanding-total / reminder-eligibility queries count it
     > again. Do NOT delete or alter `payment_records` — history is immutable (PRD §5.6).
   - Mark the note: `status='reversed'`, `reversed_at/reversed_by`, and **clear
     `applied_to_invoice_id`/`applied_at`** — without this, a later re-correction
     re-activates the note (`20260818000100:207–233`, which does not clear them) and the
     *next* un-correction spuriously trips CN001 on the stale spend signal.
   - Balance: decrement `parent_tenant_balances` by the note's **undrawn remainder
     only** (`amount − SUM(live draws)`) — the drawn part was never in the pool; it
     comes back to the tenant as the reopened invoices' increased net. Assert
     `credit_balance >= 0` after.
   - `audit_log` row (`action: 'credit_note_voided'`, old/new state incl. every
     application unwound and every invoice reopened, the reason, the actor).
3. **Trigger edit** (`handle_attendance_update`, its NINTH definition — confirm the
   newest body is `20260818000100` per its own line 119 grep before touching):
   - `v_cn_drawn` check (`20260818000100:273–275`) gains `AND ca.reversed_at IS NULL` —
     reversed draws are not spend signals, or a voided-then-reactivated note can never be
     un-corrected again.
   - Re-activation branch also clears `applied_to_invoice_id/applied_at` (defence in
     depth with 2's clear — either alone suffices, both make the invariant "a reversed
     note carries no spend signals" structural).
   > ⚠ **RISK 5 MITIGATION — this is the load-bearing credit trigger, shipped ONE DAY ago
   > (§8.68); the edit must not regress the symmetric-credit fix.** The whole
   > `credit_note_double_credit.test.sql` suite must stay **green, unchanged in count**,
   > and be RED-proven still meaningful (temporarily break one branch, watch it fail),
   > then run the Deno suite **twice** (§7.15). Confirm the newest `handle_attendance_update`
   > body is `20260818000100`'s by `pg_get_functiondef()` before editing, NOT by grepping
   > the migration that created it (§7.115 — `CREATE OR REPLACE` means grep finds the oldest).
   > The DOWN restores the 20260818000100 body as an **exact literal**, verified by a
   > functiondef byte-diff (§7.92/§7.93), never a regex strip.
4. Item 2's `apply_credit_to_invoice()`: `CREATE OR REPLACE` adding
   `AND ca.reversed_at IS NULL` to its `used` sum. **No engine redeploy** — the engine
   calls the function by name; this is the payoff of doing Item 2 first.
5. Grants (§7.87/§7.35): `REVOKE ALL FROM PUBLIC`; `GRANT EXECUTE TO authenticated`
   (the function self-authorises); nothing to anon/service_role.
6. Apply-time probe: no `credit_applications` row has `reversed_at` set at apply
   (backfill-free migration); exactly one `handle_attendance_update` in `pg_proc`.

> ⚠ **RISK 6 MITIGATION — every place that sums or counts `credit_applications` must
> decide about `reversed_at`; a missed one makes a voided note read spent in one surface
> and available in another.** The four spots below are the KNOWN consumers, not a trusted
> list — `grep -rn "credit_applications" SwimSyncAdmin SwimSyncApp supabase` is the fact
> (the §3 "grep for callers, don't trust a list" doctrine). Enumerate every hit and mark
> each: filters `reversed_at IS NULL` (live-only), or intentionally raw (full history) with
> a one-line why. Assertion: the grep count equals the number of consumers accounted for in
> this plan; a new hit found later is an unshipped bug. The reconciliation invariant to
> keep whole: `invoices.credit_applied == SUM(credit_applications WHERE reversed_at IS NULL)`
> for every invoice, pinned in pgTAP after a void.

**Post-migration app/function changes** (deploy AFTER the migration — the UI *calls* the
new RPC, so the normal §7.60 order applies, unlike Wave D's tolerate-only inversion):

- `SwimSyncAdmin/app/(admin)/credit-notes/page.tsx` — a **Void** action per non-reversed
  row: tenant-admin-of-this-note's-business gating exactly like Resend (the `viewer`
  state, lines 72–83); inline confirm with a required reason field (web page — inline,
  never `Alert`); `supabase.rpc("void_credit_note", …)`; on success set the row
  `reversed` locally. For a **drawn** note the confirm must state the consequence: "this
  removes S$X already applied to invoice(s) …, which become outstanding again."
- Same page, `has_applications` embed (line 118, 144): select `reversed_at` in the embed
  and count only live rows — a voided note must not read as spent.
- `supabase/functions/credit-note-emails/core.ts:118` — the `spent` set must filter
  `reversed_at IS NULL`, or a voided-then-reactivated note is unsendable forever
  (`isSendableNote`, `email.ts:130–138`, treats any application as spent). Requires
  `supabase functions deploy credit-note-emails`.
- `SwimSyncApp/lib/attendanceSaveError.ts` — CN001 copy: "…ask your admin to void this
  lesson's credit note on the Credit Notes page (its amount was already applied to an
  invoice), then mark again." Replaces "contact support".
- PRD §5.6 gains the void paragraph at `/update-docs` time (docs lane, not this plan).

### Files

- `supabase/migrations/2026XXXX_void_credit_note.sql` + committed DOWN.
- `SwimSyncAdmin/app/(admin)/credit-notes/page.tsx` (+ a small extracted helper for the
  void-eligibility/consequence label, for vitest).
- `supabase/functions/credit-note-emails/core.ts` (+ its Deno tests).
- `SwimSyncApp/lib/attendanceSaveError.ts` (+ jest).
- `supabase/tests/void_credit_note.test.sql` (new); `function_grants.test.sql` rows.

### Tests (each proven RED first, §7.25)

- **pgTAP** `void_credit_note.test.sql`:
  - Undrawn void: note → `reversed`, balance −amount, audit row written. (RED: function
    absent.)
  - **Drawn void**: application stamped reversed; invoice `credit_applied`/`net_amount`
    restored and `status='outstanding'`; balance decremented by the **remainder only**;
    `credit_balance >= 0`.
  - Partially-drawn note ($30 note, $20 drawn): invoice +$20, balance −$10.
  - Already-`reversed` → raises; blank reason → raises; wrong tenant's admin → raises;
    coach/parent role → raises; nothing written on any refusal.
  - **The CN001 exit path end-to-end**: seed spent note → un-correct raises CN001 (RED
    baseline stays red) → `void_credit_note()` → the same un-correct now **succeeds**
    (note filtered out by `status <> 'reversed'`), no balance movement.
  - **Re-toggle after void**: present→absent re-activates the voided note
    (`+amount`, `email_sent_at` NULL) with `applied_to_invoice_id` clear; a subsequent
    absent→present **voids cleanly instead of raising CN001**. (RED against the
    20260818000100 trigger — this is the trigger-edit's proof.)
- **Deno**: `credit-note-emails` — a note with only *reversed* applications is sendable;
  one with a live application is not (RED against current `core.ts:118`). Generate-
  invoices suite ×2 (§7.15) — must stay green (drawdown skips reversed apps via Item 2's
  function).
- **vitest** (admin): void button rendered only for the viewer's own tenant's
  non-reversed notes; drawn-note confirm names the amount and invoices; `reversed_at`
  filtering of `has_applications`. (RED: helper absent.)
- **jest** (app): CN001 copy names the admin void path. (RED: current copy says contact
  support.)

### Rollback

`2026XXXX_void_credit_note_DOWN.sql`, committed + rehearsed (§7.93): drop
`void_credit_note()`; restore `handle_attendance_update` **as the exact literal** of the
20260818000100 body (functiondef-diff byte-identical); restore Item 2's function body
without the reversed filter; drop `credit_applications.reversed_at/reversed_by`.
**Caveat recorded in the DOWN header**: if any void has run, dropping the columns erases
which draws were reversed — the audit_log rows are then the only record; do not roll back
past a live void without exporting them. Admin/app UI tolerates the function vanishing
(RPC error surfaces inline); redeploy previous apps only if the button must disappear.

---

## Ordering, dependencies, and the §7.55 spine

**Recommended order: Item 1 → Item 2 → Item 3.** One migration in flight at a time;
each (where one exists) lands on `main`, applies, and goes green before the next branch
is cut.

| # | Migration | Engine deploy | App deploy | Why this slot |
|---|---|---|---|---|
| 1 | **none** (optional small SQL helper only — decided at implementation) | **yes** (`generate-invoices`, the ordering-guard) | none | HANDOVER names it the most consequential; the guard closes the stranding door before Items 2–3's billing changes go near the engine; prod measurement may surface an already-stranded month needing one-time remediation first |
| 2 | `apply_credit_to_invoice` | **yes** (`generate-invoices`) | none | must precede Item 3: once drawdown lives in the DB, Item 3's reversed-filter is a `CREATE OR REPLACE`, not an engine redeploy; also gives void a lock to serialise against |
| 3 | `void_credit_note` + trigger v9 + `credit_applications.reversed_at` | none (Item 2's payoff) | **yes** — admin UI, coach copy, plus `credit-note-emails` function deploy | UI calls the RPC ⇒ normal migrations → functions → apps order (§7.60); apps land on `main` **last** |

Items 2 and 3 are dormant today (0 credit notes on prod, manual monthly billing), so the
sequence can pause between items if needed — but scope is resolved (Q4): **all three
build this wave**, in this order. For the record, Item 3 without Item 2 would cost an
extra engine deploy (the `used` sum in `core.ts:1417–1424` would need the reversed
filter) and leave the void-vs-drawdown race open — do not re-order.

Every migration (Item 1 may have none): written in the root checkout on a `db/…`
branch, `supabase db reset` + `supabase test db` before merge; Deno suite **twice**
after anything touching billing (§7.15); remote **grant dump** after Items 2 and 3, and
after Item 1's helper if it is authored (new functions/grants — §7.39, §7.89).
`.claude/skills/run-ui-playwright/drivers/check-fixture-roundtrip.sh` before pushing
anything that lands beside fixtures.

## RESOLVED QUESTIONS (user review, 2026-08-18)

All four are decided; the plan above already reflects them. Recorded here so the
reasoning survives:

1. **Item 1 floor approach → engine ordering-guard, NOT the contiguity floor.** The
   contiguity floor was rejected because lowering the floor to reopen a stranded month
   also lowers the coach app's visible window (`backlogWindowStart`,
   `SwimSyncApp/lib/lessonDates.ts:232`, takes `min(floor, 1st-of-last-month)`),
   re-exposing the **sealed** months above the gap to editing — a single floor date
   cannot express "August open, sealed months above it closed". The guard forces
   in-order billing instead; the "bill September while July is disputed" workflow is
   knowingly given up (a disputed lesson is resolved or marked *cancelled*, then the
   month bills — never skipped).
2. **Item 3 void behaviour → reopen the invoice to `outstanding`, NO auto-email to the
   parent in v1.** `paid_at`/`paid_marked_by` stay as history; the admin communicates
   the reopened balance; a voided note is already hidden from the parent app.
3. **Item 3 void authority → tenant admins of the note's business only**
   (`is_tenant_admin`, matching Resend). No platform-admin void; support cases route
   through the tenant admin.
4. **Scope → all three items this wave.** BACKLOG's "park the engine lock until cron"
   note is superseded: Item 3 leans on Item 2's lock, so both build now, in the
   1 → 2 → 3 order above.

## Pre-commit gate (walk before committing each item)

Every box is a blocker, not a caveat — a box that cannot be ticked stops the ship. The
**starred** two are the ones that prevent an unrecoverable, user-visible failure; they
gate the deploy even if everything else is green.

**Item 1 (before deploying the engine guard):** — branch `feature/item1-ordering-guard`
(`1a17d33` + review `5d08f4d`), engine-only, NO migration. Deno **227 ×2 green**. Not merged/deployed.
- [x] **★ RISK 7** — prod queries (1)+(2) run 2026-08-18 → both `[]` (recorded in Measurement).
  **Still owed before deploy:** the predicate dry-run over every prod tenant's next month
  (needs prod data; run at deploy time). Any block → STOP, remediate with the user first.
- [x] **RISK 1** — predicate reuses `expectedStudentsOn`/`expectedLessonDates`; empty/all-absent
  proven skippable (P2 + cross-check); predicate errors fail SKIPPABLE (whole body try/catch → null).
- [x] **RISK 3** — in-order outcomes byte-identical (P4); prod-shape replay test (one sealed →
  next in order → no block) passes.
- [x] P1/P4 RED-proven (guard neutralised → exactly the 7 block-assertions fail); below-floor
  seal-term RED-proven (drop seal term → 3 fail); Deno suite green **twice** (§7.15).
- [x] **DEPLOYED 2026-08-18:** `generate-invoices` v24 live; RISK 7 prod dry-run clean (only tenant
  73c243a8 has lessons — 2026-07 sealed, 2026-08 unsealed but not yet billable → guard is a no-op);
  served bundle byte-matches source (download + clean git status), `earlier_month_unbilled` present.

**Item 2 (before deploying the RPC + engine):** — branch `feature/item2-credit-lock` (`2291691`,
off Item 1). Migration `20260818000200`. Deno **228 ×2**, pgTAP **1141 PASS** (credit_drawdown 29).
Signature simplified to `(p_invoice_id)` — invoice is the single source of scope+amounts.
- [x] **★ RISK 2** — RPC idempotent on `p_invoice_id` (sum-under-lock, returns without drawing);
  invoice truth-up folded into the RPC transaction; double-call pgTAP proves 2nd call draws $0,
  balance moved once — RED-proven (guard disabled → 4 assertions fail).
- [x] **RISK 8** — existing Deno covered full/partial/cap/scoping/carry-forward; **added** to pgTAP:
  multi-note FIFO, self-heal, reversed-never-drawn, idempotency, balance-never-negative, return-value.
- [x] `function_grants.test.sql` rows added (service_role EXECUTE only). **Owed at deploy:** remote grant dump.
- [x] Race rehearsal run (session B blocked on the note's FOR UPDATE, drew $0 after reverse committed);
  estimate-vs-truth test RED against current engine (`credit_applied=30` with $20 notes).
- [x] **DEPLOYED 2026-08-18:** migration `20260818000200` applied to prod (remote filled); engine v24
  live; grant dump confirmed on prod — `apply_credit_to_invoice` = service_role EXECUTE only.

**Item 3 (before deploying migration → functions → apps):** — branch `feature/item3-admin-void`
(`b18375f`, off Item 2). Migration `20260818000300`. pgTAP **1171** (void 28), Deno **229 ×2**,
admin vitest **452** + typecheck, app jest **391** + typecheck.
- [x] **RISK 4** — consumers grepped; all key off `status` EXCEPT the parent view's `Paid {paid_at}`
  badge → **DEVIATION FROM PLAN (accepted):** the void CLEARS `paid_at`/`paid_marked_by`/`paid_claimed_at`
  on reopened invoices (an `outstanding` invoice must not show a Paid badge); `payment_records` left
  immutable; `confirm_invoice_paid` still works (gates on `status='paid'`). pgTAP pins payment_records
  unchanged. **KNOWN v1 EDGE (flag to user):** voiding a credit drawn on an already-CASH-PAID invoice
  reopens it to `net += amount` outstanding while its `payment_records` show the old lower net — the
  admin reconciles the difference by hand (no partial-payment accounting in v1; dormant, 0 notes on prod).
- [x] **RISK 5** — newest trigger body confirmed via `pg_get_functiondef()`; §8.68 suite untouched, still
  15 tests, green; trigger v9 diff is EXACTLY edits A+B (verified by body diff); DOWN restores §8.68 byte-faithful.
- [x] **RISK 6** — every `credit_applications` consumer filters `reversed_at IS NULL` (apply_credit both
  sums, trigger `v_cn_drawn`, `credit-note-emails/findSpentNoteIds`, admin `has_applications`);
  `credit_applied == SUM(non-reversed)` pinned in pgTAP.
- [x] Re-toggle-after-void test RED against the 20260818000100 trigger (RED-proofing caught a weak first
  assertion; the true re-toggle fails 2 tests without edit A); DOWN caveat written into the header.
  Also: `audit_log_tenant_of()` gained a `credit_note` arm (§8.28 requires every entity type registered).
- [x] **DEPLOYED 2026-08-18:** migration `20260818000300` applied (remote filled); `credit-note-emails`
  v2 live (reversed filter in served bundle); grant dump confirmed — `void_credit_note` = authenticated
  EXECUTE only; apps pushed to `main` LAST (`572dbaf..8766682`). **App build: confirm Vercel went green
  (§11.27) — void UI + CN001 copy are auth-gated, not greppable from outside.**

**Graduate the durable ones:** at `/update-docs`, RISK 2 (RPC-commits-then-retry double-draw)
and RISK 6 (grep every `credit_applications` consumer for `reversed_at`) outlive this task —
promote them to `docs/GOTCHAS.md` §7 so `/session-start` re-surfaces them, not only this plan.
