# Wave 3 follow-up — the owed migration, and the driver that was never written

_Written 2026-08-12. Two `BACKLOG.md` items, both **S**, both descended from Wave 3 (§8.44):
the `assign_session_coach` shadow-branch guard (bundled with `sessions_i_am_main_on`, as that
item instructs) and `verify-coach-roster.mjs`._

**Scope settled with the user before planning:**

| Question | Answer |
|---|---|
| Ship `sessions_i_am_main_on` only, or switch the app to it? | **Function + switch the coach app.** A function nobody calls is dead code carrying a grant. |
| How much of the manual walk does the driver automate? | **The full walk, both apps** — admin assigns, substitute teaches, replaced coach goes quiet. |
| Where does it land? | **Production.** Migration first, then `main`. |

**Not in scope:** the Attendance page's Coach column (**S**, `BACKLOG.md`) — it is the third
Wave 3 item and carries a product choice the user has not made. It stays filed.

---

## The shape of the whole job

Four commits, in this order, because each is the previous one's proof:

1. `db/session-roster-guard` — the migration + its DOWN file + pgTAP.
2. The coach app switched onto `sessions_i_am_main_on`.
3. `verify-coach-roster.mjs` + fixture + teardown.
4. Docs.

**Steps 1 and 3 are independent** — a driver needs no schema change (`BACKLOG.md` says so
explicitly: *"do not wait for one"*). Step 2 depends on Step 1 having been **deployed**, not
merely written. That dependency is the whole of §11.9 and it governs the deploy order below.

> ### ⚠ RISK 6 MITIGATION — "four commits on one branch" and "a `db/…` branch" are two different plans, and §11.9 is what punishes the ambiguity
>
> The first draft of this section said *one branch*, while Step 1's own heading says
> *root checkout, `db/…` branch*. `CLAUDE.md` settles it and this plan now states it once:
>
> **The branch topology is TWO branches, not one.**
>
> 1. `db/session-roster-guard` holds commit 1 **only** (migration + DOWN + pgTAP). It is
>    merged to `main` and pushed **on its own**, before any app code exists. Landing it on
>    `main` early is safe precisely because it is additive — no app commit rides along, so
>    the Vercel rebuild it triggers ships byte-identical behaviour.
> 2. `supabase db push` runs **from `main`, after that merge**, and is proven landed
>    (Step 6.2) before commit 2 is even written.
> 3. `feat/coach-roster-batch` then holds commits 2–4 and is merged last.
>
> **Named prohibition: commit 2 must never share a push with commit 1.** A single
> `git push` carrying both is the §11.9 failure verbatim — Vercel builds the coach app
> from `main` the instant the push lands, and it would call `sessions_i_am_main_on`
> against a production database that has not got it yet.
>
> **Pass/fail before commit 2 is written:** `supabase migration list --linked` shows
> `20260812000100` with its **remote column filled**. Not filled = stop, do not write app
> code.

Rough cost, end to end: **about five hours.** Migration + pgTAP ~1.5h, app switch ~45m,
driver ~2h, verification + deploy ~1h.

---

## Step 1 — The migration (root checkout, `db/…` branch, ONE file)

`supabase/migrations/20260812000100_session_roster_guard.sql`. One schema change in flight
at a time (§7.55); the queue is empty, so this is the one.

### 1.1 The guard — and the obvious form of it is wrong

`BACKLOG.md`'s cheapest form is *"raise in the shadow branch when the coach already holds
`role = 'main'` on that session"*. Written literally that is a pre-check:

```sql
IF EXISTS (SELECT 1 FROM session_coaches
            WHERE lesson_session_id = v_session AND coach_id = p_coach_id AND role = 'main')
THEN RAISE EXCEPTION …
```

**That is TOCTOU-vulnerable, and the race is the exact bug being fixed.** Admin A promotes
Coach X to main; admin B, in the same instant, adds X as a shadow. B's `EXISTS` cannot see
A's uncommitted row, so it passes — and then B's `INSERT` blocks on the unique index, A
commits, and `DO UPDATE SET role = 'shadow'` demotes the main that B was just told did not
exist. The guard would refuse the easy case and let the hard one through.

**Use the atomic form instead** — one statement, so the conflicting row is locked, not
merely looked at:

```sql
INSERT INTO session_coaches (tenant_id, lesson_session_id, coach_id, role, assigned_by)
VALUES ('00000000-0000-0000-0000-000000000000', v_session, p_coach_id, 'shadow', auth.uid())
ON CONFLICT (lesson_session_id, coach_id) DO UPDATE
  SET role = 'shadow'
  WHERE session_coaches.role <> 'main';

IF NOT FOUND THEN
  RAISE EXCEPTION 'that coach is already the main coach for this lesson — '
                  'change the main coach first, or the lesson would be left with none';
END IF;
```

Three properties this form has and the pre-check does not:

- **Idempotent still.** Re-adding an existing shadow updates `role` to the value it already
  holds, so `FOUND` is true and nothing raises. The existing pgTAP *"assigning the same cover
  twice does not raise"* keeps its meaning.
- **Race-free.** `ON CONFLICT` waits on the conflicting row's lock, so the `WHERE` is
  evaluated against the committed row, not a snapshot taken before it existed.
- **Loud, not silent.** Without the `IF NOT FOUND` the excluded row would simply not update
  and the RPC would return success having done nothing — which is `ON CONFLICT DO NOTHING`
  wearing a different hat, and §7.129/`set_session_main_coach`'s own comment is the standing
  refusal of exactly that.

**The message is user-visible verbatim.** `lesson-coaches/page.tsx:307` renders
`Could not assign: ${error.message}`. Keep it a sentence an admin can act on. The client's
own pre-check (`page.tsx:284`) **stays** — it produces the friendlier named version and
avoids a round trip; the server guard is what covers the second tab and every non-UI caller.

**The `main` branch is untouched.** Promoting a shadow to main is legitimate:
`set_session_main_coach()` deletes the old main first, then upserts. Only the demote
direction is a bug.

> ### ⚠ RISK 8 MITIGATION — the Postgres semantics above are MEASURED, not assumed; do not re-litigate them, and do not "improve" the form
>
> Run against the local stack on 2026-08-12, in a rolled-back transaction, on a table with
> `UNIQUE (a)` and a plpgsql wrapper shaped exactly like `assign_session_coach`'s ELSE
> branch. **Verbatim result:**
>
> | Call | `FOUND` |
> |---|---|
> | fresh insert (no conflicting row) | `FOUND` |
> | re-insert over an existing `shadow` | `FOUND` |
> | insert over an existing `main` (DO UPDATE excluded by its `WHERE`) | **`NOT FOUND`** — and the row was still `main` afterwards |
>
> `RAISE`'s two adjacent string literals across a newline also parse and concatenate
> (`RAISE NOTICE 'part one — ' 'part two'` → `part one — part two`). Both claims hold.
>
> **Named prohibitions attached to this step:**
> - **Do NOT put any statement between the `INSERT … ON CONFLICT` and the `IF NOT FOUND`.**
>   `FOUND` is clobbered by the next `SELECT`/`PERFORM`/assignment-with-query, and a
>   clobbered `FOUND` turns the guard into a no-op that still looks like a guard.
> - **Do NOT hoist the guard above the `IF p_role = 'main' THEN … ELSE` split.** It belongs
>   inside the **ELSE (shadow) branch only**. Above the split it would fire on the
>   `set_session_main_coach()` path and break *promoting a shadow to main* — a legitimate
>   admin action that works today.
> - **Do NOT replace it with the `EXISTS` pre-check** if the pgTAP goes red for an unrelated
>   reason. The pre-check is the TOCTOU bug this section exists to refuse.

> ### ⚠ RISK 2 MITIGATION — the guard as written covers the ROW main, and the bug it prevents is also reachable through the ABSENCE main
>
> `assignableShadows()` (`SwimSyncAdmin/lib/sessionRoster.ts:230`) excludes the main **by
> coach id, not by roster row**, and its own comment says why: *"a fallback main holds no
> row, so a row-based check would happily offer the class's own coach as a shadow of the
> lesson they are already teaching … the write gate and the pay path would then be reading
> different halves of it."* The client pre-check at `page.tsx:285` compares
> `lesson.main.coach_id`, which is likewise the **effective** main.
>
> `ON CONFLICT … WHERE session_coaches.role <> 'main'` sees only an explicit row. So on a
> lesson with **no roster main at all**, adding the class's own coach as a shadow still
> succeeds — from a second tab, from a stale dropdown, from any non-UI caller — and creates
> exactly the contradictory session `sessionRoster.ts` warns about: main by the absence
> rule, shadow by an actual row. The server guard must mirror the client's rule, not half
> of it.
>
> **Add, inside the ELSE branch, BEFORE the atomic insert** (and therefore before the
> statement whose `FOUND` is read):
>
> ```sql
> -- The ABSENCE-RULE main. There is no row to conflict with, so this half cannot be
> -- atomic; the race is bounded and benign — the only way to lose it is for somebody to
> -- install a real main in the same instant, after which a shadow row for the class's
> -- coach is legitimate. The row-main half below is the one that had to be race-free.
> IF NOT EXISTS (
>       SELECT 1 FROM session_coaches sc
>        WHERE sc.lesson_session_id = v_session AND sc.role = 'main')
>    AND EXISTS (
>       SELECT 1 FROM lesson_sessions ls JOIN classes c ON c.id = ls.class_id
>        WHERE ls.id = v_session AND c.coach_id = p_coach_id)
> THEN
>   RAISE EXCEPTION 'that coach already teaches this lesson as the class''s coach — '
>                   'adding them as a shadow would say two different things about one person';
> END IF;
> ```
>
> **Named prohibition: do NOT reach for `coach_is_main_on_session()` here.** It answers
> about `current_coach_id()`, and the caller of this function is the **admin**, not the
> coach being assigned. It would return FALSE for every admin and the guard would never
> fire — a check that cannot see what it is checking, §7.125's shape exactly.
>
> **Pass/fail:** pgTAP checks 12–13 below. Both must be red under the DOWN file.

### 1.2 `sessions_i_am_main_on(uuid[])`

```sql
CREATE OR REPLACE FUNCTION public.sessions_i_am_main_on(p_session_ids UUID[])
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id FROM unnest(p_session_ids) AS s(id)
   WHERE coach_is_main_on_session(s.id);
$$;
```

**It delegates to `coach_is_main_on_session()` rather than restating the rule.** That is the
§7.129 lesson applied before it can bite: two copies of "who is main" is the bug waiting to
happen, and the absence rule (no roster main → the class's coach) is subtle enough that a
second copy would drift. The win here is **one round trip**, not one query — which is all
`BACKLOG.md` claims for it (*"latency insurance, not a fix"*).

`SECURITY DEFINER` is not optional: §7.134 is the whole reason the probe exists — the row
naming the substitute is invisible to the coach it replaced, whose screen is the one that
must stop nagging.

> ### ⚠ RISK 1 MITIGATION (server half) — this function's contract is what the client is allowed to trust, so pin it
>
> The client (§3.2) computes *covered out* as **asked minus returned**. Every way the
> server can return less than the truth therefore hides a lesson that needs marking, and
> unmarked attendance blocks the billing month with **no override**. Three contract
> properties must hold, and each is a pgTAP check, not a comment:
>
> - **Never returns an id that was not asked about.** `unnest` over the argument guarantees
>   it; check 14 asserts it, because the client's shape validation (§3.2) treats an unasked
>   id as evidence the whole response is untrustworthy.
> - **Never returns the same id twice.** `unnest` does not deduplicate, so a caller passing
>   a duplicate gets a duplicate back. The client de-dupes before sending, but the server
>   must not be the thing that makes the counts disagree. Check 15.
> - **No `LIMIT`, no `ORDER BY`, no pagination, ever.** A truncated answer is
>   indistinguishable from "somebody else has these lessons".
>
> **Named prohibition: do NOT add a `p_limit`, a `p_since`, or any date filter to this
> function.** Narrowing the answer set is the unsafe direction by construction. If the
> probe set ever needs bounding, bound it at the **caller** (§3.2's cap), where returning
> nothing is the loud outcome.
>
> **Do NOT restate the main-coach rule.** The body is `coach_is_main_on_session(s.id)` and
> nothing else — §7.129's lesson. Check 16 is what stops a later "optimisation" inlining it.

### 1.3 Grants — §7.87

**A new function is callable by NOBODY until its own migration grants it.** Append
`sessions_i_am_main_on(uuid[])` to the same `REVOKE … FROM PUBLIC, anon` + `GRANT EXECUTE …
TO authenticated, service_role` block shape used at `20260811000200:860`. `assign_session_coach`
already has its grant and `CREATE OR REPLACE` preserves it — but re-assert it in the loop
anyway, because that is cheaper than being wrong.

Expected effect on the standing checks: `anon` EXECUTE stays **18**, `table_grants.test.sql`
is untouched (no table privilege changes).

> ### ⚠ RISK 8 MITIGATION (grants half) — assert the DELTA, not the number
>
> **18** is a *production dump* figure (`docs/DEPLOYMENT.md` §11.4/§11.7). The equivalent
> local query answers **13** — different object sets, both correct, and a plan that hard-codes
> one number invites "the count is wrong, re-grant something", which is the blanket re-grant
> §7.87 forbids.
>
> **Do this instead, as a step:** capture the count **before** applying the migration and
> **after**, with the same query on the same database, and assert they are equal.
>
> ```sh
> docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc \
>   "SELECT count(*) FROM information_schema.role_routine_grants
>     WHERE grantee='anon' AND privilege_type='EXECUTE';"
> ```
>
> **Pass/fail: before == after.** Any increase means the new function reached `anon` and the
> `REVOKE … FROM anon` line is missing or mis-signatured.
>
> **Named prohibition: never "fix" a grant surprise with a blanket re-grant** (§7.87).
> `supabase/tests/table_grants.test.sql` goes red on any privilege no policy permits, and it
> is the standing check that would catch it — but only after the damage is written.

### 1.4 Rollback — committed, before the deploy

`supabase/rollback/20260812000100_session_roster_guard_DOWN.sql`: drop
`sessions_i_am_main_on(uuid[])` and `CREATE OR REPLACE` `assign_session_coach` back to its
pre-guard body.

**Read that body from `pg_get_functiondef('public.assign_session_coach(uuid,date,uuid,session_coach_role)'::regprocedure)`,
never from `20260811000200`** (§7.115). Grep finds the oldest definition first and the newest
can live in any later file; that mistake cost a wrong risk rating on 2026-08-10. Here the two
happen to agree — check, don't assume.

> ### ⚠ RISK 8 MITIGATION (rollback half) — a hand-copied body is not a rollback, and this DOWN file is also the red-proof
>
> This file does double duty: it is the production escape hatch **and** the instrument that
> proves the pgTAP is not vacuous. A DOWN file whose `assign_session_coach` body has drifted
> by one line proves the wrong thing twice.
>
> **Steps, in this order, before the DOWN file is committed:**
>
> 1. Dump the pre-migration body to a scratch file:
>    `psql -tAc "SELECT pg_get_functiondef('public.assign_session_coach(uuid,date,uuid,session_coach_role)'::regprocedure)"`
> 2. Write the DOWN file's `CREATE OR REPLACE` from **that dump**, pasted, not retyped.
> 3. **Prove it byte-for-byte**: apply the migration, apply the DOWN, dump again, and `diff`
>    the second dump against the first. **Pass/fail: `diff` is empty.** A non-empty diff
>    means the rollback would ship a *different* function than the one production had —
>    which is a new deploy wearing a rollback's clothes.
> 4. Re-apply the migration and confirm the guard is back (checks 1–2 green again).
>
> **The post-deploy rollback path is safe, and this is why — assert it rather than hope it.**
> If the migration is rolled back *after* the coach app has shipped, the deployed bundle calls
> a function PostgREST no longer knows: a **404 → `error` non-null → `coveredOutFrom` never
> runs → empty covered-out set → every lesson stays on NEEDS MARKING.** That is the loud
> direction, and it is only true because of §3.2's single-expression form. **Prove it once, by
> hand, during the rollback rehearsal in Step 5**: drop the function locally, reload the coach
> Schedule tab, and confirm the week still lists its lessons. If it goes empty instead, §3.2
> is wrong and nothing else in Step 3 may ship.

---

## Step 2 — pgTAP, and it must be proven red

Extend `supabase/tests/session_coach_roster.test.sql` (it already builds the non-admin coach
fixtures §7.131 requires, so nothing new is needed).

| # | Assertion |
|---|---|
| 1 | `throws_ok` — shadowing the lesson's **current main** is refused |
| 2 | After the refusal, the main row is **still there and still `main`** (the refusal did not half-apply) |
| 3 | `lives_ok` — adding a *different* coach as shadow is unaffected |
| 4 | `lives_ok` — re-adding an **existing shadow** does not raise (idempotence survives) |
| 5 | `lives_ok` — promoting an existing **shadow to main** still works (`set_session_main_coach` path) |
| 6 | `sessions_i_am_main_on` returns exactly the sessions the caller is main on, from a mixed array |
| 7 | …including one where the coach is main **only by the absence rule** (no roster row at all) |
| 8 | …and **excludes** a session another coach covers — the §7.134 case, asked as the replaced coach |
| 9 | An empty array returns zero rows rather than erroring |
| 10 | A foreign-tenant session id in the array returns nothing (definer rights do not leak) |
| 11 | An id the caller may not see at all (foreign tenant) is **absent from the result**, not returned as a null |
| 12 | `throws_ok` — shadowing the class's **own coach** on a lesson with **no roster main** is refused (RISK 2's absence half) |
| 13 | After that refusal **no `lesson_sessions` row survives** for the date — the resolve-or-create half rolled back too (§7.132's orphan class) |
| 14 | `sessions_i_am_main_on` returns **no id that was not asked about** |
| 15 | A duplicated id in the argument comes back **at most once** |
| 16 | `sessions_i_am_main_on` and `coach_is_main_on_session` **agree** on every id in the fixture set |

Check 16 is the one that keeps them from drifting apart if someone later "optimises" the
delegation away. Checks 14–15 are what the client is allowed to trust in §3.2; if either
is red, the client's shape validation is not defence in depth, it is the only defence.

**Proven red by running the DOWN file** (§7.25, §7.93) — that is the half of a rollback
rehearsal that finds the bugs. Checks 1–2 and 12–13 must fail with the guard removed;
6–11 and 14–16 must fail with the function dropped.

> ### ⚠ RISK 2 / RISK 8 MITIGATION — record the count as a delta, and require every new check to be individually red
>
> **Pass/fail on the suite:** `supabase test db` reports **677** today (`HANDOVER.md` §8.44).
> After this step it reports **677 + N**, where N is the number of checks added — and N is
> read off the diff, not guessed. **A total that moved by anything other than N means a
> pre-existing check was lost**, which is the failure a bare "all green" cannot see.
>
> **Named prohibition: "the suite went red under the DOWN file" is NOT the proof.** One
> check failing turns the file red. Record, per new check, which of the two sabotages
> (guard removed / function dropped) takes it down, and confirm the *other* sabotage leaves
> it green. A check that goes red under both is watching something more general than it
> claims to.

---

## Step 3 — Switch the coach app onto the batch RPC

Only `fetchCoveredOutSessions` moves. `fetchIsMainOnSession` stays — the single-session call
site is **`SwimSyncApp/app/(coach)/classes/[id]/attendance.tsx:339`** (not `:186`, which is
the `role` state declaration; the plan's first draft cited the comment, not the call) and a
batch call there would be worse.

### 3.1 Verify the PostgREST result shape FIRST, empirically

`RETURNS SETOF uuid` is a set of **scalars**, so PostgREST returns `["uuid", "uuid"]` — not
`[{id: …}]`, which is what a `RETURNS TABLE(id uuid)` would give. **Curl it against the local
stack before writing the client**, because both shapes are plausible and the wrong one fails
by returning `undefined` for every id — which, under the inversion below, reads as *"every
lesson is covered out"* and silently empties the coach's marking list.

If it proves awkward, `RETURNS TABLE(session_id UUID)` is the fallback; decide from the
measurement, not from memory.

> ### ⚠ RISK 1 MITIGATION (measurement half) — a 404 here is a schema-cache miss, not a wrong shape
>
> PostgREST does not see a function created seconds ago until its schema cache reloads. A
> `404` / `PGRST202` from the first curl means **reload**, not *"the signature is wrong"* —
> and a plan that does not say so ends with someone rewriting a correct function:
>
> ```sh
> docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema';"
> ```
>
> **Record the measurement in the commit message, as a literal.** Not *"returns scalars"* —
> the actual bytes, e.g. `["9f1c…","a20e…"]` vs `[{"sessions_i_am_main_on":"9f1c…"}]`.
> §3.2's validation is written against that literal, and a prose summary of it is the one
> artifact that can be right about the wrong thing.
>
> **Pass/fail:** the curl, run as a real `authenticated` JWT (not `service_role` — the
> function is `SECURITY DEFINER` but the *grant* is what the app hits), returns a JSON array
> whose elements are **strings**. Anything else and §3.2's `coveredOutFrom` must be written
> against what was actually seen.

### 3.2 The fail-loud direction inverts, and this is the only real hazard in Step 3

Today every failure path answers **"I am the main coach"** (`sessionMainCoach.ts:13-18`),
deliberately: a wrong TRUE leaves a lesson on the NEEDS MARKING list and the database refuses
the save with a visible error; a wrong FALSE hides a lesson that must be marked, and unmarked
attendance blocks the billing month with **no override** (§8i) and nothing on screen saying
why.

Per-probe, that was `catch → return true`. **Batched, the same intent is `catch → return an
EMPTY covered-out set`** — one failed call must not convert a whole week into "somebody else
has these". Write it as one expression so it cannot be got wrong halfway:

```ts
export async function fetchCoveredOutSessions(ids: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  try {
    const { data, error } = await supabase.rpc("sessions_i_am_main_on", { p_session_ids: unique });
    if (error || !Array.isArray(data)) return new Set();   // fail LOUD: nothing covered out
    return coveredOutFrom(unique, data as string[]);
  } catch {
    return new Set();
  }
}
```

> ### ⚠ RISK 1 MITIGATION — THE HIGHEST-RANKED RISK IN THIS PLAN. The batch is NOT equivalent to the per-probe form in every failure mode, and the differences all fail in the SILENT direction
>
> The per-probe form failed loud **per session**: one bad answer cost one lesson, and the
> `catch → return true` was reached by every path. Under *asked minus returned*, the loud
> outcome requires the response to be **complete and well-shaped**, and the code above only
> checks that it is an array. Four ways it is an array and still wrong — every one of them
> empties the coach's NEEDS MARKING list, on a screen whose own comment says an
> *"under-reported NEEDS MARKING list looks exactly like being up to date"*:
>
> | Failure | What `coveredOutFrom(unique, data)` does with it |
> |---|---|
> | Shape is `[{sessions_i_am_main_on: "…"}]`, not `["…"]` | No element matches any asked id → **every probed lesson reads as covered out** |
> | Response truncated (`PGRST_DB_MAX_ROWS=1000`, confirmed set on this stack) | The tail of the coach's own lessons reads as covered out |
> | A null / malformed id is silently dropped by `unnest` + a NULL predicate | That lesson reads as covered out |
> | Someone later adds a filter or a `LIMIT` to the RPC | Same, permanently, for everyone |
>
> **The fix is structural and lives in the PURE function, so no future caller can opt out
> of it.** `coveredOutFrom` validates the answer before it is allowed to subtract anything,
> and any answer it cannot vouch for collapses to the loud outcome:
>
> ```ts
> /** Sessions somebody ELSE is rostered to teach = asked minus mine.
>  *
>  *  ⚠ THE FAIL-LOUD DIRECTION INVERTED WHEN THIS BECAME A BATCH, AND THIS FUNCTION IS
>  *  WHERE THAT IS ENFORCED. Per-probe it was `catch → return true` ("I am main").
>  *  Batched, the equivalent is an EMPTY covered-out set — one bad answer must never
>  *  convert a week into "somebody else has these". A wrong TRUE leaves a lesson on
>  *  NEEDS MARKING and the database refuses the save visibly; a wrong FALSE hides a
>  *  lesson that must be marked, and unmarked attendance blocks the billing month with
>  *  NO OVERRIDE (§8i) and nothing on any screen saying why.
>  *
>  *  ⚠ AN ANSWER THAT IS NOT EXACTLY WHAT WAS ASKED ABOUT IS NOT AN ANSWER. Do NOT
>  *  relax these two guards into a filter or a `?? []` — a filter turns a wrong-shaped
>  *  response into a confident wrong answer, which is the whole failure. */
> const MAX_PROBE = 200;   // hard bound, far under PostgREST's max-rows: a request that
>                          // COULD be truncated is never sent. Replaces CHUNK = 8.
>
> export function coveredOutFrom(
>   asked: readonly string[],
>   mine: readonly unknown[]
> ): Set<string> {
>   const askedSet = new Set(asked);
>   if (askedSet.size === 0 || askedSet.size > MAX_PROBE) return new Set();
>   // Every element must be one of the ids we asked about. An object, a number, an
>   // unasked id — any of them means the response is not the contract, so trust none of it.
>   if (!mine.every((x) => typeof x === "string" && askedSet.has(x))) return new Set();
>   const mineSet = new Set(mine as string[]);
>   return new Set([...askedSet].filter((id) => !mineSet.has(id)));
> }
> ```
>
> **Named prohibitions, attached to this step:**
> - **Do NOT let `fetchCoveredOutSessions` subtract anything itself.** Every path goes
>   through `coveredOutFrom`, so the validation cannot be bypassed by a second caller.
> - **Do NOT add a `covered-out` fallback that returns the asked set.** There is no failure
>   mode in which "hide them all" is the safe answer.
> - **Do NOT reintroduce chunking as the bound.** `MAX_PROBE` is the bound now, and it fails
>   by returning nothing rather than by returning half.
>
> **Pass/fail, measured before the driver is written:** with the RPC deliberately renamed in
> the client (a guaranteed 404), the coach Schedule tab still shows the full NEEDS MARKING
> count. If it drops, this section is wrong.

> ### ⚠ RISK 5 MITIGATION — deleting `CHUNK` does not remove a bound, it replaces a visible one with a silent one
>
> The plan's first draft read *"the bound they protected is now one array argument."* It is
> not. The bound becomes **PostgREST's `max-rows`** — measured at `PGRST_DB_MAX_ROWS=1000`
> on this stack — which enforces itself by **truncating the answer**, and a truncated answer
> under *asked minus returned* means "somebody else has the rest of your week". The old
> bound failed by being slow; the new one fails by being wrong and quiet.
>
> **`MAX_PROBE = 200`, in `coveredOutFrom` (see the code above), is the replacement**: a
> request that could be truncated is never sent, and exceeding the cap returns the empty
> set — the loud outcome. Assert it with the jest case in §3.3.

`CHUNK = 8` goes, **and its bound does not go with it** — see RISK 1 / RISK 5 MITIGATION above:
`MAX_PROBE = 200` replaces it, because the batch's real bound would otherwise be
PostgREST's silent `max-rows` truncation, which fails in the unsafe direction. Keep the
comment's *reasoning* (the caller passes only existing, still-unmarked sessions) by moving
it to the new function's header; delete only the per-request mechanism.

**`sessionMainCoach.ts`'s file header must be rewritten in the same commit.** It currently
says *"EVERY FAILURE PATH ANSWERS 'I AM THE MAIN COACH'"* — true of `fetchIsMainOnSession`,
and read literally it is an instruction to make the batch function return the asked set.
State **both** directions and name which function each governs, or the next reader
"harmonises" them the wrong way.

### 3.3 The pure half, so it is testable

Every `SwimSyncApp/lib/*.test.ts` is pure — **no app test mocks supabase**, so an I/O wrapper
is untested by convention and must therefore be trivial. Extract:

```ts
export function coveredOutFrom(asked: readonly string[], mine: readonly unknown[]): Set<string>
```

jest cases: ids absent from `mine` are covered out · `mine` empty → all covered out ·
duplicates in `asked` collapse · empty `asked` → empty set.

> ### ⚠ RISK 1 MITIGATION (test half) — the four silent-failure cases are the only cases that matter, so write them as tests, not as comments
>
> The list above tests the happy path. Add these five, each of which must be **proven red**
> against the naive `asked.filter(id => !mine.includes(id))` implementation before it counts
> (§7.25):
>
> | Case | Expected |
> |---|---|
> | `mine` holds objects (`[{sessions_i_am_main_on: id}]`) instead of strings | **empty set** — not "everything covered out" |
> | `mine` holds an id that was never asked about | **empty set** — the response is not the contract |
> | `mine` holds a `null` element | **empty set** |
> | `asked.length > MAX_PROBE` | **empty set** — the request that could truncate is never sent |
> | `asked` non-empty, `mine` a correct strict subset | exactly the complement, nothing else |
>
> The second row is the one that *changes* the naive behaviour rather than merely covering
> it: under `.includes()`, an unasked id is harmlessly ignored — which is precisely how a
> wrong-shaped response gets treated as a confident "you are main on nothing".
>
> **Record the jest count before and after.** Pass/fail: the total moves by exactly the
> number of cases added; a different delta means an existing case was replaced, not added.

`SwimSyncApp/app/(coach)/schedule/index.tsx:710` is the only caller and its signature is
unchanged, so nothing there moves. Note that **both** loops feed `probeIds` (`:637` for the
week cards, `:682` for the backlog), so a covered-out regression shows up in two places on
one screen — which is why driver checks 16–17 below are not redundant with each other.

---

## Step 4 — `verify-coach-roster.mjs`

`fixtures-coach-roster.sql` + `verify-coach-roster.mjs` + `fixtures-coach-roster-teardown.sql`
in **one commit** (`check-teardowns.sh` enforces it).

> ### ⚠ RISK 10 MITIGATION — do NOT edit `run-all-drivers.sh`
>
> The sweep already discovers `verify-*.mjs` by glob (`run-all-drivers.sh:184`) and
> `fixture_for()`'s default arm (`:101`) already pairs `verify-coach-roster` with
> `fixtures-coach-roster.sql` by name. Adding a `case` entry is a no-op edit to a shared
> script that every other driver depends on.
>
> **Pass/fail:** `./run-all-drivers.sh --only coach-roster` finds the driver *and* prints
> `(+ fixtures-coach-roster.sql)` with zero changes to that file. If it does not, the file
> names are wrong — rename the fixture, not the script.

### 4.1 Two fixture constraints, both bought the hard way

- **A NON-admin coach, or the whole thing proves nothing** (§7.131). `coach@swimsync.test` is
  also the tenant admin, so every `coach_branch OR can_admin_tenant(…)` policy passes through
  the admin branch whatever the coach branch says — a Wave 3 probe already "proved" a
  narrowing had failed this way. The fixture creates **two** coach auth users
  (`roster-sub@…`, `roster-shadow@…`) with real passwords, following `fixtures-admins.sql`,
  which already inserts a plain coach for the same reason. `handle_new_user` builds their
  `profiles` + `coaches` rows.
- **Today's weekday, computed in SQL.** The class's `day_of_week` must be today's SGT weekday
  so the covered lesson lands in the current week (visible on the coach's Schedule tab) and
  inside the marking window. A driver that pins a weekday is a driver that asserts nothing on
  six days in seven and reports PASS (§7.100, §7.122).

> ### ⚠ RISK 4 MITIGATION — "today's weekday" is NOT enough: a lesson that has not ENDED is on nobody's NEEDS MARKING list, so checks 16–17 pass vacuously for most of the day
>
> `schedule/index.tsx:677` skips any lesson where `!hasLessonEnded(date, todayDate,
> cls.end_time, nowMins)` — *"today's 5pm class at midday is Upcoming, not a straggler"*. A
> fixture that sets `day_of_week` to today but leaves `end_time` at a plausible 18:00 produces
> a lesson that is **on nobody's NEEDS MARKING list at all** before 18:00 SGT. Check 16 ("the
> seed coach no longer lists it") then passes without the cover having done anything — and
> passes *only in the morning*, which is worse than failing, because the nightly sweep runs
> at a fixed hour and would look permanently green.
>
> **Two changes, both structural:**
>
> 1. **The fixture derives `start_time`/`end_time` from NOW in SGT, not from a literal** —
>    a window that has already closed, e.g. `end_time := (now_sg - interval '90 minutes')`,
>    floored so it never wraps past midnight (if `now_sg` is before ~02:00 SGT, shift the
>    lesson to yesterday's date and the class's `day_of_week` with it).
> 2. **A positive control runs BEFORE the admin assigns anything.** Insert a new
>    **check 0** at the head of the walk: log into the coach app as the **seed coach** and
>    assert the fixture lesson **IS** listed under `NEEDS MARKING`. Only then does part A run.
>    Check 16 is then an absence assertion preceded by a proof the thing existed — the rule
>    `verify-multi-class.mjs` states in its own header and the reason this driver cannot go
>    vacuous the way Wave 2's did.
>
> **Named prohibition: do NOT write check 16 as a bare "the string is not on screen".** With
> no check 0 it is indistinguishable from a driver that logged in as the wrong user, or a
> Schedule tab that failed to load. The pair (check 0 green → check 16 green) is the assertion.
>
> **Pass/fail:** with the cover assignment commented out, **check 16 must go red.** If it
> stays green, the fixture's lesson has not ended and item 1 above was not done.

> ### ⚠ RISK 4 MITIGATION (fixture half) — the fixture asserts its own postconditions, because §7.131's two coaches are the whole point of the driver
>
> If `handle_new_user` builds a **parent** profile instead of a coach (wrong metadata key, a
> changed trigger), the fixture still applies cleanly and the driver then fails at login with
> a message about a missing screen — twenty minutes from the cause. Worse: if only *one* of
> the two coaches is created, part C silently tests nothing.
>
> **End `fixtures-coach-roster.sql` with a `DO $$ … RAISE EXCEPTION` block** asserting, at
> minimum: two `coaches` rows exist for `roster-sub@…` and `roster-shadow@…`; **neither id
> equals the tenant's admin profile** (§7.131 — an admin coach proves no narrowing); the
> fixture class's `day_of_week` equals today's SGT weekday; and its `end_time` is in the
> past in SGT. A fixture that cannot satisfy its own preconditions must **fail at apply
> time**, not produce a green driver.

### 4.2 The teardown is scoped `(class, month)`, NOT by id — §7.132

`assign_session_coach()` **creates** `lesson_sessions` rows the fixture never named, so an
id-keyed teardown leaves orphans. `check-fixture-roundtrip.sh` cannot catch them: it diffs the
*fixture*, and these come from the *driver*. Delete `session_coaches` and `lesson_sessions`
for the fixture class across the whole month, then the bookings, enrolments, students,
coaches, profiles and auth users.

### 4.3 The walk — about 20 checks

**0. Positive control, coach app as the SEED coach (1)** — see RISK 4 MITIGATION above.

0. Before anything is assigned, the fixture lesson **IS** under `NEEDS MARKING` for the
   class's own coach. Without this, check 16 proves nothing.

**A. Admin, Lesson Coaches page (9)**

1. The fixture class's lessons for the current month are listed.
2. An untouched lesson names the **class's own coach** as main — the absence rule, visible.
3. Assigning the substitute as main succeeds, and the message says the lesson *moved onto their
   marking list*.
4. The row now names the substitute.
5. Adding the shadow shows them on the row.
6. The **"Who is shadowing?" dropdown does not offer the lesson's current main** — this is
   the reachable half of Step 1's guard, and the behaviour a real admin meets.
6b. The **server** guard on the **row** main is exercised through the stale-tab race
   (see RISK 3 MITIGATION).
6c. The **server** guard on the **absence-rule** main is exercised through the same race
   (RISK 2's branch — the one no client path can reach at all).
7. Clearing the main (the **`Clear`** action, not "Remove") returns the row to the class's
   coach.
8. A lesson row that exists off-pattern is badged **Extra**.

> ### ⚠ RISK 3 MITIGATION — check 6 as originally written is UNREACHABLE through the UI, and an unreachable check reports PASS
>
> `assignableShadows()` (`sessionRoster.ts:230`) removes the current main from the shadow
> dropdown **by coach id**, absence-rule main included. There is no click path in one tab
> that offers the main as a shadow. A driver written to "pick the main from the shadow
> dropdown" therefore either throws on a missing option or — the dangerous outcome —
> selects a neighbouring coach by ordinal and passes while testing nothing (§7.101).
>
> **Split it in three, as above.** The race matters in both directions because the client
> pre-check compares `pickedCoach` against a **stale** `lesson.main.coach_id`, so it fires
> only when the stale value happens to be right — which is exactly when the server guard is
> not needed:
>
> - **Check 6** asserts the *absence* of the main from the dropdown options. Reachable,
>   cheap, and it is what actually protects the admin.
> - **Check 6b — the row main.** Two admin browser contexts, §7.133's exact shape. Lesson has
>   an assigned main **X**. Context 1 opens "Add shadow" and selects **Y** (legal: Y is
>   offered, X is not). Context 2 then makes **Y** the main. Context 1 presses `Save` without
>   reloading: its stale `lesson.main.coach_id` is still X, so `X !== Y` and the client
>   pre-check **does not fire** — the RPC is called to shadow the coach who is now main.
> - **Check 6c — the absence main (RISK 2's branch).** Same two contexts. Lesson has assigned
>   main **X**; the class's own coach **C** is therefore offered as a shadow. Context 1
>   selects C. Context 2 presses `Clear`, returning the lesson to C by the absence rule.
>   Context 1 presses `Save`: stale main is still X, `X !== C`, client passes, RPC called —
>   and only the absence-branch guard added in RISK 2 MITIGATION can refuse it. **Without
>   that guard this check is green while the row is written**, which is what makes it worth
>   the second context.
>
> **Pass/fail:** checks 6b/6c assert the on-screen text begins `Could not assign:` and contains
> the server's own sentence. **It must be the SERVER's message, not the client's** — asserting
> a string both guards produce is a check that cannot tell which one fired. Keep the two
> messages textually distinct (§1.1's server wording vs `page.tsx:287`'s) and assert the
> server's verbatim.
>
> **Named prohibition: do NOT fall back to calling the RPC from Node with the service-role
> key.** `service_role` bypasses `can_admin_tenant`, so the assertion would prove the guard
> fires for a role no user has. If the two-context race proves too flaky in practice, run the
> RPC from **inside the logged-in admin page context** via the page's own supabase client —
> still the role under test — and say so in the driver header.

> ### ⚠ RISK 9 MITIGATION — check 8's off-pattern lesson cannot be created through the UI
>
> `assign_session_coach()` calls `assert_class_runs_on()` before creating a session row, so
> every route the admin screen offers refuses a date the class does not run on. The `Extra`
> badge can therefore only be exercised against a `lesson_sessions` row **the fixture inserts
> directly**, on a weekday the fixture class does not run.
>
> **Step:** the fixture inserts that row itself. **Named prohibition: do not "fix" a failing
> check 8 by relaxing `assert_class_runs_on`** — that guard is what stops a roster row
> against a fabricated date being marked, paid and billed on a day the class never met.
>
> **Consequence for §4.2's teardown:** this row is off-pattern by construction, so an
> `(class, month)`-scoped teardown catches it and an `(class, weekday)`-scoped one would not.
> One more reason the scope is the month.

**B. The coach app as the substitute — the half no unit test can reach (7)**

9. Log in as the non-admin substitute.
10. The covered lesson appears on their Schedule week.
11. The **class title renders** — RISK 1's five invisible policies; a blank card is the symptom.
12. The enrolled student is on the roster.
13. **The guest is visible.** This is the billing-deadlock check: the engine expects the guest,
    the block has no override, and no screen anywhere says why the month will not close.
14. They can save attendance — `attendance_write` is `coach_is_main_on_session()`.
15. The marks persist across a reload.

**C. The replaced coach, and the shadow (3)**

16. The seed coach's week no longer lists the covered lesson under **NEEDS MARKING** — §7.134's
    whole point, and the check that Step 3's inversion would break. **Paired with check 0.**
17. The rest of their week is untouched (guards against "hid everything" passing as success).
    The fixture must therefore give the class **a second, uncovered past lesson** in the same
    week — otherwise "the rest of the week" is the empty set and the check is vacuous.
18. The shadow sees the lesson and gets **no** marking control.

> ### ⚠ RISK 7 MITIGATION — this driver changes persona in the Expo app THREE times, and `loginExpo` will silently keep the first session
>
> `lib.mjs:40`'s `loginExpo` short-circuits when the page is already on the app and off
> `/login` — correct for its own retry loop, and wrong for a driver that switches user. Left
> unhandled, part B would assert the **substitute's** screen while still logged in as the
> seed coach, and both parts would report green while testing one persona. This is not
> hypothetical: `verify-paynow-fallback.mjs:68` documents exactly this, having hit it.
>
> **Use one of the two patterns that already exist in this repo — do not invent a third:**
> - `verify-paynow-fallback.mjs:73`'s `freshLogin(email)`: `goto ${EXPO}/login` →
>   `window.localStorage.clear()` → `loginExpo`. Cheapest, and correct for three switches.
> - `verify-makeups.mjs:169`'s fresh browser context per persona. Slower; use it only if the
>   cleared-storage route proves flaky.
>
> **Structural pass/fail, and this is the part that makes it a mitigation rather than a
> note:** after every persona switch, **assert the identity on screen before asserting
> anything about the lesson** — the Profile/account row naming the logged-in coach, or an
> element only that coach can see. A driver that cannot prove who it is logged in as cannot
> prove anything about §7.134, whose entire subject is *which coach* sees the row.
>
> Also carry the §7.58 rule: a previous screen stays mounted on RN-web and can physically
> overlay the current one, so **no `click({force: true})` in this driver** — it presses the
> wrong element on exactly the multi-screen navigation this walk does most of.

**Deliberately not in the driver: the Coach Wages breakdown.** It needs a generated payout, and
`generate_coach_payouts` deletes and rebuilds drafts for the period — a sibling worktree
running payroll deletes the fixture mid-run (§7.135). The wages labels are held by pgTAP and
vitest instead.

### 4.4 Measure the sabotage signature

Wave 2's new driver shipped a check that **matched zero times and passed while testing
nothing**, found only by measuring. For each check, break the thing it watches and confirm that
check — and ideally only that check — goes red. Assert strings the seed does not otherwise
produce; never an ordinal over a list the driver does not own (§7.75, §7.101).

The driver must also be **re-runnable by hand**, or say so in its header: `verify-multi-class`
is not, and that is a live footgun in `HANDOVER.md` §9.

> ### ⚠ RISK 3 / RISK 4 MITIGATION — name the four sabotages up front, and record what each one scores
>
> "Break the thing it watches" is not executable until the things are named. These four are
> the ones that would ship a green driver over a broken product, so measure them and paste
> the scores into the driver's header the way `verify-multi-class.mjs` does:
>
> | Sabotage | Must go red |
> |---|---|
> | Revert `assign_session_coach`'s new guard (apply the DOWN file) | **checks 6b and 6c only** — 6 stays green, because the dropdown filter is client-side and unaffected |
> | Delete only RISK 2's absence branch, keep the atomic row guard | **check 6c only.** If 6c stays green here, it is not reaching the branch it claims to |
> | Make `coveredOutFrom` return `new Set(asked)` on a good response | **checks 16 and 17** — 17 is what distinguishes "hid the covered lesson" from "hid everything" |
> | Drop `sessions_i_am_main_on` (404 → `error` → empty set) | **nothing** — and that is the assertion: the fail-loud direction means the screen degrades to over-reporting, so checks 16–17 go red only in the *first* sabotage's direction. Record the score; a driver that goes red here has the direction backwards. |
>
> **Pass/fail on re-runnability:** run the driver twice in a row without a `db reset`. Either
> it scores identically both times, or the header carries the `⚠ NOT RE-RUNNABLE` banner and
> names the teardown+fixture pair to apply between runs. Assigning a main is idempotent
> (`set_session_main_coach` deletes-then-upserts), but check 7 **clears** that main and check
> 0's positive control depends on the lesson still being unmarked — check 14 marks it. So the
> honest default here is **not re-runnable**; prove otherwise before claiming it.

---

## Step 5 — Verification gate

Nothing merges until all of these are green, and the runner is the fact:

- `supabase test db` — 677 + the new checks, **proven red under the DOWN file**
- `supabase/functions/generate-invoices/test.sh` **twice** (§7.15 — a completing run seals the
  billing month, so passing once proves nothing)
- `cd SwimSyncAdmin && npm test` · `cd SwimSyncApp && npm test` · `npm run typecheck` in both
- `check-fixture-roundtrip.sh` exit 0 · `check-teardowns.sh`
- `verify-coach-roster.mjs` green, **and** its sabotage signature measured
- `verify-schedule-week.mjs` — the driver that covers the screen Step 3 changes
- Rollback rehearsed: DOWN applied, every pre-existing test still passes, then re-applied

> ### ⚠ RISK 1 / RISK 8 MITIGATION — three of these lines are not runnable as written; make them values, not verbs
>
> "Green" is not a measurement when the thing that can go wrong is a count that moved or a
> screen that quietly emptied. Replace the three vague lines with values recorded **before**
> the work starts and compared after:
>
> | Measure | Before | After must be |
> |---|---|---|
> | `supabase test db` total | 677 | 677 + N, N = checks added, counted off the diff |
> | `SwimSyncApp` jest total | record it | + the §3.3 cases, exactly |
> | `SwimSyncAdmin` vitest total | record it | unchanged — no admin code changes in this plan |
> | `anon` EXECUTE count (§1.3's query) | record it | **identical** |
> | `verify-schedule-week.mjs` score | record it **against current `main`, before Step 3** | identical, or the regression is Step 3's |
>
> **`verify-schedule-week.mjs` must be run BEFORE Step 3 is written, not only after.** It is
> the standing driver over the exact screen the inversion changes; a score compared only
> against expectation cannot tell a pre-existing failure from one this work introduced.
>
> **Named prohibition: do not run `supabase db reset` (which the driver sweep does per driver)
> while a sibling worktree is live** — §7.55, `CLAUDE.md`. If a sibling is running, the driver
> half of this gate waits.
>
> **The rollback rehearsal is not complete until the deployed-app half is done** — see RISK 8
> MITIGATION under §1.4: drop the function, reload the coach Schedule tab, confirm the week
> still lists its lessons.

---

## Step 6 — Deploy, in this order and no other

0. **Merge `db/session-roster-guard` to `main` and push it ALONE** (RISK 6 MITIGATION at the
   top of this plan). Commits 2–4 do not exist on `main` yet at this point.
1. **`supabase db push`** — the migration alone. It is additive (one new function) plus two
   tightenings that no deployed client depends on succeeding: `page.tsx:284` already refuses
   the row-main demote client-side and `assignableShadows()` never offers the absence-rule
   main, so nothing live can regress.
2. **`supabase migration list --linked`, `remote` column filled.** `db push`'s own output is
   not proof — it has printed a `pgdelta` stack trace *and* `Finished supabase db push` three
   times now, so that is the normal output, not an incident.
3. **Then merge to `main` and push** — which deploys both web apps via Vercel.
4. **Grep the served bundle** for a string only the new coach build has. A 200 proves nothing
   (§7.31, §7.51).
5. **Remote grant dump** (§7.39, §7.89) — local and cloud disagree by construction. Expect
   `anon` EXECUTE still 18, 0 blanket table grants, and `sessions_i_am_main_on` granted to
   `authenticated` + `service_role` only.

**Steps 1 and 3 must not swap.** The coach app after Step 3 calls a function that does not
exist until the migration lands — that is precisely §11.9, which Wave 3 got wrong eight days
after §7.60 was written about the same class of mistake.

> ### ⚠ RISK 6 MITIGATION — make the ordering a gate with a value, not an instruction to be careful
>
> §11.9 has been got wrong twice, so an ordered list is not the mitigation — the *check
> between the steps* is:
>
> - **Before step 3 (merge the app):** `supabase migration list --linked | grep 20260812000100`
>   shows the **remote column filled**. Not filled = the coach app must not be pushed. This is
>   a blocker, not a caveat.
> - **Before step 3, also:** `curl` the **production** PostgREST for `sessions_i_am_main_on`
>   with a real authenticated JWT and get a non-404. `db push` reporting success and PostgREST
>   knowing the function are two different facts, and the second is the one the app needs.
> - **After step 3:** grep the served coach bundle for a literal only the new build contains —
>   use **`MAX_PROBE`** or the new header's wording, not a string that also exists in the old
>   bundle. `CHUNK` is a bad choice for the inverse reason: its *absence* is what changed, and
>   you cannot grep for an absence in a minified bundle reliably.
>
> **The blast radius if this is got wrong is bounded, and knowing that is what stops a panic
> rollback making it worse:** an old bundle calling a missing RPC gets a 404 → `error` →
> empty covered-out set → every lesson stays on NEEDS MARKING. Coaches see lessons that are
> not theirs and the database refuses those saves visibly. **Loud, recoverable, no data lost,
> and no billing month blocked.** The fix is forward — push the migration — never a
> `git revert` of the app that leaves the schema half-applied.

---

## Step 7 — Documents

- `docs/GOTCHAS.md` — append **§7.137+**, never renumber. These four **graduate whatever else
  happens**, because each outlives this task and each was found by this review rather than by
  the work:
  1. *"A pre-check that guards an upsert is TOCTOU by construction; the guard belongs inside
     the one statement that takes the lock."* — with the measured `ON CONFLICT … DO UPDATE …
     WHERE` + `IF NOT FOUND` table from §1.1, so nobody has to re-derive it.
  2. *"When a per-item probe becomes a batch, the fail-loud direction inverts — and 'absent
     from the answer' silently becomes the unsafe verdict."* The four failure rows in §3.2 are
     the payload; the general rule is **validate that the answer is about exactly what was
     asked before subtracting anything from it**.
  3. *"A client-side filter that removes an option makes the corresponding driver check
     unreachable — and an unreachable check reports PASS."* (§4.3, `assignableShadows`.)
  4. *"'Today's weekday' is not enough to reach NEEDS MARKING; the lesson must also have
     ENDED, so a fixture with a literal `end_time` is vacuous for part of every day."*
     (§4.1.)
- `BACKLOG.md` — strike both items **and grep the ranked Build order for their names before
  closing the file**. Three items have already been found listed as unbuilt while their own
  sections read SHIPPED.
- `PRD.md` — one line under §7.13: a lesson's main coach cannot be demoted by being added as a
  shadow — **including the class's own coach on a lesson with no assignment**, which is the
  half a reader would otherwise assume is still allowed.
- `HANDOVER.md` — §8.45, and it must **pay for itself**: the file is 41,364 bytes against a
  45,000 budget. Graduate first, then write the entry.
- `docs/TESTING.md` — the new driver's row.

---

## Step 8 — The pre-commit gate

Every mitigation above is inline under the step it governs. This is the walk before
committing. **A box that cannot be ticked is a blocker, not a caveat.**

**The four that matter most — nothing merges with one of these open:**

- [ ] **RISK 1 — the batch cannot silently empty a coach's list.** With the RPC name
      deliberately broken in the client (guaranteed 404), the coach Schedule tab still shows
      the **full** NEEDS MARKING count. And `coveredOutFrom` returns an **empty set** for:
      an array of objects, an unasked id, a `null` element, `asked.length > MAX_PROBE` — each
      proven red against the naive `.filter(!mine.includes())` implementation first.
- [ ] **RISK 2 — the guard covers the effective main, not just the row main.** pgTAP 12–13
      green; **red when only the absence branch is deleted**. Driver check 6c likewise.
- [ ] **RISK 6 — `supabase migration list --linked` shows `20260812000100` remote-filled,
      and production PostgREST answers non-404 for `sessions_i_am_main_on`, BEFORE the app
      commit reaches `main`.** Commit 1 and commit 2 were never in the same push.
- [ ] **RISK 4 — check 0 is green and check 16 goes RED with the cover assignment commented
      out.** If 16 stays green, the fixture's lesson has not ended and the whole of part C is
      vacuous.

**The rest:**

- [ ] `IF NOT FOUND` sits immediately after its `INSERT`, inside the `ELSE` branch only.
- [ ] DOWN file body byte-identical to `pg_get_functiondef` (`diff` empty), and the
      drop-the-function rehearsal on the coach Schedule tab done.
- [ ] `anon` EXECUTE count identical before and after; `table_grants.test.sql` green; no
      blanket re-grant anywhere in the migration.
- [ ] `supabase test db` = 677 + N, N read off the diff. Jest total = before + the §3.3 cases.
      Vitest total unchanged.
- [ ] `verify-schedule-week.mjs` scored **before** Step 3 and identical after.
- [ ] Driver: `freshLogin` (or a fresh context) between all three Expo personas, and an
      **identity assertion** after each switch. No `click({force:true})`.
- [ ] Driver: sabotage table in §4.4 measured and pasted into the driver header, including
      the row that must score **nothing**.
- [ ] Driver: re-runnability settled — either identical scores twice, or the
      `⚠ NOT RE-RUNNABLE` banner naming the teardown+fixture pair.
- [ ] Fixture ends with its own `RAISE EXCEPTION` postcondition block; teardown scoped
      `(class, month)`; roster listed **before** teardown, then `check-fixture-roundtrip.sh`
      exit 0 and `check-teardowns.sh` green.
- [ ] `run-all-drivers.sh` **unmodified** — `--only coach-roster` finds the driver and pairs
      the fixture by name.
- [ ] Deno suite run **twice** (§7.15).
- [ ] `sessionMainCoach.ts`'s header states **both** fail-loud directions and names which
      function each governs.
- [ ] The four graduating gotchas written into `docs/GOTCHAS.md` §7.137+ **before**
      `HANDOVER.md` is touched.
