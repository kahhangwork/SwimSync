# SwimSync — Gotchas (§7)

_Split out of `HANDOVER.md` on 2026-07-26. Read this when you are about to touch a
subsystem, not cover-to-cover — it is a reference, not a narrative._

> **Compressed 2026-09-25 (347 KB → 186 KB).** Every item kept its number, bold title, rule, prohibitions,
> commands and cross-references; the discovery story was cut. The full original text of any item is at
> `git show 82dbdb0:docs/GOTCHAS.md`.

> **The section numbers here are load-bearing.** They are cited by bare number
> (`§7.41`, `§6`) from **781 places** across this repo — including inside **applied
> migrations** and Playwright drivers, where they can never be corrected. So: items keep
> their numbers forever. Append new ones at the end, never renumber, never reuse a retired
> number, and strike a dead item in place rather than deleting it.

> Items **59** and **60** were out of numeric order in `HANDOVER.md` and are now in order.
> Their numbers and content are unchanged.

> **Resolving a section number you see cited anywhere:**
> §3 → `HANDOVER.md` · §5 → `docs/TESTING.md` · §6 → `docs/ARCHITECTURE.md` ·
> §7 → `docs/GOTCHAS.md` · §8 → `HANDOVER.md` (session log) · §9 → `HANDOVER.md` ·
> §10, §12 → `docs/ARCHITECTURE.md` · §11 → `docs/DEPLOYMENT.md`.
> A bare `§11.6`-style number inside a PRD sentence means the **PRD's** §11 (edge cases) —
> check which document the sentence is about before following it.

### Topic index — scan THIS, not the file

Read the line for the area you are touching, then only those items. A new gotcha adds its
number to a line here; a trap that bit again goes on its existing item as a **Hit again**
bullet, not a new number (`/update-docs` Step 5). Items marked **↪** are one-line stubs folded
into the item that carries the lesson. Built 2026-09-25 from the headlines; an item may fit two lines.

| Area | Items |
|---|---|
| SGT dates, clocks, date literals | 7, 12, 94, 95, 100, 121, 122, 128, 175, 177, 194↪, 195, 215, 227, 229, 260 |
| Grants, function privileges | 35, 39, 78, 82, 85, 87, 89, 150, 168↪, 172, 255 |
| `SECURITY DEFINER`, triggers under RLS | 38, 42, 57, 104↪, 120, 125, 149, 156↪, 158, 160, 164, 165, 167 |
| PostgREST / supabase-js query traps | 28, 52, 70, 76, 90, 106, 114, 176↪, 212, 216, 217 |
| Changing schema breaks something far away | 21, 29, 40, 83↪, 115↪, 123, 124, 127, 145, 185, 189, 211, 213, 214 |
| Billing engine, completeness, seals | 8, 13, 17, 18, 32, 68, 97, 103, 109, 203, 208, 219, 257, 259, 265, 266 |
| A test green for the wrong reason | 15, 16, 25, 33, 59, 105, 110, 111, 112, 117, 147, 153, 220, 231 |
| UI drivers and fixtures | 62, 63, 73, 75, 79, 98, 101, 102, 107, 113, 118, 163, 196, 224↪, 225, 226, 234, 244, 246, 263, 272 |
| RN-web / Expo screens, deep links | 9, 10, 58, 64, 65, 74, 80, 81, 99, 141, 146, 237, 252↪, 254, 270, 274, 275 |
| Deploying; proving what is served | 23, 27↪, 30, 31, 49, 51, 60, 72, 187, 238, 253, 271 |
| Worktrees, the shared local stack | 44, 55, 56, 84, 135, 136, 239, 261, 268, 269 |
| Source-scanning guards | 230, 231, 233, 241, 247, 248 |

**Promoted to checks** (these fire without anyone reading): §7.38 and §7.90 →
`supabase/tests/recurring_gotchas.test.sql` · §7.163 → `drivers/check-fixture-ids.sh` ·
§7.87 → `table_grants.test.sql` · §7.35/§7.82 → `function_grants.test.sql` · §7.60 → `/deploy` (a skill you run, not automatic).

---

## 7. Gotchas already hit (don't re-introduce)

1. `insert().select()` under RLS needs the row to pass the SELECT policy immediately
   (see `students.created_by`).

2. Attendance uses `lesson_session_id` (not `session_id`); `marked_by` is a **profile**
   id, not a `coaches.id`. Resolve a coach from an invoice via the item's
   `lesson_session_id` → `classes.coach_id` (a bug used the invoice_item id by mistake).

3. `lesson_sessions.start_time/end_time` are NOT NULL — filled by a BEFORE INSERT
   trigger from the class (`20260309000900`).

4. `useFocusEffect` must get a sync callback, not `async`.

5. `absent` is NOT billable (only `present` + `trial_paid` are — PRD 5.4).

6. When applying credit, draw down notes by the **actual consumed amount** and write a
   `credit_applications` row; only flip a note to `applied` once fully consumed
   (regression-tested in `core.test.ts`).

7. **`new Date().toISOString().split("T")[0]` is a bug in SGT** — the UTC date, a day
   behind before 08:00; with a **local** `getDay()`, weekday and date disagree (bit:
   double-billed everyone). Use `todayInSg()` + `dayOfWeekOf()` (§6). Pinned by
   `verify-tz-saturday.mjs`; audit with
   `grep -rn --include="*.ts" --include="*.tsx" -e "toISOString()\.split" -e "toISOString()\.slice" SwimSyncApp SwimSyncAdmin`.
   **THIS FAMILY INCLUDES TIME OF DAY** (a device-clock `now.getHours()` badge, live until
   2026-07-26; driving status, the coach would never be told to mark a lesson — §8i). Use
   `lib/timeOfDay.ts`: only `nowMinutesInSg()` reads the clock; comparisons take a plain
   `nowMinutes: number`. **Extend the audit:**
   `grep -rn "getHours()\|getMinutes()\|getDay()" SwimSyncApp/app SwimSyncAdmin/app`
   — every hit is either a bug or needs a comment saying why not.

8. **~~The engine's completeness gate never fires on the admin path.~~ FIXED 2026-07-18
   (§8a).** `SwimSyncAdmin/app/api/generate-invoices/route.ts` hardcoded `force: true`,
   bypassing gate, auto switch and seal; unmarked attendance now **blocks** in every mode.
   **A safety gate that the only live caller bypasses is not a gate.** `force` only means
   "skip the sealed-month guard" (the reopen path) — don't re-add it to the route to "make
   generation work"; if generation refuses, mark the lesson.

9. **`react-native-web` gives EVERY ScrollView `flexGrow: 1`** — horizontal ones
   included (`commonStyle` in its `ScrollView/index.js`); children stretch to leftover
   height (bit: ~180px Attendance chips, web only; §12a family). **Any horizontal ScrollView
   needs both:** `className="flex-grow-0"` on the ScrollView *and* `items-start` on
   `contentContainerClassName`. Audit: `grep -rn --include="*.tsx" "horizontal" SwimSyncApp/app`.
   Pinned by `verify-parent-attendance.mjs`.

10. **A screen you navigate *away* from stays mounted underneath.** `document.body.innerText`
    contains both (a false-passing test matched the home screen's copy). Assert only on
    strings unique to the target screen. (`run-ui-playwright` gotcha #6.)

11. **A frontend `tsc` that passes locally can fail in CI — the Next/Expo type stubs are
    git-ignored.** (`next-env.d.ts`, `.next/types/**`, `expo-env.d.ts`, `.expo/types`.)
    Reproduce CI first: `mv .next .next__x; mv next-env.d.ts next-env.d.ts__x`, re-run (§8d).

12. **The invoice engine's DEFAULT billing month was UTC-derived** — same family as #7.
    `new Date().getMonth()` in `core.ts` is UTC on Edge Functions; the 1am SGT cron would bill
    June on 1 Aug. **Fixed** (§8a) via `APP_TIMEZONE` in `generate-invoices/dates.ts`. Don't
    reintroduce a `new Date()`-field month derivation in the engine. Audit:
    `grep -rn "getMonth\|getFullYear\|new Date()" supabase/functions/generate-invoices/core.ts`.

13. **Billing must follow ATTENDANCE ROWS, not active enrolments.** Billing from
    `student_class_enrolments … is_active` dropped attended lessons once "Remove from
    class" (§8a) closed an enrolment. **Active enrolments answer "who must be marked";
    attendance rows answer "who gets billed."** Don't collapse them back together. Audit:
    `grep -n "activeStudentIds" supabase/functions/generate-invoices/core.ts`.

14. **`Number(null)` is `0`, so a "missing setting" can clamp to the *most aggressive*
    value.** `clampRunDay` made an unset `invoice_run_day` **day 1**. Missing/unparseable/low
    now falls back to the default; only too-*high* clamps (29–31 → 28, else never fires in
    February). Decide separately what "absent" and "out of range" mean.

15. **A test suite that seals state can pass once and fail on the second run.** A leaked
    `billing_periods` seal (§8a) short-circuits the next run on `already_complete`;
    `teardown()` clears its months. **Run the Deno suite twice** after touching the engine.

16. **`SET LOCAL ROLE` outside a transaction is a no-op, and psql will not stop you.** The
    probe runs as `postgres`, **bypassing RLS entirely**, so every case "passes". Wrap RLS
    probes in `BEGIN`/`COMMIT`, and make at least one case expected to FAIL.

17. **A guard made of "nothing went wrong" conditions fires hardest when nothing happened.**
    The month seal's negatives were vacuously true on an empty run, sealing an unmarked month
    in production (§8a.1). **Require a positive: that the work actually occurred** (≥1 class
    reckoned with). Same shape as §7.14.

18. **The engine's completeness gate could not see a lesson nobody touched.** FIXED
    2026-07-18 (phase 0 of tenanting). Sessions are created lazily (PRD §7.5) and `core.ts`
    checked only existing `lesson_sessions` rows, so an untouched lesson could never be billed
    (the hole §8aD was written to close); the admin's `computeClassCoverage()` saw it, the
    engine never did (§7.8 inverted). **Two implementations of one safety rule is one
    implementation and one liability.** Now shared — see §6. Pinned by four Deno tests, one
    failing pre-fix with `"complete — billing month sealed"` instead of `"incomplete_attendance"`.

19. **A type union is not a code path.** `tenant_admin` joined `Role` but login branched on
    `role === "coach"`, locking the real coach out of production. Route on **which extension
    rows exist**, not the enum; grep every consumer when widening a type. Now `lib/landing.ts`.

20. **A new table does NOT inherit RLS.** With RLS off, policies read as though they were
    never written (three tenancy tables left every join code world-readable in dev). Always
    `ALTER TABLE … ENABLE ROW LEVEL SECURITY` explicitly. Audit:
    `SELECT relname FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace AND NOT relrowsecurity;`

21. **Postgres does not track function bodies as dependencies.** Dropping
    `is_superadmin()` flagged policies but not `close_student_enrolment()` /
    `handle_attendance_update()`, which would fail at **runtime**. Grep bodies too:
    `grep -rn "<name>" supabase/migrations/`.

22. **`Number("")` is 0 — again.** A blank wage-rate passed `>= 0` and saved a **$0 rate**
    (coach "on payroll", earns nothing). Same shape as §7.14. Check for empty *before*
    coercing, every time.

23. **Watching one app's deploy tells you nothing about the other's.** They are **separate
    Vercel projects**. Compare a known-good route with a known-bad one ("not deployed yet" vs
    "broken build"), and wait on the surface you changed.

24. **A deleted Next.js route leaves a stale generated type behind, so the admin typecheck
    fails *after* you clean up.** `.next/types/app/<route>` lingers and is `include`d, giving
    `TS2307: Cannot find module '…/app/logocheck/page.js'`. §7.11 in reverse; it never
    reaches a commit or CI. Fix: `rm -rf SwimSyncAdmin/.next/types/app/<route>`. Next treats
    `_`-prefixed folders as **private**, so a scratch route named `_logocheck` silently 404s.

25. **A test can pass for the WRONG REASON, and a green suite hides it.** The repricing
    test (§8) dated the price change in the future, so `classes.price_per_lesson` never moved
    and the pre-fix engine passed — found only by deliberately reverting the fix. **Every
    test written for a known bug must be run against the unfixed code before you trust it.**
    Five of the nine wages tests do *not* discriminate (noted beside them).

26. **A guard that fires correctly can look like a broken fix.** `set_class_terms()`'s
    settled-money guard refused a test over the shared fixture's paid December 2026 payout.
    Don't weaken the guard — **move the test instead** (`class_terms.test.sql` got its own
    tenant). A fixture is not a reason to loosen a real rule.

27. **↪ Folded into §7.60 (2026-09-25)** — a repeat of that lesson; its unique detail now lives there.

28. **A `.select()` result is `any`, so reading a column off the WRONG JOINED TABLE
    typechecks.** `s.is_active` on `students(… student_class_enrolments(is_active …))` was
    undefined — every child "Inactive", `tsc` clean. Read the select's shape, not the
    mapping. Audit: `grep -n "is_active" <the select block>` and check the nesting level.

29. **Removing a value from an enum silently changes what OTHER screens say.** Dropping
    `inactive` from `assignment_status` showed departed children as "Unassigned" to parents
    and in the admin queue. Find every screen that *rendered* the value, not just every
    branch that compared to it (§7.19 is the compile-time half).

30. **`supabase db push` APPLIES EVERY PENDING MIGRATION, and auto-confirms when it is not
    on a terminal.** §7.27's successor: a contract migration renumbered to sort last still
    dropped `students.swimming_ability` under live bundles. **Renumbering is a convention the
    tool does not read.** To hold one back it must not be in the directory:
    `mv supabase/migrations/<contract>.sql /tmp/hold/` → push → deploy apps → move it back
    → push again. Recovery is usually **forward**, not a rollback.
    Recovery is usually **forward** (deploy the app that stopped querying the column), not a rollback.

31. **An HTTP 200 does not tell you which BUNDLE is being served.** Both SPAs return 200
    with old JS (§7.23 isn't enough). Grep the deployed asset for a new-build-only string:
    `B=$(curl -s https://swimsync.sg | grep -oE '/_expo/static/js/web/[^"]+\.js' | head -1); curl -s "https://swimsync.sg$B" | grep -c "<new-string>"`

32. **A CLAMP THAT MAKES A CHECK FAIR CAN ALSO MAKE IT VACUOUS.** The completeness gate clamps its window to
    today (`windowTo = todayDate < monthEnd ? todayDate : monthEnd`), so a run on an **in-progress** month judged it
    **COMPLETE** and **sealed** it — the rest permanently unbillable. Nothing checked the month had **ended**.
    Fixed 2026-07-19: the engine refuses
    `billingMonth > previousBillingMonth(now)` before anything can seal, and `force` cannot reach it. **When a rule is
    relaxed to be fair to incomplete input, ask what it says about *entirely* incomplete input.** See §7.17.

33. **A test suite that reads the real clock changes meaning as the calendar advances.** Hardcoded months
    (`2026-07`, `2027-11`, `2028-02`) in the test clock's future made the completeness gate pass vacuously; two
    fixtures were never actually complete. Fix: `monthEnded()` in `test-helpers.ts`; `newScenario()` **throws** on
    zero expected lessons. **Never date a test's fixture relative to the wall clock**; prefer a helper that cannot
    construct the vacuous case over a comment.

34. **An absolutely-positioned element with NO `left`/`top` is placed at its STATIC position,
    which is not necessarily the corner.** A toggle knob (`absolute top-0.5`, no `left`, `translate-x-5`) in a
    content-centring `<button>` landed 18px outside the track. Always anchor a transform-driven knob (`left-0`).
    **Measure rects from the DOM**, not a screenshot (`verify-invoice-controls.mjs`, as §7.9), and **run a driver
    against the unfixed code first**.

35. **`CREATE FUNCTION` GRANTS `EXECUTE` TO `PUBLIC` BY DEFAULT — including `anon`.** A `SECURITY DEFINER`
    function **bypasses RLS**, so its body is the whole boundary. Always **`REVOKE ALL … FROM PUBLIC`** *and* gate
    the body; test **every caller shape** (for `platform_tenant_overview()`: anon, parent, coach, tenant admin).
    Audit: `grep -n "SECURITY DEFINER" -A 12 supabase/migrations/*.sql` and check each has both.
    **AND THAT IS STILL NOT ENOUGH IN PRODUCTION — see §7.39.**

36. **A shared table component that does not emit its own `<tr>` splits the convention, and
    the losing half is INVALID HTML.** `<th>` under `<thead>` is a runtime **hydration error**; `/wages`, `/levels`,
    `/platform` threw in production unnoticed. Fixed: `Thead` owns the `<tr>`. **When a shared component leaves part
    of a required structure to its callers, the callers will diverge** — put it inside. Audit: the Next dev
    overlay's issue count and the browser console on a touched page; a hydration error is silent otherwise.

37. **A STORED COLUMN THAT NOTHING MAINTAINS IS NOT A FACT — don't display it, derive it.**
    `tenants.kind` reads `'private'` only as its **DEFAULT**; the "no rate" warning fired on a private coach, whose
    absent rate PRD §7.13 calls **correct** (noise that never goes away). Both now derive from *is this coach also the
    tenant's admin*. **Before putting a column on a screen, find its writer**; if none, derive it or don't show it.
    Audit: `grep -rn "<column>" supabase/migrations/ | grep -i "update\|insert\|set "` — no hits beyond the DDL means
    nothing maintains it.

38. **A `SECURITY DEFINER` trigger cannot see who the client is — `current_user` inside it
    is `postgres`, so every current_user-seam check waves everyone through.** A DEFINER package-lifecycle draft let a
    parent insert as `active`. `pin_student_tenant()` works because it is NOT definer (client = `authenticated`,
    definer = `postgres`, engine = `service_role`). Seam plus privileged reads = two functions. Audit:
    `grep -B3 "current_user" supabase/migrations/*.sql | grep -i "definer"` — any hit is this bug.
    - **Folded in from §7.104 (2026-08-09):** `assign_parent_package_reference()` (DEFINER) never fired its seam
      check, so a parent could squat the next number. **Rule: a DEFINER function may not ask who is calling** — make
      the rule unconditional, or put the role check in a separate plain trigger. **Opposite direction:** a trigger
      that WRITES to an RLS-protected table must BE DEFINER (§7.120; the `students` audit trigger, `20260809000200`;
      the plain-function seam is explained at `20260720000100`). Test as the writing role — a pgTAP write as
      `postgres` passes against the broken build (`students_audit.test.sql`).
    - **Folded in from §7.156 (2026-08-15):** `recompute_package_extensions` (`20260815000200`) tested `current_user IN
      ('postgres','service_role')`, so every caller took the service branch. **The service seam is `auth.uid() IS NULL`;
      authorise with `auth.uid()` / `can_admin_tenant()` / `current_parent_id()`, never `current_user`.**
    - **Now a CHECK:** `supabase/tests/recurring_gotchas.test.sql` #2 goes red on any DEFINER body that reads `current_user` (2026-09-25).

39. **`REVOKE ALL … FROM PUBLIC` DOES NOT REMOVE ROLE GRANTS, AND THE LOCAL STACK WILL NOT
    SHOW YOU THE DIFFERENCE.** `provision_tenant()` (§7.35 recipe) looked right locally but the remote dump showed
    `GRANT ALL` to `"anon"`, `"authenticated"`, `"service_role"`: **`PUBLIC` is its own grantee, not an umbrella**, and
    **Supabase cloud's `ALTER DEFAULT PRIVILEGES` grants EXECUTE on new `public` functions to all three** (the local
    stack does not; `20260309000800_grants.sql` covers tables/sequences only). A local grant assertion is
    **vacuous**; **the only honest check is a dump of the remote after pushing**. Write
    `REVOKE ALL … FROM anon, service_role` next to the PUBLIC revoke. **Still outstanding:** `regenerate_join_code()`,
    `close_student_enrolment()`. Audit:
    `supabase db dump --file /tmp/p.sql && grep -E '(GRANT|REVOKE).*ON FUNCTION' /tmp/p.sql | grep '"anon"'`.
    Nothing leaked only because the body gate refused both roles (`auth.uid()` is NULL for each) — the grant layer was absent while a comment claimed it held.

40. **GET A FUNCTION'S CURRENT DEFINITION FROM THE DATABASE, NOT FROM THE MIGRATION FILE YOU
    FOUND FIRST.** Copying from `20260719002300_platform_tenant_overview.sql` silently reverted `20260719002400`
    (and the diff check used the same wrong file). Filenames and `tail -1` are heuristics; the database is the fact:
    `SELECT pg_get_functiondef('public.<fn>()'::regprocedure);` — diff your new body against **that**.
    - **Folded in from §7.83 (2026-08-04):** the reverse — a session trusted a migration file over the live RPC and
      wrote a false claim into four documents incl. PRD §4.4 (removed `e03cba6`). The function's own header warning
      (`20260721000200`) said exactly this, and was not read. **Three oracles, any one settles it:**
      `pg_get_functiondef` · the pgTAP file asserting the real columns · the RPC's JSON keys over PostgREST.
    - **Folded in from §7.115 (2026-08-10):** a review of `20260725000800_book_trial.sql` nearly re-added a guard
      `20260806000200` already had. Command:
      `docker exec supabase_db_SwimSync psql -U postgres -d postgres -At -c "SELECT pg_get_functiondef('public.<fn>'::regproc);"`
      — the same one is the §7.93 rollback check.
    - **Now a standing rule:** CLAUDE.md → *Rules that bite* → Database (2026-09-25). A habit, so no check can see it.

41. **AN UNLISTED AUTH REDIRECT IS NOT REJECTED — IT IS SILENTLY REPLACED WITH `site_url`.**
    A URL missing from `[auth].additional_redirect_urls` just lands the user on the wrong page. **If an auth email
    lands somewhere unexpected, suspect the allow-list before the code.** Matching is **exact** (`localhost:3000` ≠
    `127.0.0.1:3000`) and read only at **boot** (§4): `supabase stop && supabase start`.
    - Live for weeks until 2026-07-27: `https://admin.swimsync.sg/reset-password` was missing from production;
      `https://swimsync.sg/reset-password` from `config.toml`.
    - **PRODUCTION AND `config.toml` ARE TWO SEPARATE LISTS AND NOTHING KEEPS THEM IN STEP** (production's is in the
      Supabase dashboard; no migration, test or `supabase db push` touches it). **Fixing the file does not fix production, and fixing
      production does not fix the file — do both, every time.** Audit:
      `grep -rn "redirectTo\|resetRedirectTo" SwimSyncAdmin/app SwimSyncApp/app` — each URL must be in both lists.

42. **A `SECURITY DEFINER` WRITER IS EXEMPT FROM `pin_student_tenant()` — AND FROM EVERY
    TRIGGER THAT USES THE `current_user` SEAM.** §6's inherited exemption is a **hole**: such a function can write a
    student into any tenant. **So every SECURITY DEFINER function that writes a tenanted row must derive `tenant_id`
    itself and must NOT accept it as a parameter** — copy `add_unclaimed_student()` / `link_invited_parent()`
    (`20260725000200`/`000300`). Inside it `auth.uid()` is the caller; `current_user` is `postgres`.

43. **~~`lesson_sessions` HAS A SECOND WRITER NOW.~~ RETIRED 2026-07-25.** Trials became BOOKINGS (§8.11); the
    attendance save is again the only writer (§6). A duplicate `(class_id, session_date)` double-bills a class
    (§7.7), so any future second writer needs `ON CONFLICT … DO NOTHING` and a date **parameter**, never `now()`.

44. **`supabase db reset` LEAVES KONG POINTING AT A DEAD AUTH CONTAINER.** Every `/auth/v1` call returns **502**
    while `docker ps` says healthy; Deno shows `createUser(coach) failed: {}` on every test — not a regression.
    Diagnose by curling the auth endpoint.
    **Fix: `docker restart supabase_kong_SwimSync` after any `db reset`.** Failed runs also leak tenants (thrown
    after insert by `newScenario()`), eventually colliding on `tenants_join_code_key`.

45. **`classes.category_id` IS MUTABLE, AND MONEY NOW DEPENDS ON IT.** Unlike effective-dated rates, re-tagging a
    class would re-value its unbilled trials — §7.7 again, and against §6: *a fact about a past lesson is never a
    live lookup.* **So anything that prices by category must SNAPSHOT it at the moment of sale**
    (`trial_bookings.category_id`); the engine is prohibited from joining `classes` to price a trial.

46. **THE LIST OF WHAT CASCADES FROM A TABLE IS NOT STATIC, AND A STALE COPY OF IT IS A
    DATA-LOSS BUG.** `BACKLOG.md` said only `parent_students` cascaded from `students`; `student_settlements`
    (`20260725000100`), `trial_bookings` (`20260725000700`) and `student_claims` did too. **A comment cannot be the
    mitigation, because the person who adds the next cascading FK will not read it.** Any function that DELETEs a
    tenanted row must ask the catalogue and refuse on anything it has not been taught to move:
    ```sql
    SELECT string_agg(conrelid::regclass::text, ', ') FROM pg_constraint
     WHERE confrelid = 'students'::regclass AND contype='f' AND confdeltype='c'
       AND conrelid::regclass::text NOT IN (<the ones it handles>);
    ```
    `merge_students()` does; `student_merge.test.sql` adds a cascading FK at runtime and asserts refusal. Audit:
    `SELECT conrelid::regclass, confdeltype FROM pg_constraint WHERE confrelid='<t>'::regclass AND contype='f';`

47. **A BUSINESS'S OWN ADMIN CANNOT UNLINK A PARENT FROM A CHILD — SO ANY FEATURE THAT
    CREATES A FAMILY LINK MUST SHIP ITS OWN REVERSAL.** `undo_student_claim()` (`20260726000400`) ships in the
    **same migration** as approve. **Do NOT "fix" this by widening `parent_students_delete` to tenant admins** — a
    blanket delete over every family link; RLS cannot say "only the link you just made".
    - **UPDATE 2026-08-04 — the policy is GONE (`20260804000800`)**: `undo_student_claim()` is the **only** unlink
      path. **`parent_students` is SELECT-only for clients**; the DEFINER deleters (`undo_student_claim`,
      `merge_students`) were never affected, and INVOKER readers (`package_live_balances`,
      `student_package_coverage`) keep SELECT. The grant had to go with the policy —
      `table_grants.test.sql` assertion 2 (§7.87) goes red naming `parent_students:DELETE` otherwise.

48. **A PARENT WHO HAS JOINED BY CODE BUT HAS NO CHILD YET IS INVISIBLE TO THE BUSINESS'S
    ADMIN.** `tenant_serves_parent()` goes via the children's enrolments, so the claim queue showed blanks. **A join
    that works under `service_role` in a REST probe can return NULL under the caller's own RLS; test the read path as
    the actual role.** Fix: a narrow DEFINER reader (`list_student_claims()`), not a new policy branch.
    **A POLICY GAP IS INDISTINGUISHABLE FROM A FEATURE NOBODY WROTE** (again in `trial_bookings_select` and
    `parent_has_child_in_class()`). **So: when a new screen reads a table its audience has never read before, probe
    the policy AS THAT ROLE before writing the UI** —
    `SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claims" TO '{"sub":"<id>"}'; SELECT count(*) FROM <table>;`
    A count of 0 there is the whole bug.
    Why: `current_tenant_id()` is NULL for a parent (they are not a coach), and `parent_has_child_in_class()` only knew about ENROLMENTS — a trial is a booking.

49. **NUMBER A CONTRACT MIGRATION *LAST*, OR STAGING THE DEPLOY LEAVES IT OUT OF ORDER.** `supabase db push` pushes
    everything, so a contract is held back by moving it out of `supabase/migrations/`. If it is older than a pushed
    file (`20260726000600` vs `20260726000700`) the CLI demands `--include-all` (safe if independent — `--dry-run`
    first). **Give the contract migration the highest timestamp in the batch**, so holding it back never creates a
    gap (§6).

50. **`audit_log.actor_id` STOPS YOU DELETING A PROFILE, AND CANNOT BE CASCADED OR
    BLANKED.** `NOT NULL`, `NO ACTION`: delete audit rows **authored by** the doomed accounts first; keep rows by
    others *about* them (`entity_id` has no FK). **An account can never be fully deleted without losing part of the
    audit trail.** Audit:
    `SELECT count(*) FROM audit_log al JOIN profiles p ON p.id = al.actor_id WHERE p.email = '<addr>';`

51. **A MINIFIED BUNDLE ONLY PROVES WHAT USER-VISIBLE STRINGS SURVIVE — GREPPING FOR AN
    IDENTIFIER OR A SPLIT LITERAL PROVES NOTHING.** Bundle grepping (§7.23) lies: identifiers are renamed
    (`upcomingTrials` returns 0), and JSX
    splits literals (`Trial{n === 1 ? "" : "s"} coming up` never appears as `"Trials coming up"`). **Grep only for a
    contiguous user-visible string you can see verbatim in the source**, and sanity-check one already live.

52. **A NEW EMBED ON A PAGE'S PRIMARY LIST QUERY PUTS THE WHOLE PAGE AT RISK — ADD A
    SECOND QUERY INSTEAD.** One failed PostgREST embed nulls the **entire** select. Fetch supplementary data in its
    own query defaulted to empty (`loadRoster()` beside `loadClasses()`, 2026-07-26 — verified by breaking the
    roster query on purpose), and a failed supplementary read must say so — an empty list is
    indistinguishable from a class with nobody in it.

53. **`ON CONFLICT DO NOTHING` DOES NOT MAKE A FIXTURE IDEMPOTENT WHEN THE ONLY UNIQUE
    INDEX IS PARTIAL.** `one_active_enrolment_per_student_class` (`WHERE is_active`, `20260811000100`) and
    `trial_bookings_live_slot_uniq` are deliberately partial, so inactive/cancelled rows re-insert every run. Use
    `WHERE NOT EXISTS`; run any new fixture twice and diff the row counts.

54. **WHEN A SHARED COMPONENT STARTS EMITTING AN ELEMENT ITS CALLERS USED TO EMIT, THE
    SWEEP IS NOT THE FIX — A TEST IS.** `42803db`'s sweep missed `levels/page.tsx` (broken in production a week).
    Prose cannot enforce a call-site contract: land a scan test in the same commit —
    `SwimSyncAdmin/components/Table.test.tsx` walks every `app/(admin)/**/page.tsx`.
    - **Every text assertion passes on a table whose columns are misaligned** — measure geometry (§7.34):
      `verify-levels-table.mjs` compares each `th`'s rect against its column's `td`.
    - **React's own `validateDOMNesting` warning is NOT a usable signal here — tested**: it logged nothing on the
      broken page. Count `thead tr tr` off the DOM. A check that passes on known-broken code is worse than none.
    - **A driver that has never been seen to fail proves nothing.** Calibrate tolerance on the unfixed tree, never
      guess it.

55. **GIT WORKTREES SPLIT THE CODE AND SHARE THE DATABASE — SO MIGRATIONS LAND ON `main`,
    ALONE, ONE AT A TIME.** Every worktree's `config.toml` has `project_id = "SwimSync"`,
    so all address one `supabase_db_SwimSync`. `supabase db reset` rebuilds it from
    whichever worktree ran it (a branch-only migration vanishes), and parallel migrations apply in **FILENAME order
    locally, MERGE order on production** — last-writer-wins objects silently differ.

56. **A FRESH WORKTREE HAS NO `.env` FILES, AND THE FAILURE LOOKS LIKE YOUR CHANGE.** `SwimSyncApp/.env`,
    `SwimSyncAdmin/.env.local` and `node_modules` are git-ignored. The Expo app still serves a 200 but login never
    renders its fields — drivers time out on `getByPlaceholder('you@email.com')`, reading like a regression (bit
    `verify-levels.mjs`). **Run the driver against the *unfixed* code first.**
    - Setup for a new worktree, before any driver:
      `cp <root>/SwimSyncAdmin/.env.local <wt>/SwimSyncAdmin/ && cp <root>/SwimSyncApp/.env <wt>/SwimSyncApp/`
      then `npm install` in both. **Check the copied file points at `127.0.0.1:54321`** — a cloud-pointed env aims
      your drivers at production.
    - Run the admin on a **non-default port** (`npm run dev -- -p 3100`); `drivers/lib.mjs` reads
      `ADMIN_URL`/`EXPO_URL` — do not edit it, it is shared with every worktree.
    - **The rule:** write migrations in the `main` worktree on a short `db/…` branch, apply, `supabase test db`,
      merge to `main` **before** anything depends on them; feature branches `git merge main` to *consume* the schema
      and never carry it. One in flight at a time. Announce before `db reset` — it wipes every other worktree's
      fixtures.
    - **Do NOT give each worktree its own stack** by editing `project_id`/ports: `config.toml` is **tracked**.
    - **`WORKTREE.md` is per-worktree scratch and must stay gitignored** — committing it makes every sibling's
      `git merge main` fail. Move anything durable here or to `BACKLOG.md` **before** retiring the worktree. If your
      branch predates `12cf553`, check before you commit (`git rm --cached`).
    - **`git status` BEFORE `git commit`, not after — a sibling session can move `HEAD` between your checkout and
      your commit.** 2026-07-16: `3e1270c` landed on `main` with no CI run of its own (green run is `b89ca52`'s) —
      a commit that never ran CI is invisible to later "CI was green" claims. **Check `git log` before assuming an
      uncommitted file is yours** (promoted from §8g/§8h).

57. **A `BEFORE INSERT` TRIGGER ALSO FIRES FOR ROWS THAT RESOLVE TO AN *UPDATE*.** `.upsert(rows, { onConflict })`
    is `INSERT … ON CONFLICT DO UPDATE`, and BEFORE INSERT runs for every candidate row before the conflict is
    detected. The attendance guard (`20260727000100`) nearly refused every correction to an invoiced lesson (credit
    notes, PRD §7.8) — and one refused row fails the whole class's save. **Detect the update inside the trigger**: if
    a row exists for the conflict key, return early. A client-side split would not do — it leaves direct REST calls
    unguarded. Audit: `grep -rn "BEFORE INSERT" supabase/migrations/` — ask whether each table is ever written by
    `.upsert()`.

58. **A DEEP-LINKED RN-WEB SCREEN CAN BE PHYSICALLY OVERLAID BY THE ONE YOU LEFT, SO
    `click({force:true})` PRESSES THE WRONG ELEMENT.** Worse than §7.10: the stale screen is laid out on top, the
    press lands on it, nothing errors and the state never changes (bit `verify-attendance-guard.mjs`). **Diagnose by
    asking the DOM, not by screenshot:**
    ```js
    const r = el.getBoundingClientRect();
    document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) // is it your element?
    ```
    Fix: dispatch `pointerdown`/`pointerup`/`click` on the element itself (`pressByText()`). Prefer in-app
    navigation; use this when a deep link is the point of the test.
    - **Folded in from §7.252 (2026-09-21, §8.114):** a force-click opened a DIFFERENT lesson on the Schedule screen
      underneath (root cause §7.254). In a hand-check click the element itself: `locator.evaluate((e) => e.click())`.
      The Toast lives **3000 ms** — `waitFor` its text right after the action.

59. **A `COUNT(*)` BASELINE IS ROLE-DEPENDENT UNDER RLS, SO "NOTHING WAS WRITTEN" CAN
    FAIL WHILE BEING TRUE.** A pgTAP count of `lesson_sessions` as `postgres`, compared under `SET LOCAL ROLE
    authenticated`, fails whatever the code does — and looks like a leaked write. **Scope both sides to the same
    rows** (`WHERE class_id = …`), or take both counts as the same role. Sibling of §7.16.

60. **`git push … :main` IS A DEPLOY STEP. IT IS THE *APP* DEPLOY.** Vercel builds both web apps from `main`, so
    landing there ships the frontend ahead of any pending `db push` / `functions deploy`. Got wrong 2026-07-27
    (§8.15) despite §7.27 and a written plan: "merge my branch" and "deploy the frontend" are the same action.
    **So: for a backend-first change, do `db push` and `functions deploy` BEFORE the push to `main`.** Landing on
    `main` is the last step, not the first.
    - **Folded in from §7.27 (first filing):** the rule is directional — **adding? migrate first. dropping?
      deploy the app first** — and it governs the *push*, not just the migration command. Nothing is atomic here.
    - **Now a gated skill (run it — it is not automatic):** `/deploy` refuses the app push while migrations are pending.

61. **FAMILY/CHILD STATUS PROPAGATION IS DELIBERATELY *NOT* A TRIGGER, AND MUST NOT BE
    "TIDIED" INTO ONE.** Deactivating a family's last active child marks the family inactive (PRD §7.14) in the
    **write path**, one-way:
    - **A trigger fires after the write and cannot ask** — the UI's sibling-effect prompt would be a lie.
    - **A trigger maintaining `no active children ⇔ family inactive` BREAKS RE-ACTIVATION** — a returning family has
      zero active children by design, so the join code (the only re-entry route, PRD §5.1) would silently stop working.
    A family **can** be inactive while holding an active child; nothing reconciles them. That is the design, not a
    gap. (Promoted from §8.4, 2026-07-19.)

62. **A SCHEMA CHANGE CAN SILENTLY BREAK A UI FIXTURE, BECAUSE NO FIXTURE RUNS IN CI.**
    `20260719000600_students_tenant_not_null.sql` made `students.tenant_id` NOT NULL and two fixtures silently stopped
    loading; CI has never applied a fixture. A `psql` fixture runs past the failed statement (the children do not
    land), leaves orphans, and the low score reads like a product regression — the real cause of
    `verify-attendance-window.mjs` scoring 0/4 for a week. **A wrong diagnosis in the backlog is worse than none.**
    **When a migration adds a NOT NULL column or a constraint, grep the fixtures:**
    `grep -l "INSERT INTO <table>" .claude/skills/run-ui-playwright/drivers/fixtures-*.sql`
    — and run each one it names. Until fixtures run in CI, that grep is the only guard. (Surfaced 2026-07-26 by the
    round-trip harness, `docs/WORKTREES.md` Phase 4.)

63. **A FIXTURE MUST SCOPE EVERY WRITE TO ITS OWN ROWS — `FROM students` WITH NO FILTER
    COLLIDES WITH EVERY OTHER FIXTURE, AND THE COLLISION ABORTS THE STATEMENT.**
    `fixtures-unmarked-lessons.sql`'s unfiltered `CROSS JOIN`s enrolled and marked present every student; with a
    sibling loaded first, `one_active_enrolment_per_student` aborted the `INSERT`, so its own children were **never
    enrolled at all**.
    **⚠ THAT ABORT NO LONGER HAPPENS FOR THE GENERAL CASE, AND THE ABORT WAS THE DETECTOR.** Wave 2
    (`20260811000100`) made the index `(student_id, class_id)`, so a stray enrolment inserts **silently**.
    `check-fixture-roundtrip.sh` (delta divergence) is now the *only* guard — the pre-commit gate for any change to a
    fixture's write scope. A stray attendance `present`
    is a **billable lesson attributed to someone else's child**.
    **The rule: every `INSERT … SELECT` in a fixture must be scoped to identifiers the fixture owns** — its own
    parent's family links, or its own UUID prefix. Never a bare `FROM <table>`. Audit:
    `grep -n "CROSS JOIN\|FROM students\|FROM classes" .claude/skills/run-ui-playwright/drivers/fixtures-*.sql`
    and ask "would this pick up a row another fixture created?" Sibling of §7.62: psql aborts the statement, the
    script continues, the fixture half-loads silently. (Fixed 2026-07-26.)

64. **EXPO ROUTER REUSES A MOUNTED SCREEN WHEN ONLY A SEARCH PARAM CHANGES, SO A
    MOUNT-ONLY `useEffect` NEVER RELOADS — AND THIS WROTE ATTENDANCE TO THE WRONG DAY.**
    `/(coach)/classes/[id]/attendance` is identified only by `?date=`; its loader was `useEffect(() => { load() },
    [])`, running once per mount and never again, so the header followed the new `date` while `resolvedSessionId`,
    `students` and `attendance` stayed on the previous lesson. Bit production 2026-07-26: 19 Jul marks landed on
    26 Jul with a green toast (tell: **no `lesson_sessions` POST**).
    **`[]` deps are not a style choice on a screen whose identity is a search param.** Depend on the params or use
    `useFocusEffect`. Audit:
    `grep -rn -A3 "useLocalSearchParams" SwimSyncApp/app --include=*.tsx | grep -B1 "}, \[\])"`
    Two more layers: `lib/attendanceSession.ts` ties a session id to the date it was resolved FOR (else `stale`),
    and the save re-resolves from `(class_id, date)`; a spinner covers the gap between param change and reload.
    **Only an in-app-navigation driver can catch this** — a deep link mounts fresh. `verify-stale-screen.mjs`
    clicks Today's card then the backlog row (with §7.65). (Fixed 2026-07-26.)

65. **`router.back()` ON THE ATTENDANCE SCREEN POPPED INTO A *DIFFERENT LESSON*, BECAUSE
    THE SCREEN LIVES IN A TAB IT IS NOT ALWAYS PUSHED FROM.**
    `classes/_layout.tsx` puts attendance in the **Classes** tab's `Stack`, but Today's card and Unmarked Lessons
    push it from **Today**; switching tabs only hides the stack, so it accumulates `[classes-index, att(845),
    att(930)]` and saving 9:30 popped to 8:45 (repro: press the back chevron first).
    **The fix: stop asking "what is underneath?".** The caller passes `&from=today` / `&from=roster` and the screen
    leaves with **`replace`, not `back`**, dropping it from history.
    Easy to confuse with §7.64 (rows on the wrong lesson vs *screen* the wrong lesson): with only §7.64 fixed,
    "class A's lesson is untouched" passes while the navigation check fails. (Fixed 2026-07-26.)

66. **A DUPLICATE IN ONE UPSERT MAKES POSTGRES REFUSE THE WHOLE STATEMENT, SO A
    DOUBLY-ENROLLED CHILD WOULD BLOCK ATTENDANCE FOR AN ENTIRE CLASS.**
    `.upsert(rows, { onConflict: "lesson_session_id,student_id" })` with two rows sharing a key errors:
    `ON CONFLICT DO UPDATE command cannot affect row a second time` — shown only as "Failed to save attendance".
    The roster is built from enrolment ROWS matched by DATE SPAN (not `is_active`), and unenrol/re-enrol keeps
    history (PRD §11.5), so overlapping spans list a child twice. `mergeRoster` now dedupes `activeStudents`;
    `attendanceCompleteness.ts` (`studentsEnrolledOn`) always did — the §7.18 asymmetry.
    **THIS IS A LATENT HAZARD, NOT AN OBSERVED INCIDENT** — `group by student_id, class_id having count(*) > 1`
    returned zero rows on production (the real cause was §7.67); only a hand-written data fix could create
    overlapping spans.
    `is_active` readers cannot hit it (`one_active_enrolment_per_student` partial unique index); only span readers
    can, so the guard belongs in `mergeRoster`, not the call site. Audit:
    `grep -rn "enrolled_at" SwimSyncApp/app SwimSyncAdmin/app | grep -v is_active`
    (Fixed 2026-07-26.)

67. **A `.upsert()` WHOSE ROWS HAVE DIFFERENT KEYS SENDS `NULL` FOR THE MISSING ONES — NOT
    THE COLUMN DEFAULT — SO ONE PARTIALLY-MARKED LESSON BECAME PERMANENTLY UNSAVEABLE.**
    supabase-js builds `columns=` from the **union** of keys; PostgREST's `json_populate_recordset` gives an omitted
    key **NULL** — the DEFAULT never applies. `...(state.existingId ? { id: state.existingId } : {})` on a
    partially-marked lesson inserted `id = NULL`: `23502 null value in column "id" of relation "attendance" violates
    not-null constraint`, failing the whole one-upsert save, so the lesson could never be completed, and stranding the coach
    (`handleSave` returns early).
    **If one date fails and its neighbours do not, compare what already exists on those dates** (see §7.66).
    **`id` was never needed** — the UNIQUE `onConflict: "lesson_session_id,student_id"` matches; existing rows keep
    their id, new rows take the default. `existingId` plumbing removed, incl. `attendanceBulk.ts` (its "update in
    place" comment — it never did).
    **The rule: build every upsert row from one object literal with no conditional keys.** A genuinely optional
    column is sent as explicit `null`. `lib/attendancePayload.ts` owns this; `hasUniformKeys()` asserts it.
    (Fixed 2026-07-26.)

68. **"FULLY MARKED" MEANS TWO DIFFERENT THINGS TO INVOICING AND TO A COACH'S SCREEN, AND
    ONE OF THEM IS LOAD-BEARING FOR MONEY.**
    `isLessonFullyMarked([], undefined)` returns **true** — correct for billing, which must not block a month on a
    lesson nobody was expected at; `unmarkedDates()` (§8.15) and the engine's month seal (§8a) rely on it. On a card
    it is a lie: an empty roster shows green "Marked".
    **The tempting fix is to change the shared helper. Do not.** It is duplicated in `SwimSyncAdmin` and the Deno
    engine, has a drift test, and changes which months invoice for every tenant.
    **The rule: a display concern gets solved in the display layer.** `lib/attendanceSummary.ts` returns a distinct
    `no-students` state checked FIRST; `attendanceCompleteness.test.ts` pins the vacuous `true` and says why.
    **The button:** only `complete` may quieten "Mark Attendance" — written `kind === "complete"`, never
    `kind !== "unmarked"` — so new states inherit the LOUD button; a lesson that never gets marked blocks the
    month with no override. Encode an asymmetric-cost default; don't rely on the next reader noticing it. (2026-07-26.)

69. **A DISPLAY FILTER MUST NOT BE REUSED AS A DESTRUCTIVE-ACTION GUARD.**
    The Swimming Levels *Students* column rightly counts only **active** children, but the level's **removal
    warning** must count everyone: `students.level_id` is `ON DELETE SET NULL`
    (`20260719001800_tenant_levels.sql:70`), so removal never errors — it silently blanks the level for departed children too.
    **The rule: the filter that answers "what should I show?" is not the filter that answers "what will this
    destroy?"** Check what the CONSTRAINT reads. `lib/studentCounts.ts` keeps both numbers. Caught one line from
    shipping by a before/after diff of the modal text. (2026-07-26.)

70. **A CLIENT-SIDE `.length` IS SILENTLY CAPPED AT `max_rows = 1000`, SO IT IS THE WRONG WAY
    TO COUNT ANYTHING.**
    PostgREST returns fewer rows with no error. Use `.select("id", { count: "exact", head: true })`. The admin
    Dashboard does; **the Students page deliberately inherits the ceiling** (an unpaginated client-side list), so
    the two must not be "tidied" into consistency. (2026-07-26.)
    - **Do not talk yourself out of it with a steady-state argument.** `markable_floor` follows `billing_periods`
      only once a business has billed; otherwise it falls back to tenant **`created_at`** (`20260806000200`), so a
      never-billed school carries months of lessons. Where a head count will not do, use an explicit `.limit()`
      BELOW the cap and render something loud when a result hits exactly that length — a silently short
      "still needs marking" list reads as *up to date*. (2026-08-08.)

71. **`w-full` ON A TABLE CELL IS A *PREFERRED* WIDTH, NOT A FLOOR — SO THE COLUMN YOU GROW
    IS THE COLUMN THAT GETS CRUSHED.**
    When `w-px whitespace-nowrap` columns over-subscribe the table, the `w-full` column absorbs the entire shortage
    (admin Classes at 1600px: `Class Name` at 110px, narrower than `Day`). Keep such a column `nowrap` so its
    min-content is a floor and the card scrolls; prefer one `[&_th:last-child]:w-full` on the table over a
    per-table prop (which needs a call-site test for tables nominating none). Only measurement finds this —
    `getBoundingClientRect()` per column in Playwright; the markup was correct. (2026-07-26.)

72. **§7.31 REFINED: NEXT.JS CODE-SPLITS PER ROUTE, SO GREPPING THE WRONG PAGE'S CHUNKS
    REPORTS "NOT DEPLOYED" FOR A BUILD THAT IS ALREADY LIVE.**
    `/login`'s HTML never references `/attendance`'s chunk (tell: the chunk hash never changed).
    - Fetch **the route you changed** and grep
      `_next/static/chunks/app/(admin)/<route>/page-*.js`.
    - A **shared** component/lib lands in a common chunk (`582-*.js`, `789-*.js`) — search every chunk the page
      references.
    - A compiled **CSS** rule (`th:last-child{width:100%}`) in the stylesheet is stronger evidence than a class name
      in markup.
    The Expo app serves one `entry-*.js` bundle, so §7.31's original recipe works there. (2026-07-26.)

73. **AN UNORDERED `LIMIT 1` OVER A SHARED TABLE IS A BUG THAT CANNOT FIRE UNTIL A SECOND ROW
    EXISTS — AND THEN IT PICKS THE WRONG TENANT.**
    `fixtures-student-identity.sql` did `SELECT id INTO v_tenant FROM tenants LIMIT 1` then took the class by
    title; once `fixtures-phase4-billing.sql` added 'Harbour Swim Club', `enforce_enrolment_tenant()` refused with
    `cross-tenant enrolment refused`. Tell: nothing changed in the failing file — another fixture started working, which is why it had never been seen
    before.
    - **`LIMIT 1` with no `ORDER BY` has no defined row**, and can change after vacuum/index/plan changes.
    - **Derive, don't re-look-up:** `SELECT id, tenant_id INTO v_class, v_tenant FROM classes WHERE title = …`.
      Adding `ORDER BY` only makes the wrong answer *stable*.
    - Same shape as §8.19's `.order("id").limit(500)`. Audit with
      `grep -rn "LIMIT 1" .claude/skills/run-ui-playwright/drivers/fixtures-*.sql` — "is there more than one row
      this could match, ever?"
    Caught by the pass-2 stacked check. (Fixed 2026-08-01.)

74. **AN "EMPTY STATE" ASSERTION MUST CLAIM THE SIBLING STATE IS *ABSENT*, NOT ONLY THAT ITS
    OWN STRING IS PRESENT — THE PREVIOUS SCREEN IS STILL MOUNTED UNDERNEATH.**
    Parent Attendance's *"No lessons marked yet"* vs *"No lessons have taken place yet"* mean opposite things (PRD
    §5.1). `/No lessons marked yet/.test(text)` can pass on the other child's still-mounted panel (§7.10/§7.58) —
    the §8.19 vacuous-pass shape.
    - **Assert presence AND sibling-absence** for any mutually exclusive pair.
    - Assert the **selected entity's name** is on screen first, so a mis-tap fails loudly.
    - Failure detail should distinguish "expected sentence absent" from "BOTH sentences on screen".
    Applied in `verify-attendance-guard.mjs` (absorbed `verify-attendance-window.mjs`). (2026-08-01.)

75. **A DRIVER THAT DOES `.first()` ON A LIST IT DOES NOT CONTROL SCHEDULES AGAINST THE WRONG
    ROW — AND THE CHECK NEXT TO IT KEEPS PASSING WHILE THREE OTHERS GO RED.**
    `verify-attendance-guard.mjs`'s `getByText("Extra lesson").first()` hit another class once the fixture had two
    (14/14 → 10/14). *"admin can schedule an extra lesson"* still passed (it only checked `Scheduled for`); the DB
    checks by `class_id` failed. A UI assertion that does not name its entity cannot tell "worked on something else".
    - **Scope to the row**: `locator("tr", { hasText: <title> }).getByText("Extra lesson")`.
    - **Assert the dialog names the entity** (`Extra lesson — <class>`).
    - §7.73 in the UI layer: never index into a list whose length you do not control.
    Change the fixture FIRST and re-run the **unchanged** driver to isolate the suspect. (2026-08-01.)

76. **A BARE `as SomeType[]` ON AN RPC RESULT DOES NOT CHECK ANYTHING — RENAME A COLUMN AND
    THE UI RENDERS NOTHING, FOREVER, WITH NO ERROR.**
    `platform_tenant_overview()` returns `kind`/`coaches_without_rate`; the page declared `shape`/`staff_without_rate`
    via `setTenants((data ?? []) as TenantRow[])`, so the Shape column was blank and the unpaid-staff-coach badge
    (`undefined > 0`) had **never rendered once** (found 2026-08-01). Both failures look like "nothing to report".
    - **Never `as` an RPC result.** Match the migration's `RETURNS TABLE` names, or map field-by-field so a rename
      is a compile error.
    - Durable fix: generated types (`BACKLOG.md` → *Generate real Supabase `Database` types*).
    - **Audit:** `grep -n "as [A-Z][A-Za-z]*\[\]" **/*.tsx` and check every hit against its RPC.
    - Sibling: **supabase-js infers a to-one embed as an ARRAY while PostgREST returns an OBJECT**
      (`profiles!inner(role)` → `"profiles": {"role": "tenant_admin"}`). Avoid `as unknown as T`; accept both shapes
      and normalise.
    (2026-08-01.)

77. **A TENANT ADMIN READS A PARENT'S PROFILE (NAME, PHONE) ONLY IF THAT PARENT HAS A CHILD
    IN THE TENANT — `parent_tenants` MEMBERSHIP ALONE IS NOT ENOUGH.** `profiles_select`'s admin arm goes through
    `tenant_serves_parent()`, requiring a `parent_students` → `students` chain into the caller's tenant. A
    membership with no child renders "—" and no phone everywhere, silently (found 2026-08-02 by
    `verify-payment-collection.mjs`).
    - When an admin page shows "—" for a parent who exists, check the CHILD link before suspecting the fetch.
    (2026-08-02.)

78. **A FUNCTION CALLED ONLY BY A `SECURITY DEFINER` TRIGGER SHOULD BE REVOKED FROM
    *EVERYONE* — INCLUDING `service_role` — AND THE TRIGGER FUNCTION ITSELF MUST STAY
    DEFINER, OR PRODUCTION BILLING DIES AT FIRST INSERT.** `next_invoice_ref()` is executable by nobody; it is reached only
    via DEFINER `assign_invoice_public_fields()` (no EXECUTE check when *firing* a trigger). Two standing prohibitions (20260802000600): do NOT "clean up" the DEFINER on the trigger
    function, and do NOT "fix" a future permission error on `next_invoice_ref` by granting — that error means the
    DEFINER hop was flattened. pgTAP's service_role INSERT is the tripwire. (2026-08-02.)

79. **A DRIVER WITH NO `check()` CALLS AND A SWALLOWING `catch` IS A SCREENSHOT SCRIPT,
    NOT A TEST — IT REPORTS GREEN FOREVER.** `verify-coach-billing.mjs` had zero assertions, a swallowing
    `catch`, and no exit code (deleted 2026-08-02).
    ⚠ **THE FIRST DETECTOR WRITTEN FOR THIS WAS WRONG** — grepping for `check(` falsely flagged
    `verify-tz-saturday.mjs` (filed in `BACKLOG.md` as "can never fail"; it ran 5/5 with a correct exit code,
    2026-08-03). Grep for the *property*, never for a naming convention:
    ```bash
    cd .claude/skills/run-ui-playwright/drivers
    # A driver with no non-zero exit path cannot report failure, whatever it prints.
    for f in verify-*.mjs; do grep -q "process.exit" "$f" || echo "CANNOT FAIL: $f"; done
    ```
    **A heuristic about test quality must be confirmed by running the test.**
    **The subtler half:** `finally { … process.exit(passed === results.length) }` hides a crash — four checks in
    `verify-stale-screen.mjs` threw, never entered `results` (a counter cannot report an assertion never made), and the run printed "18/18" and exited 0. **`catch`
    the exception and record it AS A FAILED CHECK** (pattern in `verify-stale-screen.mjs` and
    `verify-tz-saturday.mjs`; copy it). Also, both mutation-proven 2026-08-03: **close the browser in `finally`**,
    and **treat a run that asserted *nothing* as a failure** — `process.exit(results.length > 0 && passed ===
    results.length ? 0 : 1)`. See §8.20–§8.22. (2026-08-02, corrected 2026-08-03.)

80. **SWITCHING TABS DOES NOT UNWIND A TAB'S STACK, AND THREE OF THE FOUR OBVIOUS WAYS TO
    UNWIND IT YOURSELF SILENTLY DO NOTHING.** After §7.65, **Classes** still landed on the last marked lesson. Fixed in `(coach)/_layout.tsx` with a `tabPress`
    listener. What did NOT work:
    - `navigation.navigate("classes", { screen: "index" })` — no-op.
    - `StackActions.popToTop()` on the child stack — never fires: expo-router leaves nested navigator `state:
      undefined` in `navigation.getState().routes` (expo-router 4 / RN 0.76).
    - `router.dismissAll()` — `router.canDismiss()` is **`false`** for a tab's nested stack.
    - ✅ `router.replace("/(coach)/classes")`, **deferred by a macrotask** — at `tabPress` you are still on the
      outgoing tab.
    **Two standing prohibitions.** Do NOT move this to `useFocusEffect` or `unmountOnBlur`: both fire on
    programmatic entry and would kill Today's "Mark Attendance" push. Do NOT verify by unit test or deep link —
    only in-app navigation reaches router state (§7.65). `verify-stale-screen.mjs` covers both directions.
    (2026-08-02.)

81. **EXPO'S DEV SERVER CACHES THE ROUTE MANIFEST, SO A RENAMED ROUTE FOLDER LEAVES A GHOST
    TAB AND EVERY DRIVER AGAINST IT IS MEASURING THE OLD APP.** After `git mv app/(coach)/billing app/(coach)/pay`
    the tab bar held a ghost `/billing` beside `/pay`. **Whenever you add, delete or
    rename a file under `app/`, restart Metro with `npx expo start --clear`** (full restart, not refresh) before
    trusting any driver; if a route behaves as though your change never landed, check the manifest:
    `page.evaluate(() => [...document.querySelectorAll("a")].map(a => a.getAttribute("href")))`.
    (2026-08-02.)

82. **`GRANT … TO authenticated` WITHOUT `REVOKE … FROM PUBLIC` LEAVES `PUBLIC` UNDERNEATH,
    AND THE MIGRATION READS AS THOUGH IT DIDN'T.** `CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default; an
    explicit grant only adds beside it. §7.39's sibling, but visible locally in `pg_proc`.
    - **It was live:** `next_credit_note_ref(uuid)` (SECURITY DEFINER, WRITES the counter) had no ACL; an anon
      `POST /rest/v1/rpc/next_credit_note_ref` returned `CN-2026-0001`. Fixed 2026-08-04 (`20260804000200`):
      granted to **nobody** (callers are definer functions).
    - **Copying a function does not copy its ACL** — `next_invoice_ref` (20260802000600) had correct grants; the
      original never did.
    - Named-function grant tests cannot catch unnamed functions. `supabase/tests/function_grants.test.sql` asserts
      over `pg_proc` — *"no function in `public` grants EXECUTE to anon"* — and caught `package_live_balances`.
    - Prod 2026-08-04: 49 anon-executable functions before, 18 after — all trigger/event-trigger functions (Postgres
      never privilege-checks them against the writing role; PostgREST does not expose them). (2026-08-04.)

83. **↪ Folded into §7.40 (2026-09-25)** — a repeat of that lesson; its unique detail now lives there.

84. **`supabase start` DOES NOT START THE EDGE RUNTIME HERE, SO ANY DRIVER TOUCHING THE
    PUBLIC INVOICE PAGE FAILS LOOKING EXACTLY LIKE A PRODUCT BUG.** `supabase_edge_runtime_SwimSync` sits under
    **Stopped services**; `verify-payment-collection.mjs` failed four public-page checks on a **503** from
    `/functions/v1/public-invoice` (same shape as §7.56).
    - Confirm: `curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:54321/functions/v1/public-invoice?token=<any>"`
      — **503** means nothing is served.
    - Fix: `supabase functions serve public-invoice --env-file supabase/functions/.env
      --no-verify-jwt`, then re-run (19/19).
    - The driver's setup notes do not mention the edge function. (2026-08-04.)

85. **`ALTER DEFAULT PRIVILEGES … IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`
    SUCCEEDS AND DOES NOTHING.** Two mechanisms hand a new function to `anon`:
    - **(a) an explicit `pg_default_acl` grant** (cloud: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA
      public GRANT ALL ON FUNCTIONS TO anon`). A per-schema revoke works.
    - **(b) Postgres' built-in `EXECUTE TO PUBLIC`** — **GLOBAL and not stored anywhere**, so a schema-scoped
      REVOKE changes no row. (b) made `next_credit_note_ref` reachable **locally** (§7.82).
    - **Measured, local (2026-08-04):**
      ```
      IN SCHEMA public REVOKE … FROM PUBLIC → default row UNCHANGED, new fn anon_can = true
      (no IN SCHEMA)   REVOKE … FROM PUBLIC → new row (global)={postgres=X/postgres},
                                               new fn acl={postgres=X/postgres}, anon_can = false
      ```
    - **Use the global form, scoped by ROLE:** `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON
      FUNCTIONS FROM PUBLIC` (`20260804000400`); `supabase_admin`'s `extensions` functions keep their defaults.
    - **Mutation-test a probe before believing it** (the migration's `DO` blocks `RAISE` if `anon` can reach a
      throwaway object). A self-check you have never seen fail is a decoration.
    - **Consequence:** a new function in `public` is callable by **nobody** until its migration grants it — a
      forgotten `GRANT EXECUTE … TO authenticated` is a loud `permission denied for function`. (2026-08-04.)

86. **A `WITH CHECK` THAT ONLY ASKS "IS THIS ROW MINE?" IS NOT AN AUTHORISATION CHECK — IT
    MUST ALSO ASK "AM I ENTITLED TO THE THING IT POINTS AT?"** Both halves of a join table are a claim; it shipped
    twice in `20260718000900`.
    - **Reproduced 2026-08-04 with a real anon-key session**, closed by `20260804000500`:
      ```
      POST /rest/v1/parent_tenants  {parent_id: <own>, tenant_id: <any>}  → 201
      POST /rest/v1/parent_students {parent_id: <own>, student_id: <any>} → 201
      PATCH /rest/v1/students?id=eq.<uuid> {full_name, is_active}         → 200
      ```
      Signup is open: anyone could join a business without a join code, attach to any child (bypassing §8.12's
      claim flow), then edit it via `parent_owns_student()`.
    - The original comment assumed the app resolves the code first. **RLS never sees your UI.**
    - Forged membership exposed the business row **including its `join_code`**, PayNow details and coach contacts;
      `stranger_isolation.test.sql` sweeps the catalogue rather than naming tables.
    - Mitigating: student UUIDs are **not enumerable**.
    - **Correct pattern — copy `parent_packages_insert`:** `can_admin_tenant(tenant_id) OR (parent_id =
      current_parent_id() AND parent_in_tenant(tenant_id))`. Both halves.
    - **The fix was to DELETE the policies.** Clients only SELECT; writers are SECURITY DEFINER functions owned by
      `postgres` (`join_tenant_by_code`, `add_child_or_claim`, `link_invited_parent`, `merge_students`,
      `undo_student_claim`) that bypass RLS and never consult `authenticated`'s grants. **Check for a definer RPC
      before narrowing a policy.** (2026-08-04.)

87. **`authenticated` NOW HOLDS A TABLE PRIVILEGE ONLY WHERE A POLICY COULD PERMIT IT, AND
    THE SHORTCUT ROUND THAT RULE IS THE ONE THING CI IS WATCHING FOR.** `20260804000600` revoked everything and
    granted back a whitelist derived from `pg_policies` (50 of 148 pairs had no policy).
    - **Deliberate consequence:** a new table is reachable by **nobody** until its migration grants it, and **a
      migration that adds a policy must add the matching `GRANT`**. `GRANT ALL ON ALL TABLES … TO authenticated`
      is the failure mode: `table_grants.test.sql` assertion 2 goes red on any privilege no policy permits.
    - **Scope the invariant to `authenticated` and `anon` ONLY** — `service_role` bypasses RLS (grants are its
      gate), `postgres` owns the tables; a test red against a correct DB gets disabled.
    - **The §7.85 trap does NOT apply to tables. Do not add `… REVOKE … FROM PUBLIC` here** — a new table carries
      **no** PUBLIC grant, so `FROM authenticated` suffices.
    - **`REVOKE ALL ON ALL TABLES` also hits views/matviews, which a policy-derived whitelist cannot see** —
      stripped of every grant and never granted back; the
      migration `RAISE`s if one appears in `public` — extend the derivation then.
    - The migration proves its whitelist both ways, so a typo'd `GRANT` aborts `db push` on **production**.
      (2026-08-04.)

88. **A WRITE THAT RLS USED TO DENY *SILENTLY* NOW RAISES `42501`, AND THAT CHANGES
    OBSERVABLE BEHAVIOUR — INCLUDING IN TESTS THAT WERE ASSERTING THE SILENCE.** With no policy an `UPDATE` matches
    zero rows; with the *grant* gone too (`20260804000600`) it throws.
    - An error aborts the transaction, so read-it-back tests (`constraints.test.sql`) must be rewritten; the loud
      form is better — a zero-row `UPDATE` looks like success.
    - **Before shipping a grant narrowing, cross-check every client write verb against the whitelist** (unit tests
      run as `postgres`):
      ```bash
      grep -rn 'from("<table>")' -A 4 --include="*.ts" --include="*.tsx" SwimSyncApp SwimSyncAdmin
      ```
      (`.delete()` on `tenants` is `createAdminClient()` = `service_role`, untouched.) **The UI drivers are the
      real proof** — only real signed-in users through PostgREST exercise a grant. (2026-08-04.)

89. **DEFAULT PRIVILEGES ARE A GRID — ROLE × OBJECT TYPE — AND CLOSING IT IN PIECES LEAVES
    A CELL OPEN THAT NO PROBE IS LOOKING AT.** Found only by dumping production after deploy:

    | migration | closed | left open |
    |---|---|---|
    | `20260804000400` | functions ← `anon`, and `PUBLIC` globally | **functions ← `authenticated`** |
    | `20260804000600` | tables, sequences ← `authenticated` | **functions ← `authenticated`** |
    | `20260804000700` | functions ← `authenticated` | — |

    - Each probe tested only its own diff, so all passed while cloud kept
      `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON
      FUNCTIONS TO "authenticated"`.
    - **The dangerous direction of the §7.39 split:** local has no such row (loud), prod silently EXECUTE-able by
      every signed-in user — §7.82 with `authenticated` for `anon`, and **signup is open**.
    - Nothing was over-granted: diff remote vs local authenticated-executable functions (only `rls_auto_enable`
      differed):
      ```bash
      supabase db dump --linked -f /tmp/prod.sql
      grep -E '^GRANT ALL ON FUNCTION "public"' /tmp/prod.sql | grep '"authenticated"'
      ```
    - **Run after any migration that touches privileges** — expect **zero rows**:
      ```sql
      SELECT pg_get_userbyid(defaclrole), defaclnamespace::regnamespace, defaclobjtype, defaclacl
        FROM pg_default_acl
       WHERE pg_get_userbyid(defaclrole) = 'postgres'
         AND (defaclacl::text LIKE '%anon=%' OR defaclacl::text LIKE '%authenticated=%');
      ```
      `table_grants.test.sql` assertion 5 runs locally, where the row never existed; as with
      `function_grants.test.sql` (§7.39), only the remote dump or an apply-time probe checks production. (2026-08-04.)

90. **A SECOND FOREIGN KEY BETWEEN TWO TABLES BREAKS EVERY *BARE* POSTGREST EMBED BETWEEN
    THEM — IN BOTH DIRECTIONS, EVERYWHERE, THE MOMENT THE MIGRATION APPLIES.**
    `tenants.owner_profile_id → profiles` (`20260806000100`) made `.from("profiles").select("tenants(display_name)")`
    ambiguous ("more than one relationship"); `maybeSingle()` read the error as no row, and `/accept-invite` lost
    the business name.
    - Failure at a distance: nothing fails at apply time; only PostgREST reads between that pair break.
    - **Fix with a hint by column**: `tenants!tenant_id(display_name)` (survives constraint renames).
    - Sweep: grep both apps for embeds of either table whose `.from(...)` is the other table of the pair.
    - Found by `verify-tenant-provisioning.mjs` — run drivers before deploying an FK migration. (2026-08-06.)
    - **Folded in from §7.176 (§8.65):** `20260815000600` added two FKs onto `package_products`; PostgREST answers
      **PGRST201 on the WHOLE query**, and two `?? []` call sites rendered empty lists for two days. The blast radius is
      invisible until the data exists. After any FK migration run the ambiguity check (`pg_constraint` grouped by table
      pair, `HAVING count(*) > 1`) and qualify **every** pair at once — PostgREST reports only the first. Check
      `.error` wherever emptiness is a plausible real state.
    - **Now a CHECK:** `supabase/tests/recurring_gotchas.test.sql` #1 goes red on any new table pair joined by two FKs (2026-09-25).

91. **"NEVER GATE ON ROLE" (§7.19) NOW HAS EXACTLY ONE DELIBERATE EXCEPTION — ADMIN-PANEL
    *ENTRY* — AND ITS SHAPE IS WHAT KEEPS IT FROM RECREATING §7.19. DO NOT "FIX" IT BACK.**
    Since `20260806000100`, login and `RequiresTenant` refuse `coach`/`parent` (a created coach also has a
    `tenant_id`). "Ask *does this account have a business*, never the
    role" still governs **which pages** an admin sees.
    - **Refuse ONLY a resolved profile whose role is affirmatively `coach` or `parent`.** Loading, fetch errors
      and unknown roles must never refuse (that locked the real coach out of production once).
    - Head comments in `lib/adminNav.ts` and `components/RequiresTenant.tsx` carry the two-question split; if
      either says "never role" again, the gate was reverted. `verify-admins.mjs` pins the refusal;
      `verify-tenant-admin.mjs` pins that the production admin shape still enters. (2026-08-06.)
    The private coach passes both gates: their role IS `tenant_admin`.

92. **POSTGRES DECIDES REGEX GREEDINESS FOR THE *WHOLE* EXPRESSION FROM ITS **FIRST**
    QUANTIFIER — SO A `.*?` AFTER A GREEDY `\s*` IS GREEDY, AND IT WILL EAT YOUR WHOLE
    FUNCTION BODY.** Unlike PCRE/JS/Python/Perl.
    - In `20260806_markable_floor_DOWN.sql`,
      `regexp_replace(def, '\s*IF p_session_date < markable_floor\(v_tenant\) THEN.*?END IF;', '', 'ns')` ran to the
      **LAST** `END IF;` and deleted all three of `book_trial()`'s other refusals.
    - **Do not fix it by making the first quantifier lazy** (`\s*?`) — a one-character difference nobody reviews.
      Prefer an exact literal `replace()` or line-wise removal anchored on a marker (both used in that file).
    - Second-order trap: the literal `replace()` failed because box characters (`──`) do not survive retyping —
      loudly, which is why it did not ship. (2026-08-07.)

93. **A ROLLBACK FILE THAT HAS NEVER BEEN EXECUTED IS NOT A ROLLBACK PLAN. RUN IT, AGAINST
    A REAL APPLY, BEFORE YOU SHIP THE THING IT ROLLS BACK.** §7.92 and its sequel were only findable this way.
    - The committed-rollback pattern (`20260804_authenticated_grants_DOWN.sql`) is right; **Committed ≠ verified.**
    - After `supabase db reset`, run the DOWN file, then diff `pg_get_functiondef()` for every function it touches
      against pre-migration definitions. `20260806_markable_floor_DOWN.sql` restores all five **byte-identically** —
      which surfaced lost comments (the §7.38 seam note, §7.57's upsert-fires-BEFORE-INSERT warning).
    - Then re-run the **pre-migration** test file under the rolled-back schema (`attendance_window.test.sql` still
      31; the new feature's file fails wholesale).
    - Budget: three `supabase db reset` cycles, ~ten minutes. (2026-08-07.)
    - **A DATA-only DOWN (a re-INSERT of a deleted row) must restore PROD's value — read it with
      `supabase db query --linked` BEFORE the push — not the seed's.** The local rehearsal cannot catch this:
      local holds the seed, so a DOWN that re-inserts the seed goes red/green/red/green perfectly. Found in
      review on `20260925000200` (prod held `false`, the seed `true`). (2026-09-25, §8.124.)

94. **`CURRENT_DATE` IN A FUNCTION IS THE *SESSION'S* TIME ZONE — UTC ON THIS SERVER — SO IT
    IS §7.7 WITH THE DATABASE HOLDING THE WRONG CLOCK. USE `today_sg()`.** Clients are already
    correct (`todayInSg()`); the database end was never audited.
    - **Where it bit (live three weeks):** `set_class_terms()` refused `v_from > CURRENT_DATE`;
      00:00–08:00 SGT **every class edit failed** with `P0001: terms cannot start in the future`.
      `sync_class_display_price()` showed today's rate only from 08:00. Both fixed in `20260807000100`.
    - **Why 14 tests missed it:** the RPC, `class_terms.test.sql` and `verify-class-terms.mjs` all
      said `CURRENT_DATE`, so they agreed with the bug. When a date is involved, ask whether the
      test computes it INDEPENDENTLY.
    - **Test date guards AT the boundary (`today_sg()`, `today_sg() + 1`), never at a comfortable
      distance from it** — the old test used `CURRENT_DATE + 30`, future under any clock.
    - `class_terms.test.sql` asserts over `pg_proc` that **no** function in `public` matches
      `CURRENT_DATE` or `now()::date` — the only deterministic one of the three checks.
    - **A green suite proves the code worked AT THE TIME IT RAN.** The 04:00 SGT nightly found it;
      evening manual runs were green and §8.30 recorded the pipeline healthy. (2026-08-07.)

95. **A SCREEN THAT STORES AN ABSOLUTE DATE IN `useState` AT MOUNT GOES STALE ON A
    LONG-LIVED PWA — HOLD AN OFFSET FROM TODAY, NOT A DATE.** A new axis on §7.7: a **frozen**
    clock. `useState(startOfWeek(todayInSg()))` evaluates once; across Sunday→Monday on the coach
    PWA the TODAY section vanishes and the header reads "Last week".
    - Fix: store `weekOffset: number` and derive `addDays(startOfWeek(todayDate), weekOffset * 7)`
      every render from the screen's `todayDate`; `weekOffset === 0` always means "this week".
    - Looks like "nothing today" and no Playwright run crosses midnight, so coverage is
      `lib/scheduleWeek.test.ts`'s "offset 0 self-corrects across a Sunday->Monday boundary".
      Found in plan review. (2026-08-08.)

96. **DE-DUPLICATING BETWEEN TWO SECTIONS MUST HAPPEN WHERE BOTH ARE *RENDERED*, NEVER
    WHERE ONE IS *FETCHED*.** Filtering today's unmarked lesson out of NEEDS MARKING inside async
    `loadData` couples it to render-time `showsTodaySection`: a week-arrow re-render left today's
    lesson in neither TODAY nor NEEDS MARKING — unmarkable, and the month blocks at invoice time.
    - Derive both in one render — `needsMarking.filter(i => !(showsTodaySection && i.date === todayDate))`.
    - Same rule, second instance: an unmarked past lesson showed under both NEEDS MARKING and DONE
      because week buckets didn't subtract the nag list. (2026-08-08.)

97. **A PERFORMANCE FIX THAT ADDS A DATE FILTER TO A QUERY FEEDING A COMPLETENESS CHECK IS
    A BILLING CHANGE.** §7.18's sibling. Bounding the coach screen's `trial_bookings`/
    `makeup_bookings` queries to the **visible week** is wrong: they feed `expectedStudentsOn()`
    for the **floor-scoped** backlog, so a trial-only lesson drops out of needs-marking while the
    engine still refuses to close the month.
    - Bound such queries to the **union** of every range they serve, say so in a comment at the
      query, and prove it by narrowing on purpose and watching a trial-only past lesson vanish (§7.25).
    - `bookedHere.size` also keeps a class with **no enrolments but a booking** in the loop; an
      over-narrow bound drops the class too. (2026-08-08.)

98. **A DRIVER HELPER THAT WALKS UP THE DOM MUST PRESS ONLY ON A *UNIQUE* MATCH, AND TWO
    DRIVERS' COPIES OF "THE SAME" HELPER MAY NOT BE THE SAME.**
    - **The walk.** `pressClassButton` climbing too far reaches the section wrapper, where `find`
      returns another card's button. Collect **all** matches per level; press only on exactly one.
      On Schedule a class appears twice (NEEDS MARKING and TODAY), so try **every** occurrence.
    - **The consolidation.** `verify-stale-screen.mjs` filtered `pressByText` to the VISIBLE
      screen; `verify-attendance-guard.mjs` deliberately did **not** — it deep-links, and session
      restore leaves the screen under test inside an `aria-hidden` subtree. Merging to visible-only
      turned two checks red. The shared helper takes `includeHidden`, defaulting to filtered.
    - **`document.body.innerText` contains the screens you left** — use `visibleText()`.
      `verify-stale-screen.mjs:437`'s `/today\s*·/i` on Classes was satisfied by the mounted
      Schedule screen's `TODAY · <date>`. (2026-08-08.)

99. **A NESTED `TouchableOpacity` DOES NOT DOUBLE-FIRE ON RN-WEB — THE PRESS STOPS AT THE
    INNERMOST VIEW.** A correction: plan review predicted PayNow / "I've paid" buttons inside the
    invoice card's touchable would also fire its `router.push` after `confirmAction`'s blocking
    `window.confirm` (`lib/confirm.ts`).
    - **Tested:** buttons deliberately re-nested, `verify-parent-pay-claim.mjs` still 16/16. The
      responder goes to the **innermost** view and does not propagate to ancestor Touchables, so the second handler never runs.
    - The action row stays a SIBLING of the touchable (robust to RN-web upgrades), but comments no
      longer claim double-fire, and the "one dialog / no navigation" checks are **outcome guards,
      not the nesting guard** — re-nesting can't turn them red, so per §7.25 they aren't that coverage.
    - §7.83's lesson: run one cheap experiment before designing around a filed mechanism. (2026-08-08.)

100. **A DRIVER THAT SELF-SKIPS ON A DATE CONDITION REPORTS *PASS* WHILE ASSERTING NOTHING —
    AND `new Date()` IN CI IS UTC, SO IT SKIPS ON THE WRONG DAYS.** `verify-trials.mjs` exited
    **0** ("SKIP  today is not a lesson day") off Saturdays, reading the day via
    `new Date().toLocaleDateString("en-SG", …)` with **no `timeZone`**.
    - **§7.7 on the DRIVER's side** (clients use `todayInSg()`, `today_sg()` after §7.94); drivers were never audited. The
      nightly cron `0 20 * * *` (04:00 SGT) runs on the **PREVIOUS UTC day**, so any driver asking
      "what day is it" is wrong for the whole run.
    - **The skip hid a two-week break:** since §8.12 made a parent's phone mandatory (2026-07-26),
      the driver never filled the phone or reached `book_trial()`, yet every sweep counted `trials` PASS. **A driver
      that can skip must say what it skipped; a sweep's PASS is only worth the checks it ran.**
    - **Fix the axis:** compare **ISO option values** against
      `toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" })` — never rendered labels.
      Better: remove the condition — it now marks via floor-scoped NEEDS MARKING, every day.
    - **Related:** the class ROSTER gates "Mark Attendance" on `activeStudentIds.length > 0`
      (**enrolments only**), so a guest-only lesson shows no button there; the Schedule tab uses
      `expectedStudentsOn()` (counts bookings). Test guest-only lessons via Schedule. (2026-08-09.)

101. **ON A SHARED DATABASE, `nth(n)` IS A DATA-CORRUPTION BUG, NOT A BRITTLE-SELECTOR
    NIT — IT WRITES TO A ROW YOU DO NOT OWN, AND THE TEARDOWN THEN DESTROYS THAT ROW'S
    DATA.** `verify-levels.mjs`'s `page.locator("select").nth(2)` assumed seed ordering;
    `fixtures-levels-table.sql`'s `LvlTbl Child …` rows shifted it, the driver set and then
    deleted a level on another child, and `ON DELETE SET NULL` (§7.69) blanked it silently —
    `LvlTbl` children with a level went 3 → 2 while the driver stayed green.
    - **The dependency is the bug:** `nth(n)` over a fixture-dependent list is §7.55 in a locator.
    - **Fix:** `page.getByRole("row").filter({ hasText: "Maya Tan" }).locator("select")` and
      assert match count is exactly 1 before writing. No name to match on is **the** finding.
    - Applies to every driver — the count is `ls drivers/verify-*.mjs`. (2026-08-09.)

102. **A `fixtures-*-teardown.sql` WITH NO `fixtures-*.sql` BESIDE IT IS INVISIBLE TO BOTH
    CI GUARDS.** `check-teardowns.sh` and `check-fixture-roundtrip.sh` both open with
    `for f in fixtures-*.sql; do case "$f" in *-teardown.sql) continue ;; esac` — a teardown is
    only reached as a fixture's sibling, so a lone one is neither required, loaded nor round-tripped.
    - Prefer a driver undoing its own writes **through the UI it already drives**, also run at
      *setup* so a crashed run self-heals — `verify-levels.mjs`'s `cleanupOwnLevels()`.
    - A paired `fixtures-<name>.sql` does buy coverage, but check `run-all-drivers.sh`'s
      `fixture_for()`: its default branch resolves `fixtures-<driver>.sql` by name, silently
      changing what the nightly loads. (2026-08-09.)

103. **A FIXTURE THAT BACK-DATES AN ENROLMENT INVENTS UNMARKED LESSONS, AND UNMARKED
    ATTENDANCE BLOCKS BILLING WITH NO OVERRIDE.** `fixtures-admin-table-geometry.sql` enrolled
    from `markable_floor(tenant)` on a weekly class but marked one lesson; `expectedLessonDates()`
    (`core.ts`) then left the **seed tenant unbillable** on the shared database (§7.55).
    - Neither `run-all-drivers.sh` (resets per driver) nor `check-fixture-roundtrip.sh` (compares
      row counts) catches it.
    - **Rule:** enrol on the date of the lesson the fixture marks, so expected == marked; use the
      marking floor only when the fixture is *about* the floor. Check `is_active` and lesson dates
      in any fixture touching a weekly class. (2026-08-09.)

104. **↪ Folded into §7.38 (2026-09-25)** — a repeat of that lesson; its unique detail now lives there.

105. **A BOUNDARY TEST IS ONLY WORTH THE CASES WHERE THE TWO ANSWERS DISAGREE.**
    `WAVE_1_PLAN.md`'s RISK 6 case `'2025-12-31 23:30:00+08'` → `PKG-2025-…` **passes under the
    bug** — SGT and UTC both say 2025.
    - Discriminating case: **`'2026-01-01 00:30:00+08'`** — red on
      `to_char(NEW.requested_at, 'YYYY')`, green on
      `to_char(NEW.requested_at AT TIME ZONE 'Asia/Singapore', 'YYYY')`, verified both ways.
    - Same lesson as §7.94. Before writing a boundary case, ask **which value would differ if the
      guard were wrong** — if none, it is decoration.
    - SGT family (§7.7): 00:00–08:00 SGT disagrees on the **date**; on 1 January, the **year**.
      (2026-08-09.)

106. **`.select("a, " + "b")` SILENTLY UNTYPES A SUPABASE QUERY — the error names the
    wrong thing.** supabase-js parses the select at the type level and needs a string
    **literal**; `+` widens to `string`, giving
    `Property 'total_value' does not exist on type 'GenericStringError'`.
    - **Rule:** keep a `.select()` on one line, or use a template literal with no interpolation.
      Do not "fix" a `GenericStringError` by casting the row — that is §7.76 (a renamed field
      reads blank forever). (2026-08-09.)

107. **`loginExpo` SHORT-CIRCUITS WHEN THE PAGE IS ALREADY SIGNED IN, SO A DRIVER THAT
    CHANGES PERSONA KEEPS THE PREVIOUS USER AND REPORTS SUCCESS.** `authed()` checks only "on
    the app and off /login" (§7.62's fix); it logs `loginExpo -> <current url>` and returns.
    - Symptom is a missing element later — `verify-paynow-fallback.mjs` timed out on
      `waitFor Settings` still logged in as a parent.
    - **Fix:** `page.goto(EXPO + "/login"); page.evaluate(() => window.localStorage.clear());`
      then `loginExpo` (cf. `verify-admins.mjs`'s `freshLogin()`).
    - **Do NOT "fix" this in `lib.mjs`** by comparing the signed-in email: it is shared with every
      worktree (§7.56) and the short-circuit is load-bearing for §7.62's race. (2026-08-09.)

108. **A DRIVER THAT DIES ON `page.goto(admin/login)` WITH A 30s `networkidle` TIMEOUT IS A
    COLD NEXT.JS COMPILE — NOT DRIVER ROT, AND NOT A PRODUCT BUG.** Neither moved (§7.73's
    question): the dev server had never compiled the route and `networkidle` gives it 30 s.
    - **Where it bit (2026-08-09):** `verify-trial-visibility.mjs` check 9, `loginAdmin`
      (`lib.mjs:77`); 11/11 after one curl. Worst on a short `--only` run against a fresh
      `npm run dev` — `run-all-drivers.sh` doesn't restart servers, so sweeps warm themselves.
    - **Fix (before triaging anything):** `curl -s -o /dev/null http://localhost:3000/login`
      and re-run. If it passes, it was this. Only then reach for §7.73.
    - **Do NOT "fix" it by raising the timeout in `lib.mjs`** — shared with every worktree
      (§7.56), and CI starts cold anyway. (2026-08-09.)

109. **WIDENING WHAT THE INVOICE ENGINE *SCANS* WIDENS WHAT *BLOCKS* IT — AND THE CLASS IT
    BLOCKS ON MAY BE INVISIBLE TO EVERY SCREEN THAT COULD CLEAR IT.** `core.ts`'s classes query
    decides which classes enter the **completeness gate** (RISK 1 in `docs/plans/WAVE_1_PLAN.md`).
    - **Chain:** widen scan → inactive class with `student_class_enrolments.is_active = true`
      re-enters → every weekly date expected → no `lesson_sessions` → month blocks, with **no
      override, by design** (§8a).
    - **Deadlock:** coach class list, Schedule and admin Classes all filtered `is_active`, so no
      one could mark it; `markable_floor()` is a date gate, not visibility. §8.32's deadlock on a
      new axis.
    - **Rule: before changing what the engine ENUMERATES, find every screen that could clear the
      resulting block** — `grep -rn 'is_active' <both apps>`; if "no screen", the UI change ships
      in the SAME deploy or the engine change does not ship.
    - **Closed three ways (2026-08-09):** `classes.deactivated_at` **date** clamps expected
      lessons so the unclearable one is never generated (a boolean can't); the RPC refuses the state; admin gained *Show retired*.

110. **A TEST CAN BE MADE VACUOUS BY THE FIX IT WAS WRITTEN TO SURVIVE.** §7.25 pointed
    forward: re-prove a test red after any change to the mechanism it depends on.
    - **Where it bit (2026-08-09):** `makeups.test.ts:370` pinned the `home_class_id` arm of the
      `class_rates` union only because deactivation dropped the class from the scan; after §7.109
      it passed **12/12** with the arm deleted.
    - **Tell:** a test whose setup includes the condition a change removes.
    - **When it fires:** ask if the guarded code is now *unreachable*. Here it was (`book_makeup()`
      derives `home_class_id` same-tenant), so it was **deleted** — its failure mode was a LOUD
      throw (`rateOn()` has no fallback), never a silent underbill.

111. **A TEST HELPER THAT SATISFIES THE GATE ALSO SATISFIES YOUR ASSERTION ABOUT THE GATE.**
    `completeMonth()` marks due lessons `cancelled_rain`, passing the completeness gate.
    - **Where it bit (2026-08-09):** both `classDeactivation.test.ts` `deactivated_at` clamp cases
      called it and stayed green under sabotage; removing it made one fail.
    - **Rule:** in a test about *what the gate demands*, the fixture may not contain anything that
      satisfies the gate — watch helpers named "complete…", "settle…", "seal…". Tests about billing
      AMOUNTS may use them freely. Any helper producing the asserted state is a vacuity risk.

112. **`throws_ok(…, 'P0001', NULL, …)` ASSERTS ONLY THAT *SOMETHING* RAISED — SO POINT IT AT
    A SUBJECT WHERE ONLY THE GUARD UNDER TEST CAN RAISE.** `NULL` matches any message and every
    `RAISE EXCEPTION` is `P0001`.
    - **Where it bit (2026-08-09):** `class_deactivation.test.sql`'s cross-tenant
      `deactivate_class()` target also had a live enrolment; with `is_tenant_admin()` deleted the
      enrolment refusal kept it green. Found by sabotage.
    - **Fix the SUBJECT:** use an already-retired class, where only the tenant refusal or the
      idempotent `RETURN` is reachable, so removing the check flips it to `lives_ok`. Better than
      matching message text.
    - Give permission tests a subject that is otherwise **perfectly valid**.

113. **A DRIVER WHOSE MAIN ACT MUTATES STATE MUST HAVE THAT STATE RESET BY ITS FIXTURE, NOT
    ONLY BY ITS OWN HAPPY PATH.** Killed mid-run, it leaves the mutation behind.
    - **Where it bit (2026-08-09):** a sabotage run of `verify-class-deactivation.mjs` died between
      retire and restore; next run failed *"Fixture is not in place"*. `ON CONFLICT (id) DO NOTHING`
      can't repair existing rows.
    - **Fix:** `ON CONFLICT (id) DO UPDATE SET <the mutated columns only>` — re-applying the fixture
      is the reset. A `finally` block doesn't survive a hard kill. Same family as §8.36.

114. **`.in("col", [])` IS NOT AN EMPTY FILTER — IT IS A REJECTED REQUEST, AND `?? []`
    SWALLOWS IT.** It renders `col=in.()`, the server refuses, supabase-js returns `data: null`,
    and `(data ?? [])` reads it as "nothing matched".
    - **Where it nearly bit (2026-08-10):** widened `core.ts` guards let a guest-only class reach
      `.in("student_id", billableStudentIds)` and `.in("id", billableStudentIds)` — no visible symptom.
    - **Fix:** `const { data } = ids.length ? await supabase… : { data: [] as Row[] }`. Do not "fix"
      it by defaulting the array to a sentinel id; that is a real query returning real nothing.
    - Check any `.in()` whose array is built by filtering.

115. **↪ Folded into §7.40 (2026-09-25)** — a repeat of that lesson; its unique detail now lives there.

116. **`service_role` BYPASSES RLS, NOT CHECK CONSTRAINTS — AND A NEW CONSTRAINT WILL KILL
    ANY FIXTURE THAT BUILDS A STATE THE PRODUCT CANNOT.**
    - **Where it bit (2026-08-10):** `20260810000100` added
      `CHECK (is_active = true OR deactivated_at IS NOT NULL)` to `classes`;
      `makeup_bookings.test.sql`'s retired class without `deactivated_at` raised `23514` →
      **"You planned 26 tests but ran 0"**.
    - `Bad plan. You planned N but ran 0` = died before the first assertion (usually the fixture).
      Run the file through `psql` and read the first `ERROR:`; `supabase test db` hides it.
    - Build the state the way a user would (add the date), not by dropping the constraint for tests.

117. **A `throws_ok` / `lives_ok` PAIR CAN BE POISONED BY A UNIQUE INDEX WHEN YOU SABOTAGE
    IT.** §7.112's pair: if the guarded call WRITES on success, sabotage makes `throws_ok` insert
    a row and the partner dies on a duplicate key.
    - **Where it bit (2026-08-10):** `booking_class_active.test.sql`'s `book_trial()` pair vs
      `trial_bookings_live_slot_uniq` (`UNIQUE (student_id, class_id, session_date) WHERE
      cancelled_at IS NULL`) — both red.
    - **Fix:** give the partner its own key (same class/weekday one week later).
    - Idempotent (`ON CONFLICT DO NOTHING`) functions are immune. **Record the measured sabotage
      signature in the file header** (which assertions go red).

118. **A UI DRIVER THAT LEAVES A ROW BEHIND WILL BREAK ITS OWN NEXT RUN — AND THE FAILURE
    WILL LOOK LIKE A PRODUCT BUG.** §7.113 for a driver with no fixture.
    - **Where it bit (2026-08-10):** `verify-trials.mjs` never removes its trial; run 2's
      `getByText(/^Present$/).first()` marked one of two guests, and **attendance refuses to save
      until every student has a status**.
    - **Fixes:** use the **"Set all" menu**, and assert on a **count** (`NEEDS MARKING (N)`
      before vs after).
    - **Vacuity:** `!afterSave.includes(KID)` — NEEDS MARKING never renders the child's name.
      Before asserting a string is absent, confirm it was ever present.

119. **A RULE WRITTEN AS A *SHAPE* HAS NO SIZE, AND WILL BE OBEYED PERFECTLY WHILE THE THING
    IT GOVERNS GROWS TEN-FOLD.** `HANDOVER.md` hit **3,972 lines / 290 KB** before the
    2026-07-26 trim, then **1,001 lines / 91 KB** by 2026-08-10, nine days after a cut to 38 KB.
    - Rules like "a ledger **line**", "a **one-line** summary", "prefer **deleting a stale
      line**" bound nothing: rows grew to **1,446 characters**. "Delete what's stale" is an
      unbounded judgement call; §3's in-file note was read past (410 → 469 lines).
    - **Fix: a size, countable in one command.** Ledger row ≤200 chars (`awk 'length($0)>200'`),
      ≤1 `_Previously,_` (`grep -c`), file ≤45,000 bytes (`wc -c`). **Measure at the START of
      the write, not the end.**
    - **Graduating a fact means MOVING it, not copying it.**
    - **A CI byte-ratchet was built, proven, then deliberately reverted** (`cb70808`). If it
      regrows a third time, restore `scripts/check-doc-budget.sh` from that commit rather than
      re-wording the rule again. (2026-08-10.)

120. **AN AUDIT TRIGGER THAT WRITES THROUGH AN RLS-PROTECTED TABLE MUST BE `SECURITY
    DEFINER`, OR IT TAKES THE WRITE IT WAS OBSERVING DOWN WITH IT.** A refused trigger INSERT
    raises and kills the host UPDATE.
    - **Where it bit (2026-08-09, §8.38):** the `students` `AFTER UPDATE … WHEN (OLD.* IS DISTINCT
      FROM NEW.*)` trigger with invoker rights: `audit_log`'s policy refuses → **every student edit
      stops working**.
    - **Accepted, on purpose:** a write with no JWT actor (migration, `psql`, seed, edge function)
      records **nothing and is allowed through**; readers render "system", not blank.
    - §8.38's row pointed at §7.108 (unrelated). **Verify a pointer resolves before you write it**
      (`grep` the target). See **§7.119**. (2026-08-10.)

121. **A UI LOCATOR BUILT FROM A DATABASE DATE FORMATTER AGREES WITH THE SCREEN FOR ELEVEN
    MONTHS OF THE YEAR AND THEN MATCHES NOTHING — AND UNDER `exact: true` THAT IS A THROWN
    DRIVER, NOT A FAILED CHECK.** Postgres `to_char(d,'Mon')` gives `Sep`; the app's
    `formatSgDate` → `toLocaleDateString("en-SG",{month:"short"})` gives ICU **`Sept`**.
    - **Nearly bit (2026-08-10):** an SQL-built label in `verify-schedule-week.mjs` would match
      zero elements 2026-08-25 to 2026-09-23 and throw; the remaining checks never execute. Caught in review, never shipped.
    - `PREV_LABEL` and `floorWeek` are safe **only by luck** (`t.includes(...)`; `Sep` ⊂ `Sept`);
      moving them to `exact:` arms it.
    - **Rule: never cross formatter families for a comparison.** Build the expected string with the
      app's call — `new Date(iso+"T00:00:00Z").toLocaleDateString("en-SG", {...,
      timeZone:"UTC"})`, mirroring `SwimSyncApp/lib/lessonDates.ts` (Node/Chrome agree on all 12
      months) — or better, match an ISO `testID`, `value` or URL. §7.100's "never rendered labels" in a new place.

122. **A NIGHTLY CI RUN IS LABELLED IN UTC AND EXECUTES IN SGT, SO THE WEEKDAY IT ACTUALLY
    SAW IS THE DAY AFTER ITS NAME.** `ui-drivers.yml` `0 20 * * *` = **04:00 SGT next day**
    (run `2026-08-08` ran Sunday 2026-08-09 SGT).
    - Drivers compute dates in SGT; reading the UTC label inverted the 2026-08-10
      `verify-schedule-week` triage by one day.
    - **Date a nightly by its SGT execution day, with the UTC label in brackets**, in issue
      comments and `HANDOVER.md`. §7.7 family: the bug is never the timezone, it is two clocks
      disagreeing. (2026-08-10.)

123. **DROPPING A FUNCTION SIGNATURE BREAKS THE CURRENTLY-DEPLOYED APP FROM THE MOMENT THE
    MIGRATION LANDS, AND §7.60's "MIGRATIONS FIRST" IS WHAT PUTS YOU THERE.** §7.60's order is
    right only for **backward-compatible** changes. Wave 2 replaced `close_student_enrolment(uuid,
    boolean)` with a 3-arg form (no default); between `supabase db push` and `main`, "Remove from
    class" was broken in production (2026-08-11).
    - `book_makeup` survived: its new param *has* a default. **A dropped signature is only safe
      across the window if the surviving one can be called with the OLD argument list.**
    - **Decide order by compatibility:** (a) keep the old signature as a shim and drop it in a
      follow-up migration (expand/contract, per `CLAUDE.md`), or (b) apps FIRST, as §8's tenancy
      phase 4 did.
    - Plan, review and pre-flight all checked against the *database*, none against the *deployed
      client*.

124. **ADDING A DEFAULTED PARAMETER DOES NOT REPLACE A POSTGRES FUNCTION — IT CREATES A
    SECOND ONE, AND POSTGREST MAY GO ON CALLING THE OLD BODY.** `CREATE OR REPLACE FUNCTION
    f(a, b, c DEFAULT NULL)` leaves `f(a, b)`; PostgREST resolves by parameter **name**, so old
    callers hit the old body. **Nothing errors.** In Wave 2 that would have kept `book_makeup`'s
    old non-deterministic home-class `SELECT INTO` live — both derived values are money (`core.ts`
    `rateOn` price, package category).
    - **Always `DROP FUNCTION <old exact signature>` before creating the new one**; assert `\df
      <name>` shows exactly one row (in the Wave 2 pre-commit gate).
    - **Then re-`GRANT`** — new `pg_proc` row, §7.87 applies.
    - A `has_function_privilege()` probe naming the OLD signature **errors**, aborting the pgTAP
      file; grep grant probes for the old signature when you change it. (2026-08-11.)

125. **A TRIGGER FUNCTION THAT ENFORCES A CROSS-ROW RULE MUST BE `SECURITY DEFINER`, OR RLS
    CAN HIDE THE ROW THAT WOULD HAVE FAILED IT.** A plain `LANGUAGE plpgsql` trigger runs with the caller's privileges,
    so its `SELECT` over sibling rows is RLS-filtered and the check **silently passes**. Wave 2's
    `enforce_enrolment_schedule()` scans a child's other enrolments, some hidden by `enrolments_select`; it is
    `SECURITY DEFINER SET search_path = public`, reason stated in the migration.
    - Invisible in local testing (superuser, or the policy permits the read). Same family as §7.16.
    - `SET search_path` is not optional on a `SECURITY DEFINER` function. (2026-08-11.)

126. **A `BEFORE INSERT` TRIGGER THAT COMPARES A ROW AGAINST ITS SIBLINGS MUST EXCLUDE THE
    ROW'S OWN NATURAL KEY, OR A DUPLICATE REPORTS A NONSENSE CLASH *AND* MASKS THE UNIQUE
    VIOLATION.** It runs **before** the unique index is checked. Excluding only `e2.id <> NEW.id` made a re-enrolment
    raise *"Mon 5pm clashes with Mon 5pm"* instead of `23505`. Add `e2.class_id <> NEW.class_id`: **the trigger owns
    "two different rows conflict", the index owns "the same row twice"**. Smoke-test cases before pgTAP. (2026-08-11.)

127. **BEFORE YOU DROP A CONSTRAINT, ASK WHAT WAS RELYING ON IT TO *FAIL*.** Dropping a detector turns no test red. §7.63's unscoped `CROSS JOIN` was caught by
    `one_active_enrolment_per_student` aborting; Wave 2's `(student_id, class_id)` index lets it insert.
    - **Re-prove the dependent guard, do not reason about it.** Sabotage a fixture with an unscoped `CROSS JOIN` and
      re-run `check-fixture-roundtrip.sh`: it still catches it on **delta divergence** (exit 1, naming the fixture).
    - The sabotage must be the shape the *new* schema cannot catch — target a class no sibling fixture touches, or
      the new unique index fires and proves nothing about the detector. (2026-08-11.)

128. **macOS `date -j` CANNOT CONVERT BETWEEN TIMEZONES — IT IS A FORMATTER, AND IT ANSWERS A
    UTC→SGT QUESTION WITH THE INPUT HOUR AND A STRAIGHT FACE.** It parses and formats in one zone, so `TZ=` and `-u`
    move both halves and the conversion never happens; the trailing `Z` is a literal, not UTC. Verified on 2026-08-11:
    ```bash
    TZ=Asia/Singapore date -jf "%Y-%m-%dT%H:%M:%SZ" "2026-08-10T20:49:39Z" "+%A %F %H:%M"
    #   -> Monday 2026-08-10 20:49          ← WRONG, and -u gives the same answer
    python3 -c "import datetime;d=datetime.datetime.fromisoformat('2026-08-10T20:49:39').replace(tzinfo=datetime.timezone.utc);print(d.astimezone(datetime.timezone(datetime.timedelta(hours=8))))"
    #   -> Tuesday 2026-08-11 04:49 SGT     ← the truth
    ```
    - **The tell: output hour equals input hour** — no conversion happened. `gdate` is not installed; **use
      `python3`**.
    - **§7.122's twin**: bit reading a nightly's SGT weekday for `HANDOVER.md` §9.
    - **When a cross-check disagrees with your arithmetic, suspect the tool before the arithmetic.** (2026-08-11.)

129. **A FUNCTION THAT ANSWERS "WHAT WOULD THIS ACTOR'S RATE PRODUCE" CANNOT DRIVE A
    CLAWBACK — IT MUST ANSWER "WHAT IS THIS ACTOR OWED".** Wave 3's `session_pay_amount(session, coach)` ignored
    attribution, so the adjustment loop paid a replaced coach in full (**A 30.00 + B 50.00 on one 50.00 lesson**).
    - Fix: one predicate (`coach_attributed_to_session`) shared by the pay function **and** the selection query, so
      they cannot disagree.
    - **A "what is owed" function must encode entitlement, not arithmetic** — callers asking about past state
      (corrections, reversals, audits) expose it; forward-only callers never will. (2026-08-11.)

130. **REWRITING AN AGGREGATE CAN DELETE A GUARD WHOSE ENTIRE PURPOSE IS TO REFUSE, AND
    NOTHING LOOKS DIFFERENT.** `generate_coach_payouts` pre-flight raises if a lesson has no class terms — "must not be
    reintroduced by a quiet skip". Wave 3's draft moved attribution into a `WHERE`, so a NULL `paid_coach_id` silently
    left payroll.
    - **Read the WHOLE function before replacing it** — scroll `pg_get_functiondef` to the top.
    - Caught by `coach_wages.test.sql` 33 asserting the *refusal*. **A test that asserts an error is the one that
      survives a rewrite.** (2026-08-11.)

131. **THE SEED COACH IS ALSO THE TENANT ADMIN, SO NO RLS *NARROWING* CAN BE DEMONSTRATED ON
    SEED DATA.** `coach@swimsync.test` is deliberately both (`LOCAL_DEV_GUIDE.md`), so `coach_branch OR
    can_admin_tenant(...)` always passes via admin
    - **To test a coach narrowing you must create a NON-admin coach.** pgTAP does; the seed cannot.
    - Production is a private coach-admin, so the Wave 3 narrowing can never lock them out; it only bites businesses with
      non-admin coaches. (2026-08-11.)

132. **A RESOLVE-OR-CREATE RPC MAKES A FIXTURE TEARDOWN INCOMPLETE BY CONSTRUCTION.**
    `assign_session_coach()` creates `lesson_sessions` rows the fixture never named; an id-keyed teardown left two
    orphan lesson rows.
    - **Scope the teardown to `(class, month)`, not to ids, whenever the surface under test
      calls an RPC that can create rows.**
    - **`check-fixture-roundtrip.sh` does NOT catch this** — orphans come from the *driver*. (2026-08-11, wt-admin.)

133. **A REFETCH THAT RUNS OUTSIDE ITS EFFECT'S STALENESS GUARD CAN ROUTE THE NEXT *WRITE* TO
    THE WRONG ENTITY.** A post-save `reload()` repainted class X's dates after the picker moved to Y, so the next write
    was `assign_session_coach(Y, X's date)` — same weekday passes `assert_class_runs_on`, lands **silently**.
    - **One generation counter must cover every load path, not one per effect.** (2026-08-11, wt-admin.)

134. **A POLICY THAT NARROWS A TABLE TO "YOUR OWN ROWS" SILENTLY REMOVES THE ABILITY TO DETECT
    THE ABSENCE YOU CARE ABOUT.** `session_coaches_select` (`admin OR coach_id = current_coach_id()`) means a replaced
    coach can never derive "somebody else has my Tuesday", yet their screen must stop nagging them.
    - Only answer: a `SECURITY DEFINER` probe (`coach_is_main_on_session()`) — one round trip per session; bound the
      set before looping.
    - Ask at design time: *whose screen needs to know about a row they cannot see?* (2026-08-11, wt-coach.)

135. **A HAND-INSERTED *DRAFT* `coach_payouts` ROW DOES NOT SURVIVE A SIBLING WORKTREE.**
    `generate_coach_payouts` rebuilds draft items and worktrees share one `supabase_db_SwimSync` (§7.55). **Any fixture
    standing in for generated pay must be `status = 'paid'`**, or be re-inserted right before the assertion.
    (2026-08-11, wt-coach.)

136. **`WORKTREE.md`'S GRADUATE LIST DIES WITH THE WORKTREE, AND NOTHING FORWARDS IT — BUT IT
    IS RECOVERABLE FROM THE SESSION TRANSCRIPT.** It is gitignored on purpose (no commit, no reflog), and sessions
    do not share context.
    - **Recovery:** transcripts at `~/.claude/projects/<path-mangled-repo>/<session-uuid>.jsonl`. A `/worktree-start`
      session writes to the **root** project directory — identify it by the first user message, extract assistant
      messages containing "graduate list".
    - **Prevention: `/worktree-close` step 4, done literally** — paste the list into the root session or a file
      *outside* the worktree before `ExitWorktree`. (2026-08-11.)

137. **A PRE-CHECK THAT GUARDS AN UPSERT IS TOCTOU BY CONSTRUCTION — THE GUARD BELONGS INSIDE
    THE STATEMENT THAT TAKES THE LOCK.** In `assign_session_coach`'s shadow branch, `IF EXISTS (… role='main') THEN
    RAISE` cannot see a concurrent uncommitted promotion, so `DO UPDATE` demotes the new main.
    - Race-free: `ON CONFLICT … DO UPDATE SET … WHERE session_coaches.role <> 'main'` (waits on the row **lock**, so
      `WHERE` sees the committed row), then `IF NOT FOUND THEN RAISE`.
    - **Measured:** fresh/over `shadow` → `FOUND`; over `main` → **`NOT FOUND`**, row unchanged.
    - **Nothing may sit between the INSERT and the `IF NOT FOUND`**: the next `SELECT`/`PERFORM` clobbers `FOUND`.
    - Without `IF NOT FOUND` the RPC returns success having done nothing (`set_session_main_coach` refuses that). (2026-08-12.)

138. **WHEN A PER-ITEM PROBE BECOMES A BATCH, THE FAIL-LOUD DIRECTION INVERTS — AND "ABSENT
    FROM THE ANSWER" SILENTLY BECOMES THE UNSAFE VERDICT.** `fetchIsMainOnSession` failed towards TRUE; batched
    `sessions_i_am_main_on(uuid[])` computes *covered out = asked minus returned*, so any short/reshaped response HIDES
    a lesson from NEEDS MARKING — and unmarked attendance blocks billing with no override (§8i).
    - Wrong shapes: objects (`RETURNS TABLE` vs `RETURNS SETOF`); `max-rows` truncation (1000); an id never asked
      about; a null element.
    - **Validate that the answer is about exactly what was asked BEFORE subtracting anything from it**; collapse
      anything unvouchable to the empty set. Do not "filter out" bad elements — that yields a *confident* wrong answer.
    - Deleting `CHUNK = 8` hands the bound to PostgREST truncation; replace it with a caller-side cap that refuses to
      send. (2026-08-12.)

139. **A CLIENT-SIDE FILTER THAT REMOVES AN OPTION MAKES THE CORRESPONDING DRIVER CHECK
    UNREACHABLE — AND AN UNREACHABLE CHECK REPORTS PASS.** `assignableShadows()` drops the effective main from the
    shadow dropdown; a driver can pass by ordinal (§7.101).
    - Assert the **absence from the options**, and reach the server guard via a real **stale-tab race** in a second
      page (§7.133).
    - **Both stale selections must be armed BEFORE the state changes.**
    - Assert the **server's own sentence**, never the shared `Could not assign:` prefix. (2026-08-12.)

140. **A DRIVER'S ABSENCE CHECK CAN PASS FOR A SECOND REASON, AND ORDER IS WHAT DECIDES IT.**
    `verify-coach-roster`'s NEEDS MARKING absence check passed with `sessions_i_am_main_on` dropped, because the lesson
    was already marked.
    - **Run the absence check while the lesson is still unmarked.** Reordering was the whole fix.
    - Sibling: Schedule only PROBES lessons with a `lesson_sessions` row; without one, sabotage scored full marks.
    - **Found only by measuring the sabotage signature.** Name the sabotages, run them, paste the scores into the
      header. (2026-08-12.)

141. **A DEEP-LINKED RN-WEB SCREEN CAN RENDER PERFECTLY AND STILL NOT BE OPERABLE.** Coach attendance via
    `page.goto(.../attendance?date=…)` renders, but status presses do nothing (click, forced, `dispatchEvent`). Navigate
    in-app (tap the NEEDS MARKING row), as every marking driver does.
    - **`pressByText`, not a Playwright click** — `getByText` hits the Text CHILD, not the Pressable.
    - **The default 1280×900 viewport, not `mobile: true`.**
    - **`handleSave()` refuses the whole save if ANY student is unmarked** (easy-to-miss toast)
    - A bare `page.reload()` of a nested route bounces to `/login`; `gotoAuthed` retries it. (2026-08-12.)

142. **A GREP NARROWER THAN THE CALL FORM MISSES EXACTLY THE CALL SITES THAT MATTER, AND
    "I GREPPED FOR IT" THEN READS AS PROOF.** `grep -rn 'supabase.rpc(' SwimSyncApp` returned 9 hits and **missed 6**
    including `close_student_enrolment()` (§7.123).
    - **The pattern is `\.rpc(`.** 13 distinct RPCs, 15 call sites, as of 2026-08-12.
    - **Grep for the METHOD, not for the receiver** — injected/wrapped clients defeat it silently.
    - **Sanity-check a "complete" grep against one call site you already know exists.** (2026-08-12.)

143. **A SEAL IS ONLY A SEAL IF EVERY WRITER THAT CAN CHANGE THE ANSWER IS BEHIND IT — AND
    "EVERY WRITER" INCLUDES POSTGREST.** `20260812000200` made pay depend on `class_shadow_coaches` and
    `session_coach_absences`, but the former's seal, own-coach refusal and never-`DELETE` rule lived only in
    `assign_class_shadow()` / `end_class_shadow()` while the table had `FOR ALL … can_admin_tenant(tenant_id)` + DML
    grants.
    - **Measured:** a seed admin's direct `INSERT`/`DELETE` bypassed both in a sealed month.
    - The sibling table's seal is a **trigger** for this reason.
    - **Whenever a payment becomes a function of two tables, the freeze belongs on BOTH, as a trigger, not in the RPC
      that happens to be the polite way in.** Found by `/commit-review`, in the migration that graduated this rule to §7. (2026-08-12.)

144. **TWO DEFINITIONS OF "SETTLED" IN ONE ENGINE IS A HOLE, NOT A DUPLICATION.** The backdate guard tested
    `coach_payouts … coach_id = <this coach> AND status = 'paid'`; Adjustments B (`20260811000200`) has **no
    `coach_id` filter**. A coach with no payout row falls between them — silent
    permanent underpayment. **Write the new guard against the engine's existing definition, not a
    reasonable-looking narrower one** — if you must narrow it, change both together. (2026-08-12.)

145. **DROPPING A COLUMN SILENTLY BREAKS EVERY CLASSIC STRING-BODY FUNCTION THAT READS IT, AND
    POSTGRES WILL NOT STOP YOU.** `ALTER TABLE session_coaches DROP COLUMN role` succeeded with six bodies still
    reading `sc.role` (no dependency recorded); via
    `attendance_write`, no coach could save attendance — billing blocked with no override (§8i).
    - **Enumerate mechanically, before and after:**
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.prosrc ~ '<table>';` — the after-list must not mention
      the dropped column.
    - **`npm run typecheck` cannot see the client half** — `.select("… role …")` returns PostgREST **400**. Grep the
      call sites. (2026-08-12.)

146. **`me` IS NULL ON A DEEP-LINKED SCREEN, SO A CLIENT-SIDE `coach_id = me.id` FILTER
    MATCHES NOTHING — AND THE SCREEN THEN FAILS *OPEN*.** Sibling of §7.141. Zero rows resolved a shadow to
    *"Another coach is teaching this lesson"*; unit tests pass `me`.
    - **Ask the SERVER who you are:** `coach_is_active_class_shadow()` reads `current_coach_id()`.
    - **Precedence rule:** `attendance.tsx`'s `ownsClass` (`!me?.id || cls.coach_id === me.id`) is deliberately
      fail-OPEN; checking it before `isClassShadow` in `lessonRole()` broke driver check 18. **When two inputs
      disagree, trust the one answered server-side over the one that fails open.**
    - A test named `keeps the OWNER role` asserted `"shadow"` — read test names and assertions together. (2026-08-12.)

147. **A pgTAP GATE PROBE UNDER `SET LOCAL ROLE authenticated` CAN TEST THE WRONG REFUSAL
    TWO WAYS, AND A MESSAGE-BLIND `throws_ok` CALLS BOTH A PASS.** Found in `coach_disable.test.sql` (2026-08-13);
    latent in older suites.
    - **An inline subselect resolves under the CALLER's RLS** — `disable_coach((SELECT id FROM coaches WHERE …))` as a
      parent passes NULL → `no such coach`; the gate is never reached. Capture probe ids in a TEMP TABLE **while still postgres** (`_foreign_coach`,
      `class_shadow_coaches.test.sql`) and add a non-NULL control.
    - **A postgres-owned temp table is unreadable by `authenticated`** → `42501: permission denied for table _c`, which
      `throws_ok(…, NULL, NULL, …)` calls a PASS. `GRANT SELECT ON <temp> TO authenticated`. `_foreign_coach` has this hole.
    - **Pin the refusal MESSAGE, not just `P0001`.**

148. **THE PARENT SIDE HAS NO SINGLE CHOKE POINT, AND A TEXT GREP UNDER-COUNTS IT TWO
    WAYS.** Wave 5 chunk 3 (2026-08-13): **21 policy arms plus 2 RPC gates**, plus a family grep could never see.
    - **Enumerate from `pg_policies` on the LIVE database, never from migration files** (`20260804000500` had
      silently removed a path the plan listed).
    - **A grep for `current_parent_id` misses arms composed through OTHER helpers** — `parent_in_tenant()` hid seven
      arms and two RPC gates (`add_child_or_claim`, `find_student_candidates`). Audit parent-only helpers' callers.
    - Method and matrix: `supabase/tests/tenant_suspension.test.sql` — a missed arm fails silent; the grep could never
      see it.

149. **INSIDE A POLICY OR AN INVOKER-RIGHTS TRIGGER, EVERY SUBQUERY RUNS UNDER THE
    CALLER'S OWN RLS — AND A ROW YOUR OWN CHANGE JUST HID READS AS NULL, WHICH CAN PASS
    THE CHECK.** (2026-08-13.)
    - `parent_students_select`'s `(SELECT s.tenant_id FROM students s WHERE s.id = student_id)` returned NULL once
      `students_select` hid the row; `tenant_suspended(NULL)` is deliberately FALSE, so the arm PASSED. Fixed via
      `SECURITY DEFINER` `parent_owns_student()`: **a policy arm that needs a fact from another RLS'd table must get it
      through a DEFINER helper, never an inline subselect.**
    - It moves refusals too (`parent_packages`: 23514 before 42501). Pin the error you actually get; re-ask which wall
      fired near an invoker trigger.

150. **A FUNCTION WHOSE RETURN TYPE MUST CHANGE CANNOT GO THROUGH `CREATE OR REPLACE` —
    IT MUST BE DROPPED, AND THE DROP DESTROYS ITS GRANTS *AND ITS COMMENT*.** Hit by `platform_tenant_overview()`
    (2026-08-13). Restate the full grant triple **adjacent to the DROP in the same migration** (post-`20260804000400` a
    forgotten regrant fails CLOSED), and restate `COMMENT ON FUNCTION`. Proof: the grant dump (§7.39).
    - **Folded in from §7.168 (§8.61, `join_tenant_by_code`):** on Supabase cloud the recreated function is re-granted
      to `anon` by project default privileges, so "works locally" is the failure mode. Next to the DROP: re-`REVOKE`
      from PUBLIC/anon/service_role, `GRANT` to authenticated, restore the COMMENT; the remote dump must show no `anon` row.
    - **Partly checked:** `function_grants.test.sql` #1 catches a function left open to `anon` LOCALLY; the cloud half is still the remote grant dump (§7.39).

151. **CUTTING AN IDENTITY HELPER DOES NOT CUT THE MEMBERSHIP-SCOPED ARMS — the
    `current_tenant_id()` residue is ACCEPTED, TWICE, and the auth-layer ban is the
    enforcement.** A disabled coach (`20260813000200`) and suspended tenant's staff (`20260813000300`) keep every
    `tenant_id = current_tenant_id()` read for their token's lifetime. Its call sites
    include audit stamping (`20260804000300`), deliberately not audited in Wave 5. **Both pgTAP suites pin the residue
    as EXPECTED.** Don't "fix" it by editing the helper without auditing those call sites.

152. **`classes.coach_id` IS THE WRONG ANSWER TO "WHO TAUGHT THIS LESSON" — IT IS THE
    ACCESS AXIS, AND ANYTHING ABOUT MONEY MUST USE THE DATED ONE.** It is mutable, undated. ACCESS follows roster +
    `classes.coach_id`; MONEY follows `class_rate_on().paid_coach_id` + "was I a shadow ON THAT DATE?"
    (`20260812000200` L23-24, `sessionRoster.ts:16-24`;
    `20260719000800`). The Attendance page's Coach column uses access, so a handover shows B beside A's pay. **Filed 2026-08-13 unfixed** (`BACKLOG.md` → *The Attendance page's Coach column…*) — still
    live in `attendance/page.tsx`. **A display-only change reaches money the moment it names a person next to an
    amount.** Copy `wages/domain/payoutItems.ts`, which reads `classes.coach_id` nowhere.
    Why `20260719000800` exists: handing a class over **re-priced its entire unpaid history** when money read `classes.coach_id`.

153. **A SUITE CAN BE GREEN BECAUSE IT ONLY EVER TESTS THE ONE RECORD THE RULE CANNOT
    REACH.** Before `20260813000400`, pgTAP and `verify-admins.mjs` (`admindelete@swimsync.test`) only deleted a profile
    that had never acted; it was
    never used as an actor — structurally blind to rules about history. Tell: a fixture described
    by what it **lacks** ("unreferenced", "never signs in"). **The fix is a second persona
    differing in exactly the one attribute** — `adminhistory@` (a005), a003 plus an audit row naming it ACTOR. It also
    caught the modal needing a *sentence* and the compensating unban (it bans **before** the RPC).

154. **`students_identity_uniq` DOES NOT FIRE ON A NULL DATE OF BIRTH — so the unique index
    alone is NOT a duplicate guard for any code that writes `students.full_name`.** `(tenant_id, lower(trim(full_name)),
    date_of_birth)` treats NULLs as distinct (see `20260719001400`). `rename_student` (`20260814000100`) must **probe**
    — `lower(btrim(full_name)) = v_name AND date_of_birth IS NOT DISTINCT FROM … AND is_active AND id <> self` — as
    `add_child_or_claim` does; the index is only the backstop. **Any new write to `full_name` (or a new same-identity
    insert path) needs its own NULL-safe probe; do not trust the index.** pgTAP goes red without the probe.

155. **THE INVOICE EMAIL READS LIVE `students.full_name`, unlike every other invoice surface —
    so a future RESEND would diverge from the issued document.** `invoice_items.student_name` is snapshotted, so a
    rename never rewrites a sent invoice/credit note (§7.7), but `supabase/functions/generate-invoices/email.ts`
    (~L323-330) reads live `students.full_name`; harmless only while there is **no resend path**. **If an invoice-resend feature is ever built, it MUST read
    `invoice_items.student_name`, not `students.full_name`.**

156. **↪ Folded into §7.38 (2026-09-25)** — a repeat of that lesson; its unique detail now lives there.

157. **A new column on a table whose UPDATE policy is ROW-scoped is client-writable the moment
    it exists — the policy authorises the ROW, the trigger must pin the COLUMN.**
    `parent_packages_update` allows `parent_id = current_parent_id()`. The `20260815*` columns (`start_date`, `validity_weeks`, `ph_extension_weeks`,
    `manual_extension_days`, `ph_ack_weeks_*`) had to be named in `enforce_parent_package_lifecycle`'s
    authenticated-DML branch. `start_date` must be pinned on a **pending** row too (the admin's confirm would adopt
    it; definer RPCs, as `postgres`, still write these — same seam as §7.156). **The rule: every new
    `parent_packages`-family column gets a pin clause in the same migration that adds it, and a pgTAP that proves a
    parent's direct UPDATE of it fails (shown red first).**

158. **A trigger that must UPDATE a SIBLING row on behalf of a parent-initiated INSERT has to
    be SECURITY DEFINER — and then it MUST carry explicit tenant/parent scoping, because
    DEFINER bypasses RLS.** `supersede_open_package_offer` (AFTER INSERT on `parent_packages`) as INVOKER is
    rejected by the §7.157 pin on `superseded_by`. As DEFINER the UPDATE is filtered `tenant_id = NEW.tenant_id AND
    parent_id = NEW.parent_id AND id <> NEW.id AND status='pending' AND offered_by IS NOT NULL AND paid_claimed_at IS
    NULL`, never a bare "same reference". Same shape as §7.156.

159. **NEVER auto-cancel a row that carries a payment CLAIM (`paid_claimed_at`). Cancelled is
    terminal, and the `PKG-`/`INV-` reference on the bank statement then points at a dead row.**
    The supersede trigger (§7.158) deliberately excludes `paid_claimed_at IS NOT NULL`. An offer with a payment claim is cancelled ONLY by the admin's
    explicit Decline — no trigger, RPC or supersede touches it.

160. **Minting a secret from `extensions.gen_random_bytes` inside a SECURITY INVOKER trigger
    fails for the client role (`permission denied for gen_random_bytes`); mint it from a DEFINER
    trigger, and mint UNCONDITIONALLY on any table a parent can INSERT into.** `public_token` on `parent_packages`
    is minted in `assign_parent_package_reference` (DEFINER, unconditional) — NOT in the invoker lifecycle trigger,
    and NOT with an `IS NULL` guard (the parent supplies the value and the guard skips).

161. **`student_package_coverage().lessons_remaining` is a per-student, category-scoped FAMILY
    SUM — "the covering package" is a DIFFERENT question, and the FIFO skips exhausted ones.**
    "Left" reads the sum; "Package"/"Expires" read ONE — earliest-expiring with `live_lessons_remaining > 0`
    (fallback earliest). Don't conflate them. The coverage function must contain NO affordability comparison (`coverage.test.sql` greps for it) — the engine owns "can this package pay".

162. **Parents link to a tenant via `parent_tenants` (many-to-many), NOT `profiles.tenant_id` —
    that column is NULL for a parent (it names a STAFF member's home tenant).** A check written as
    `profiles.tenant_id = <tenant>` refuses every real parent (bit `create_package_offer`).
    Use `EXISTS (SELECT 1 FROM parent_tenants WHERE parent_id = … AND tenant_id = …)`.

163. **A Playwright driver that HARDCODES a seed row's id (a class, a coach) breaks the day the
    DB is reset — `seed.sql` regenerates those UUIDs (`gen_random_uuid`) on every reset.** Bit
    `verify-package-renewal` (§7.73 family). A driver OWNS its fixtures: create the class (coach by
    `coach@swimsync.test`; Default-category ids `7c000000…` ARE stable) with a fixed id, and tear it down. Only
    borrow ids fixed in `seed.sql`.
    - **Folded in from §7.224 (2026-08-30, `fixtures-assessment.sql`):** resolve a seed row by stable identity —
      `SELECT id INTO v FROM classes WHERE title = 'Saturday Beginners' ORDER BY created_at, id LIMIT 1;` + `RAISE`
      when NULL (the `ORDER BY` is §7.73). A `<NULL>` tenant in `cross-tenant enrolment refused` means a MISSING ROW,
      not a tenancy fault. `check-fixture-roundtrip.sh` cannot catch this — it never resets; only a reset-first run can.
    - **Now a CHECK:** `drivers/check-fixture-ids.sh` (CI, repo-invariants) goes red on any UUID literal without `0000` in a fixture or driver (2026-09-25).

164. **An FK written from inside a BEFORE INSERT trigger points at a row that does not exist
    yet — the RI check fires at the end of the INNER statement, not the outer INSERT.** Make it
    `DEFERRABLE INITIALLY DEFERRED` or don't write it there. `apply_referral_reward` (BEFORE INSERT on
    `parent_packages`) does `UPDATE referral_rewards SET reserved_package_id = NEW.id`, killing every purchase. `referral_rewards.reserved_package_id` and `used_package_id` are
    `DEFERRABLE INITIALLY DEFERRED`; pgTAP pins it. (REFERRAL_PLAN.md RISK 2 · §8.61)
    pgTAP pins it: a bare parent INSERT with a reward available inserts one row and reserves the reward with no FK error.

165. **A resource reserved by a BEFORE INSERT trigger is invisible to the AFTER INSERT trigger
    that would free it — the same-statement handoff must resolve inside the BEFORE trigger's own
    predicate.** `apply_referral_reward` (BEFORE) re-uses a reward reserved by an open admin offer
    (`create_package_offer` never supersedes; `supersede_open_package_offer` (AFTER) is too late): candidate set is `available` OR `reserved` by a to-be-superseded offer of the same family, re-pointing `reserved_package_id`. `settle_referral_reward`'s release arm is guarded `AND reserved_package_id = OLD.id`, so
    the supersede-cancel does NOT release the new row's reward. (RISK 4 · §8.61)

166. **A discount is a PRICE concept, not a VALUE concept** — `total_value` / `value_remaining` / invoice
    `package_applied` never move; only `amount_payable` (= `total_value − discount_amount`) does. The in-app PayNow QR (`SwimSyncApp/app/(parent)/billing/paynow.tsx`) and the
    `/package/[token]` pay page both must lock `amount_payable`; the "N lessons · S$r each" line is VALUE, so an
    explicit "− discount" line is mandatory beside it. Never re-price a row that carries `paid_claimed_at` (§7.159,
    amount axis). (RISK 3/6/11 · §8.61)
    Audit: grep every `total_value` render and classify it PRICE vs VALUE — the in-app PayNow QR (`SwimSyncApp/app/(parent)/billing/paynow.tsx`) is a second price surface.

167. **Two BEFORE INSERT triggers on one table run in ALPHABETICAL order by trigger name — a
    trigger that reads another's `NEW.*` must sort after it, and a pgTAP assertion should pin
    that.** `trg_zz_apply_referral_reward` reads `NEW.total_value`, so sorts after `trg_parent_package_lifecycle`.
    Same rule as `20260815000500`'s reference trigger (§6, ARCHITECTURE). (§8.61)

168. **↪ Folded into §7.150 (2026-09-25)** — a repeat of that lesson; its unique detail now lives there.

169. **RLS on `parents`/`parent_tenants` hides OTHER families' rows from a role-scoped pgTAP
    probe, so a driver/test that resolves another family's code under `SET LOCAL ROLE
    authenticated` reads NULL and the RPC then reports the wrong error.** Bit `referrals.test.sql`
    (`join_tenant_by_code(NULL)` → "enter a join code"). Fix: capture needed codes into a NON-RLS temp table as
    `postgres` BEFORE switching roles, and `GRANT SELECT` the temp helpers to `authenticated`. (§8.61)

170. **A re-run of `generate-invoices` on a SEALED month is no longer a no-op — it RE-SENDS any
    invoice email that never went out.** Since 2026-08-16 `retryUnsentInvoiceEmails` runs per (tenant, month) after
    generation, `already_complete` path too. Never double-sends (atomic claim then stamp); skips
    suspended/auto-disabled tenants. Plan: `docs/plans/INVOICE_EMAIL_RETRY_PLAN.md`.
    (§8.63)

171. **A completeness backfill on a best-effort DELIVERY column can permanently seal genuine
    misses — scope it against real data, never blanket by reflex.** Back-stamping `invoice_email_sent_at` would seal
    silent send failures since 2026-07-16. Blanket was correct only because prod's 7 invoices were all PAID. For any
    delivery-tracking column: run the count, decide the WHERE clause against it. Plan ⚠ RISK 2. (§8.63)

172. **`service_role` holds EXECUTE on almost every RPC — but NOT all of them, and a
    `svc.rpc()` whose `error` you discard FAILS OPEN.** Live bug 2026-08-17: `credit-note-emails` gated on
    `const { data: suspended } = await svc.rpc('tenant_suspended'…)`; `proacl` lacks `service_role`, so `data` was
    `null` and the gate read "not suspended" every time.
    **Two rules.** (a) **Prefer reading the COLUMN** — `tenants.suspended_at`, as `generate-invoices/core.ts:275-285`
    does — and **fail CLOSED** on an unreadable row. **Do NOT fix it by granting EXECUTE to `service_role`** (§7.87);
    the 2026-08-17 grant dump confirmed the absence is correct. (b) **Never destructure only `data` off an RPC that
    gates a decision** — for `data === true`, null means *allow*. Check `error`, or don't use an RPC.
    **A guard inside the `Deno.serve` closure is untestable** — never leave one there; the per-note loop moved to
    `core.ts`. **A mitigation only a reviewer can read is not a mitigation.** Plan ⚠ RISK 10. (§8.64)

173. **`can_admin_tenant()` includes `is_platform_admin()`, so it is the WRONG check for
    anything that acts, or sends mail, in a single tenant's name.** It is
    `SELECT is_platform_admin() OR is_tenant_admin(p_tenant_id)`. Use **`is_tenant_admin()`** for per-business actions; it also requires `role = 'tenant_admin'`,
    `admin_disabled_at IS NULL` and a non-suspended tenant, so a UI check on `tenant_id` alone renders a button that
    403s. `can_admin_tenant` is correct where a POLICY already uses it (`attendance_write`). **Do not widen a
    per-tenant check to make a platform admin's 403 go away — that 403 is the feature.** Plan ⚠ RISK 4. (§8.64)

174. **A test fixture that creates shared-database state and then throws BEFORE returning
    leaks it, and the damage surfaces as an unrelated pgTAP failure.** 2026-08-17: a Deno helper threw on its own
    guard before returning, so `try/finally { teardown() }` never ran; the leaked 2026-05 invoice broke
    `supabase/tests/tenant_isolation.test.sql` **test 18** (global `COUNT(*) FROM invoices` = 2). **Rule: everything
    after the fixture is created goes inside a `try` that tears down before rethrowing**, folding a teardown failure
    into the original error.  Tear down multiple scenarios with `Promise.allSettled`. **If
    pgTAP reddens on a global COUNT, suspect Deno-suite debris** —
    `SELECT count(*) FROM tenants WHERE display_name LIKE 'Test Tenant%'` is the check. (§8.64)

175. **`psql` renders `timestamptz` in the SESSION timezone, which is UTC here — reading it
    as SGT is 8 hours of wrong diagnosis.** 2026-08-17: `10:10` was read as old debris; it was 18:10 SGT, this
    session's own (§7.174). §7.7 on the diagnostic side. **When a timestamp decides a
    conclusion, render it explicitly in both zones** — `to_char(x AT TIME ZONE 'UTC', ...)` and
    `to_char(x AT TIME ZONE 'Asia/Singapore', ...)` — and sanity-check against `now()` in the same query. (§8.64)

176. **↪ Folded into §7.90 (2026-09-25)** — a repeat of that lesson; its unique detail now lives there.

177. **A fixture date that means "in the future" must be COMPUTED, never typed.**
    `coach_disable.test.sql` dated a "FUTURE" lesson `'2026-08-15'` against `disable_coach()`'s
    `session_date > today_sg()`; it expired and reddened every push for 20 commits (2026-08-14 → 08-17). Derive
    date-relative-to-today from `today_sg()`; pin a literal only for a fixed past month. ⚠ `6 - dow` returns 0 on
    Saturday — use an offset that cannot be zero and sweep all seven weekdays. Distinct from §7.122. (§8.65)
    - **Folded in from §7.194 (2026-08-20):** `markable_floor()` rolls forward monthly, so literal booking dates
      (`class_capacity_limit`, `tenant_unmarked_lesson_count`) fall below it and `supabase test db` reddens with no
      code change. House style: `today_sg() - 14`. Smell: a literal `'2026-` inside a `.test.sql` booking or span.

178. **"Designed to redden" only pays if someone bumps it the next morning.**
    `verify-platform-admin-scope.mjs` pins the sidebar page count and reddens when a page is added (17 → 18 → 19); left red,
    it hid the `packages` regression (§7.176). **When the nightly reddens, triage it that day even if
    you are certain which check it is** — the sweep reports several. (§8.65)

179. **A CSV export of user-entered text has TWO ways to lie, and quoting fixes neither.**
    `lib/csv.ts`: (a) **Formula injection** — Excel evaluates quoted formulas; `toCsv` prefixes `'` to any STRING
    field starting `= + - @ TAB CR`. **Numbers are passed through untouched** (guarding `-5` breaks SUM).
    (b) **Silent truncation** — pages cap fetch (~1000 rows); `exportCsv` refuses when capped, keyed on the
    **unfiltered fetch count (`sourceCount`), NOT the filtered `visible` length**. UTF-8 BOM for unicode names. (§8.66)
    A blocked download is recoverable; a wrong revenue figure is not.

180. **"Skip the guard, it can't apply here" — CHECK what the guard actually queries first.**
    Convert-a-trial reuses the enrolment two-press guard, which queries only *future* trials
    (`.gte("session_date", today).is("cancelled_at", null)`), so it never fires on the converted past trial; it
    catches a rebooked upcoming trial whose unmarked booking would block the tenant's billing month with **no override** (§7.15). Ported into the convert handler; the
    past trial deliberately STAYS on the needs-marking list — converting is not marking. Read a guard's predicate before dropping it. (`trials/domain/trialConvert.ts`, was `lib/` until Admin L-D; §8.66)

181. **A `*/` inside a CSS comment closes it — Tailwind class patterns are booby-trapped.**
    `h-*/w-*` in a `globals.css` comment broke parsing; `tsc` and dev passed, only `npm run build` caught it. Never
    write `*/` (nor a bare `*` before `/`) inside a CSS comment: say "height/width", not `h-*/w-*`. Build, not
    typecheck, is the check. (§8.67)

182. **`next build` while `next dev` is running corrupts the shared `.next` — the dev server
    then serves 200 with an empty page.** Fix:
    `pkill -f 'next dev'; rm -rf .next; npm run dev`, then re-poll for the actual form
    (`curl … | grep 'type="email"'`), not merely the 200. Don't run `build` and `dev` against one checkout at once.
    (§8.67)

183. **The admin sidebar's grouping is PRESENTATIONAL — never nest `NAV` to build it.**
    `scopeForPath()` (RequiresTenant gating) prefix-matches the FLAT `NAV` in `lib/adminNav.ts`; groups are a separate
    `NAV_GROUPS` + `groupedNavFor` referencing hrefs. Nesting `NAV` (e.g. via `/simplify`) would break the gate
    silently. The unchanged `navFor`/`scopeForPath` unit tests prove scope didn't move; keep them that way. (§8.67)

184. **A one-time dedup that marks rows and a NON-partial `UNIQUE` index in the same
    migration collide — and a 0-row local DB hides it completely.** `20260818000100` first marked duplicate credit
    notes `status='reversed'` then `CREATE UNIQUE INDEX ON credit_notes(invoice_item_id)` — would ABORT on prod;
    `db reset` passed (0 local rows). Fix: the dedup **DELETEs** duplicates.
    Do NOT "fix" it with a partial index instead — the trigger's `SELECT … WHERE invoice_item_id = …` would match
    1-live + N-reversed and re-activate the wrong row. A migration whose repair path is unreachable locally must be
    tested on hand-built dirty data before it ships. (§8.68)
    Deleting the duplicates is safe only because they were undrawn (no `credit_applications` FK).

185. **A column can exist on the running DB but be created by NO migration — schema DRIFT —
    so a bare `DROP COLUMN` breaks `db reset` and would error on prod.** `tenants.suspend` existed locally, created by
    no migration, absent on prod. Use `DROP COLUMN IF EXISTS`. Local and cloud disagree by construction (§7.39,
    §7.89) — verify in `information_schema`, never assume the running DB equals the migration history. (§8.68)

186. **A `FOR EACH ROW` trigger that RAISEs aborts the WHOLE batch upsert, not just its row —
    and the app shows a useless generic toast unless it decodes the SQLSTATE.** Bit the coach attendance `.upsert(rows)` on
    credit-note `CN001`.
    Fix: raise with a distinct `ERRCODE` and map `error.code` (`SwimSyncApp/lib/attendanceSaveError.ts`). Any refusing
    trigger on a batch-written table needs this pairing. (§8.68)

187. **To prove an EDGE FUNCTION deploy actually shipped your code, `supabase functions download <slug>` then check
    `git status` is clean.** No public bundle to grep (§7.31/§7.51); `functions download` **overwrites the local
    directory with the DEPLOYED source**, so clean = live matches branch, a diff = it does not. Pair with `supabase
    functions list` (`version` bumps). It mutates your tree — run on a clean tree, not mid-edit. (`generate-invoices`
    v24, `credit-note-emails` v2, 2026-08-18; §8.69)

188. **Transition tables are SINGLE-EVENT only — a trigger with `REFERENCING ... TABLE` and more than one event is
    rejected** (`ERROR: transition tables cannot be specified for triggers with more than one event`). Use **three
    triggers sharing one function**, branching on `TG_OP` over `newtab`/`oldtab`. Make it idempotent: one `.upsert`
    fires INSERT and UPDATE triggers together. (`20260818000700`; §8.70.)

189. **`CREATE OR REPLACE FUNCTION` cannot rename an input parameter** (`ERROR: cannot change name of input
    parameter`), nor change the result type (§7.150). Do **`DROP FUNCTION` + `CREATE` + re-`GRANT` in the same
    migration** — callable by nobody until granted (§7.87); a missing grant broke every package sale. Census callers
    and re-run their suites: a same-typed arg whose *meaning* changed (weeks→days) is a silent ×7 error.
    (`package_effective_end`, `p_ph_ext_weeks`→`p_holiday_days`, `20260818000600`; §8.70.)

190. **A coverage/attribution resolver lifted from the billing engine must carry the engine's TENANT filter, or it
    leaks across businesses.** The engine filters `.eq("tenant_id", …)` FIRST; without it a two-tenant parent gets a
    package extended that the engine would never draw. Any reuse of the draw predicate (extension, credit, report)
    needs the tenant clause; `holiday_covering_package` takes `p_tenant_id`. (§8.70.)

191. **Tailwind only generates classes it can SEE in `content` — and `SwimSyncAdmin`'s globs scanned `app/` and
    `components/` only, so literal class strings in `lib/` were purged.** `lib/classColours.ts` swatches rendered
    blank. Fix: `./lib/**/*.{ts,tsx}` in `tailwind.config.ts`; **a `content` change needs a dev-server restart** (`rm
    -rf .next`) — HMR does not re-scan. (§8.71.)

192. **`audit_log_insert` was COACH-SHAPED** (`actor_id = auth.uid() AND entity_type = 'lesson_session' AND
    coach_owns_session(entity_id)`, `20260804000300`); the admin lesson page's audit write got **42501**. Widened by
    `can_admin_tenant(session_tenant(entity_id))` (`20260819000100`), red-first. Any NEW client audit writer needs its
    own disjunct — the INSERT grant exists, so `table_grants` stays green and no grant check sees it. The coach app's
    `await supabase.from("audit_log").insert(…)` is UNCHECKED (silent); the admin save reports step `"audit"`.
    (§8.71.)

193. **The admin panel auto-scales its ROOT FONT-SIZE below 1536px wide** (`globals.css`, `43bef0c`: 16 → 15 → 14 →
    13px at 1536/1280/1152); Tailwind is rem, so **a driver pinning pixels pins the viewport**.
    `verify-invoice-controls`' `44x24` was red 2026-08-17..19 at 1280px. Read
    `getComputedStyle(document.documentElement).fontSize` in the same `evaluate`, assert in rem (±0.5px). (§8.72.)

194. **↪ Folded into §7.177 (2026-09-25)** — a repeat of that lesson; its unique detail now lives there.

195. **A TIMESTAMPTZ BOUNDARY HAS TWO AXES — TIMEZONE *AND* INCLUSIVITY — AND A PREDICATE CAN DRIFT ON BOTH WHILE ITS
    SIBLING SIX LINES AWAY IS RIGHT.** `mark_day_holiday`'s `deactivated_at::date > p_date` used the UTC date (§7.7)
    and exclusive `>`, while the engine clamps **inclusive** at the SGT date (`core.ts` `expectedTo =
    lastScheduledDate`, `dates.ts` `ms <= end`). Check BOTH the `::date` zone and `>`/`>=`; one alone still passes
    most tests. Fixed in `20260820000100`. (2026-08-20.)

196. **A UI FIXTURE WRITTEN WITH `ON CONFLICT … DO NOTHING` DOES NOT RESTORE A COLUMN A DRIVER MUTATED — SO A DRIVER
    THAT WRITES TO FIXTURE ROWS MUST RESTORE THEM ITSELF.** `verify-admin-lesson-detail` raises `capacity`;
    `fixtures-admin-calendar.sql`'s re-load kept it and `verify-admin-calendar` failed. Both fixes: `DO UPDATE SET
    capacity = EXCLUDED.capacity` (SELECT asserts it), and the driver restores the column and deletes its booked row
    in a `finally`. A re-load is not a reset. (2026-08-20.)

197. **A "NO-OP SUBSTITUTE" REFUSAL COMPARES THE PAID COACH (`class_rate_on().paid_coach_id`), NEVER
    `classes.coach_id` — BECAUSE `is_cover` DOES.** Assigning a lesson's own coach (`assign_session_coach`) records no
    cover (`lessonAttribution.is_cover` is `subCoach != termsCoach`); `20260821000100` refuses it on the MONEY axis.
    After a handover the axes diverge on past dates, so `classes.coach_id` would refuse a legitimate correction and
    allow the no-op. Pickers: lesson-detail `termsCoachOn(rates,…)`; Substitutes `classes.coach_id` (it never loads
    rates; DB is backstop). Guard runs **before** resolve-or-create (no `lesson_sessions` row on refusal). To revert,
    REMOVE the substitute, never assign them. (2026-08-21.)

198. **A "HARD" CAPACITY LIMIT IS A CHECK-THEN-INSERT, SO IT NEEDS A CLASS-ROW LOCK OR IT IS NOT HARD.**
    `book_makeup`, `book_trial`, `enforce_class_capacity`: under READ COMMITTED two last-seat writers → cap+1.
    `20260821000200`: `PERFORM 1 FROM classes WHERE id = <class> FOR UPDATE` before every count, in the `v_cap IS NOT
    NULL` branch (uncapped classes never lock). ⚠ Races are NOT provable in single-session pgTAP;
    `class_capacity_lock.test.sql` pins the lock STATEMENT per path. Any read-then-write limit needs the row locked
    first. (2026-08-21.)

199. **A `FOR ALL` RLS WRITE POLICY + A TABLE `UPDATE` GRANT MEANS AN RPC'S REFUSALS ARE BYPASSABLE BY A RAW PostgREST
    UPDATE — CLOSE IT WITH A `BEFORE UPDATE` TRIGGER, NOT BY NARROWING THE POLICY.** A raw `UPDATE classes SET
    is_active=false, deactivated_at=now()` skipped `deactivate_class()` (`classes_write` `FOR ALL`, `20260804000600`
    grant); refusals: roster children, future guests, unmarked lessons. The `20260810000100` header's claim otherwise
    was WRONG. You CANNOT fix it in the policy: `WITH CHECK` sees NEW, never OLD. `20260821000300`:
    `assert_class_retirable()` (SECURITY DEFINER, callable by nobody) from a `BEFORE UPDATE` trigger on true→false. ⚠
    Enforced only when `auth.uid() IS NOT NULL`; service_role (edge functions, Deno `retire()`) and superuser are
    exempt. ⚠ `RESET ROLE` does NOT clear `SET LOCAL request.jwt.claims` — also `SET LOCAL "request.jwt.claims" TO
    ''`. reactivate_class() is never guarded, by standing prohibition. It also refuses a false→false UPDATE that MOVES
    `deactivated_at`; a first date is accepted. (2026-08-21.)
    Once set, `deactivated_at` must not move — the engine reads that date as how far the class ran, so shifting it widens the expectation window.

200. **A BOOKING MUST RE-READ `is_active` UNDER THE CLASS-ROW LOCK, AND THE LOCK MUST BE UNCONDITIONAL — OR IT RACES A
    CONCURRENT RETIRE AND LANDS A GUEST IN A DEAD CLASS.** §7.198's lock missed it: uncapped classes took none (the
    FK's FOR KEY SHARE does NOT serialise against `is_active`) and is_active was never re-read. `20260821000400` locks
    UNCONDITIONALLY, re-reads `is_active` and `class_effective_capacity()` under it. Reverse race:
    `trg_class_retirement_guard` (§7.199). ⚠ Drops "uncapped never locks" and widens the 40P01 deadlock to every class
    — deliberate. ⚠ Roster axis (`enforce_enrolment_schedule` + `enforce_class_capacity`, which never re-checks
    is_active) NOT fixed here — `BACKLOG.md`. Structural pin `booking_retire_race.test.sql`, red-first. (2026-08-21.)

201. **THE ENROLMENT AXIS HAS THE SAME RETIRE RACE AS §7.200 — LOCK THE ENTERED CLASS BEFORE READING `is_active`.**
    Else an active enrolment lands in a retired class (§7.109). §7.198's lock missed it: `trg_class_capacity` returns
    early unlocked on uncapped classes. `20260821000500`: `… WHERE c.id = NEW.class_id FOR UPDATE`. ⚠ `NEW.class_id`
    ONLY — `c2` stays lock-free and `is_active`-BLIND (standing prohibition, HANDOVER §3): must not consult
    `c2.is_active`. Reverse race: `trg_class_retirement_guard` (§7.199). Pin `enrolment_retire_race.test.sql`. One row
    locked, so no new deadlock. (2026-08-21.)

202. **`add_unclaimed_student`'s ONGOING arm is ADMIN-ONLY — do NOT re-add the coach arm.** `20260821000600` requires
    `is_tenant_admin()` (was also `c.coach_id = current_coach_id()`, a §7.17 carve-out: "coaches must not add
    students"). A DECISION, not a bug fix (every new child goes through the admin; `BACKLOG.md` → *Deliberately not
    doing*; PRD §7.17). Callers: `SwimSyncAdmin/app/(admin)/{trials,students}/page.tsx`. ⚠ Don't rediscover the coach
    arm and re-add it. Tests: `trial_onboarding`, `class_capacity_limit` 16a (AUTH gate, never capacity). DOWN:
    `supabase/rollback/20260821000600…DOWN.sql`. (2026-08-21.)

203. **A cancelled-date subtraction is the `bookingsByDate` clamp under a new name — subtract from `expectedDates`
    ONLY, never from the union.** (`cancel_lesson`, `20260821000700`.) Dropping it from `datesToCheck` is §7.18: a
    cancelled date that also carries a live make-up/trial booking, OR real attendance rows, must still reach the gate,
    or the month SEALS (underbill, §11.6). `unmarkedOn()` calls
    `expectedStudentsOn(date, [], bookingsByDate)`; the row stays in `sessionIds`/`sessionByDate`. Same rule in
    `class_unmarked_lesson_dates`, `tenant_unmarked_lesson_count`, admin calendar, coach screens. Pin
    `cancelledLessons.test.ts`. `cancel_lesson()` refuses today/past, a marked session, live guests;
    `book_makeup`/`book_trial`/`schedule_extra_lesson` refuse a cancelled date — all under the §7.198/§7.200 lock.
    `restore_lesson()` refuses a sealed month — the marking floor does NOT (§8.48). (2026-08-21.)

204. **A cancelled-session mark-refusal belongs in `guard_attendance_date()`, not the UI** — §7.199 on attendance;
    hiding it is COSMETIC. `20260821000700`: after the correction carve-out (an existing row is always editable — the
    credit-note flow must never be closed by a flag), a NEW row on a `cancelled_at` session is refused, before
    `assert_markable_date`. `guard_session_date` refuses client set AND clear (a raw clear would bypass
    `restore_lesson()`'s sealed-month refusal); a CHECK ties `status = 'cancelled'` to `cancelled_at`. Pin
    `advance_cancel_lesson.test.sql` 19. (2026-08-21.)

205. **A reconcile that reads TIME-VARYING state must be scoped to the ONE unit whose change fired it — never to a
    shared key.** Date scope was sound for `20260818000700` (immutable input) but not `20260821000800` (live
    enrolments). **Key per (package, cancelled LESSON), scope `apply_cancel_reconcile(class, date)` to it**; a
    3-trigger fan (ins/upd/**del**) retracts a raw-deleted session (§7.199). Pin `cancel_package_extension.test.sql`
    14 (must NOT move another package). NO enrolment trigger, no re-fire on activation — deliberate. (2026-08-22.)

206. **A post-payment DEBIT is a SEPARATE `debit_balance` column, NEVER a signed `credit_balance`.**
    (`20260822000100`, §8.83.) The ledger assumes `pool = Σ(note amount − live draws)`, `pool ≥ 0`; negative consumes
    a note **with no `credit_applications` row** and **overcharges the parent**. They **NET at invoice-application
    time**, never in the balance. So `parent_tenant_balances.debit_balance` (CHECK ≥ 0) is separate and
    `credit_balance` keeps its ≥ 0 guard. `partial_payment.test.sql`: a void against a **paid** invoice sets
    `debited_at` ONLY (not `reversed_at`); **re-correcting is REFUSED (`CN002`)** (`BACKLOG.md`). **Don't "simplify"
    this to one signed column.** (2026-08-22.) *(§7.206's blanket `CN002` was later refined: the PENDING case
    auto-unwinds — §7.207, §8.84.)*
    The two coexist and NET at invoice-application time: `apply` folds the debit into the cash base (`gross − package + debit`), never in the balance.

207. **The auto-unwind of a pending debit MUST take the balance row `FOR UPDATE` BEFORE it reads whether the draw is
    still pending — reading first is a silent DOUBLE REFUND.** (`20260822000200`, §8.84, §7.206.) Fix: `PERFORM 1 FROM
    parent_tenant_balances … FOR UPDATE` first. The clearing UPDATE must carry `AND folded_at IS NULL AND
    written_off_at IS NULL` so it can never strip a settled draw. A concurrent `apply_credit_to_invoice` /
    `write_off_parent_balance` between check and SUM re-credits IN FULL; the `debit_balance ≥ 0` CHECK does NOT save
    you. Pin `partial_payment_followups.test.sql`. (2026-08-23.)

208. **A standalone/adjustment invoice in the CURRENT month collides with `UNIQUE(parent_id, tenant_id,
    billing_month)` and makes the engine SKIP the whole month — a silent permanent underbill.** One invoice per parent
    per month (`20260718001100`); `core.ts` ~:1266 `already_exists` skips, seals, and will never reprocess.) Needs
    `invoices.kind` (`'lessons'`/`'adjustment'`), a partial unique index per kind, and the guard filtered to
    `kind='lessons'` — an ENGINE change. (§8.84; 2026-08-23.)
    Decision: collect-now was dropped in favour of a write-off ramp.

209. **To block an action several RPCs can trigger, guard the shared TABLE write, not each RPC.** (§8.84.) First
    scoped to `set_parent_tenant_active`, but `set_students_active` (`20260719001200`) and `close_student_enrolment`
    also flip `parent_tenants.is_active`, so use a `BEFORE UPDATE` trigger (WHEN true→false), balance read `FOR
    UPDATE`. DEBIT-ONLY — credit preserved by design. Pin `partial_payment_followups.test.sql`. (2026-08-23.)

210. **`mailer_otp_exp` is ONE global knob for EVERY email-link lifetime — there is no invite-only expiry.**
    (`generateLink({type:'invite'})`, `provision-tenant/route.ts`; `otp_expiry` in `config.toml`.) **Change it on PROD
    via** `PATCH /v1/projects/{ref}/config/auth` with `{"mailer_otp_exp": N}`, **NOT `supabase config push`** — it
    overwrites the WHOLE remote auth config from local `config.toml`. Invites, magic-links and password recovery all
    share it. The CLI cannot READ it; use GET or the dashboard. `inviteEmail.ts` copy is COUPLED — change both. 86400
    since 2026-08-23. (§8.85.)

211. **Dropping a column breaks every SECURITY DEFINER function BODY that writes it and every `SELECT t.* INTO rec`
    that later reads a field of it — NOT just the client `.select()` lists.** (§7.123/§7.145.) `set_class_terms`,
    `disable_coach` (`SELECT c.* INTO v_class`) failed at RUNTIME only (plpgsql binds record fields at execution)
    (`record "v_class" has no field "location_name"`). Sweep with `grep -rn location_name supabase/migrations` (bodies
    and record-field reads); redefine writers in the same migration. (§8.88, `..._contract.sql.hold`.)

212. **A PostgREST embedded-to-one join hidden by RLS returns `null`, not an error — a policy/grant gap ships as
    silently blank UI, invisible in testing.** `classes.select("…, locations(name)")` gave `location: null` (§7.16,
    §7.125). Assert **non-null as coach AND parent** (`locations.test.sql`); policy + GRANT in one migration. (§8.88.)

213. **An expand/contract sync trigger for a column→FK promotion must choose its direction by WHAT CHANGED (OLD vs
    NEW), not by "is the FK set" — and be created AFTER the backfill, not before.** Key on `NEW.location_id IS NOT
    DISTINCT FROM OLD.location_id AND NEW.location_name IS DISTINCT FROM OLD.location_name`, else a rename SILENTLY
    REVERTS (after backfill every row has an id). Created before the backfill, the backfill fires the mirror path and
    rewrites free text, breaking the DOWN's "columns untouched" guarantee — create it AFTER. (§8.88.)

214. **An expand/contract column DROP must sweep the UI DRIVER fixtures too — not only `supabase/tests`.** The 14
    `.claude/skills/run-ui-playwright/drivers/fixtures-*.sql` + three `verify-*.mjs`; the teardown never deleted a
    leaked `locations` row (EXPAND); on CONTRACT the INSERT hard-errors. Insert an explicit `locations` row →
    `location_id`, teardown deletes it AFTER classes (ON DELETE RESTRICT); translate driver UPDATEs of the dropped
    column to another non-schedule attribute (`colour`). Check: `grep -rln location_name .claude`. (§8.89.)

215. **A UI driver that builds a date-header regex from Node's `toLocaleDateString` will silently stop matching the
    app's rendering the month it disagrees — and for September it DOES: Node's en-US short month is "Sep", the
    browser's CLDR is "Sept".** The driver (Node) and app (browser) can format one date differently;
    `verify-cancel-lesson.mjs`'s card never entered the DOM (red 2026-08-24..27, looked like an app regression). Match
    prefixes (`${weekday}\w*`, `${month}\w*`). §7.122. (2026-08-27.)

216. **A PostgREST filter on an EMBEDDED column restricts the parent rows ONLY when the embed is `!inner` — over a
    plain (left) embed it returns EVERY parent row with the embed nulled, a silent wrong answer worse than the cap.**
    (§7.70.) Use `parent_students!inner(parents!inner(profiles!inner(…)))` **only while that field is searched**. A
    permanent `!inner` drops parentless rows; a base column needs no change. **A to-MANY embed NARROWS too**
    (`invoice_items!inner` strips non-matching items, misstating the WhatsApp reminder + CSV) — push to-many only
    where the display does not need the full set; invoices keep STUDENT search client-side (parent search is to-ONE).
    Sibling of §7's "PostgREST returns null for the ENTIRE select when one embed fails". (§8.91.)

217. **In a PostgREST `.or()` quoted value, a single-backslash wildcard escape (`\%`) still matches EVERYTHING — the
    backslash must be DOUBLED (`\\%`) to survive the parser's unquoting.** Values are quoted so `,()` stay literal,
    but PostgREST unescapes `\x`→`x` before `*`→`%`. `"*\%*"` matched all; `"*\\%*"` none. Use `orValue`
    (`SwimSyncAdmin/lib/tableSearch.ts`); the unit test checks string SHAPE only — the DB probe is the proof. (§8.91.)

218. **A `SECURITY DEFINER` RPC does NOT skip triggers, so changing `tenant_id` while a cross-tenant FK (`level_id`)
    is still set trips the tenant-guard trigger — this SHIPPED a live production bug.** `reassign_student_tenant()`
    left `level_id` set, so `trg_student_level_tenant` (`UPDATE OF level_id, tenant_id`) raised `check_violation` —
    every move of a levelled student failed silently in prod. SECURITY DEFINER changes the ROLE (bypassing RLS), never
    trigger firing. Rule: whenever an RPC moves a row across the tenant boundary, null every cross-tenant FK it carries
    in the SAME update. (2026-08-28, §8.91.)

219. **A completeness count over an EMPTY list is vacuously COMPLETE — `done === total` is true at `0 === 0`, and it
    reports "finished" for exactly the records nobody can act on.** Bit the Assessment tab (§8.93): a child with no
    level / no skills showed **fully assessed**, and "every skill at top grade" (vacuous over `[]`) offered a
    promotion out of a level they are not in. Now explicit refusals (`!noSkills && …`), the empty case is its OWN
    state ("Needs a level"), vitest pins both. **Rule: before writing `done === total`, ask what the predicate means
    when the list is empty**, and make it a distinguishable third answer. Cousin of §7.100. (2026-08-29, §8.93.)

220. **A `NOW()`-stamping trigger cannot be tested for "the timestamp advanced" inside a pgTAP transaction — and the
    naive test passes against the unfixed code.** `NOW()` is the TRANSACTION timestamp and the suite is one
    `BEGIN…ROLLBACK` (§7.16), so comparing them can never observe an advance; backdating with a plain `UPDATE` is clobbered by the trigger
    under test. Plant the old timestamp under a disabled trigger:
    `ALTER TABLE … DISABLE TRIGGER <name>; UPDATE … SET graded_at = NOW() - interval '90 days'; ALTER TABLE … ENABLE
    TRIGGER <name>;`. Examples: `skill_progress.test.sql`, `student_merge.test.sql`, `drivers/fixtures-assessment.sql`.
    **Corollary:** a future `service_role` backfill of that column must `DISABLE TRIGGER` too — recorded in the
    migration's comment, since nothing structural enforces it. (2026-08-29, §8.93.)

221. **An `ON CONFLICT DO UPDATE` array upsert REFUSES THE WHOLE STATEMENT if the array names one conflict key twice**
    ("cannot affect row a second time"), so batching an optimistic UI's gesture must DEDUPE before it sends. Bit the
    Assessment grid's paint mode (a stroke crossing one cell twice). **(a)** the failure is atomic: restore the
    WHOLE-stroke snapshot and refetch, never just the last cell; **(b)** "clear" is a DELETE and cannot ride in the
    batch — hence the prohibition that **paint mode never paints "not set"**. (2026-08-29, §8.93.)

222. **The admin panel's sidebar is a hard `w-64` with no breakpoint, so EVERY admin page has ~70px of content at
    390px portrait.** Found by `verify-assessment.mjs`, which runs at a phone viewport deliberately; panel-wide (`components/Sidebar.tsx`,
    `app/(admin)/layout.tsx`'s `p-8`). **RESOLVED BY DECISION, not a fix: the admin panel is a desktop/tablet surface
    BY INTENT** (user: *"I don't intend on making the admin webapp a mobile app"*; Assessment is done on a tablet). **Not a latent bug; a boundary.** **(a) do not "fix" it
    page-by-page**; **(b)** no horizontal-overflow assertion catches a squeezed layout — to test a narrow viewport,
    assert the content column's width, not `scrollWidth`. `BACKLOG.md` → *Deliberately not doing* holds the decision.
    (2026-08-29, §8.93.)

223. **A UI copy change silently breaks any Playwright driver asserting that string — and PLURALISING A VERB is
    the case a substring regex misses.** "1 child **needs** a level" broke `verify-assessment.mjs`'s `/need a level/i`
    (the red names the driver, not the copy — §8.65). **Before changing any user-visible string, grep the whole repo
    for it** (`grep -rn "<string>" . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git`) — it had four
    call sites. **(a) Write the driver's regex to tolerate the inflection it is not asserting** — `/needs? a level/`.
    **(b) A deploy record is NOT a call site to update:** DEPLOYMENT §11.46 quotes the old string as what was grepped
    that day; rewriting it falsifies the record — a re-verifier would check a string that was never served. (2026-08-29, §8.94.)

224. **↪ Folded into §7.163 (2026-09-25)** — a repeat of that lesson; its unique detail now lives there.

225. **A driver must never RESTATE a date its fixture computes from `now()` — ask the database what it
    inserted.** `verify-trial-visibility.mjs` asserted `/\d{1,2}\s+Aug/` against a fixture booking the next Saturday
    in SGT; red on 2026-08-30 when that fell in Sep — the calendar moved (§7.122's question via a month boundary).
    Fix: the driver's `sql()` helper reads `to_char(session_date,'FMDD')`/`'Mon'` off the fixture row. Keep `\w*` on
    the month — 'Sep' and 'Sept' must both pass (§8.90). ⚠ **When auditing, ask whether the FIXTURE's date is absolute
    or relative, not whether the DRIVER's assertion looks hardcoded** — `verify-bulk-setall`'s `11 Jul` and
    `verify-class-students`' `4 May 2026` are safe (fixtures insert literal `'2026-07-04'` /
    `'2026-05-04 12:00:00+08'`). A fact written down twice drifts (§7.223, §7.224): keep ONE copy, derive the other.
    (2026-08-30, §8.95.)

226. **A Playwright `clock.install()` CANNOT fake `markable_floor` — it is client-side, and the floor is Postgres
    reading the real clock.** `verify-bulk-setall` / `verify-unmarked-lessons` froze the browser at 15 Jul 2026 with
    July lessons; on 2026-09-01 `markable_floor` (1st of LAST month) dropped them. Proven by pinning
    `session_window_start()` to `2026-08-01` (control `2026-07-01` passes). **Invisible in a screenshot**: an empty
    backlog is a normal screen.
    ⚠ **THE FIX IS "LAST MONTH", NOT "THE LAST FEW DAYS", AND THE REASON IS A SECOND CONSTRAINT.** The fixture also
    drives invoice generation and **a billing month must have ENDED to be billable** (PRD §7.7). Use the last two
    Saturdays of the PREVIOUS month (last Saturday is ≥ the 22nd, so minus seven stays in-month).
    ⚠ **Also watch the ENROLMENT date.** The bound is `max(server floor, earliest enrolment)`; back-dating enrolment
    drags extra unmarked Saturdays in and "the backlog clears" can never pass. Put it just before the marked lesson (`missing_sat - 10`).
    ⚠ **When auditing, grep ISO dates too, not just month names** (missed `/date=2026-07-11/`). A correctly derived
    fixture cannot be validated by the floor-override trick (floor and `now()` disagree by construction); test those
    against the real clock. (2026-08-30, §8.95.)

227. **A Singapore calendar date compared against a `timestamptz` through a ZONELESS `T00:00:00` puts the
    boundary at the VIEWER's midnight, not Singapore's** — §7.7's axis. `isFreshGrade(gradedAt, since)`
    (`SwimSyncAdmin/lib/assessment.ts`) parsed `` `${since}T00:00:00` ``, so west of Singapore fresh grades read as a
    previous round's. Fix: `` `${since}T00:00:00+08:00` `` (no DST). Nightly 2026-08-29: `verify-assessment` 21/27.
    ⚠ **THE REPRODUCTION IS A TIMEZONE, NOT A CLOCK.** The condition is "the device's date differs from Singapore's":
    `TZ=Pacific/Midway node verify-assessment.mjs` reproduces 19 h/day. **Reach for a zone before reaching for
    `clock.install()`** (which cannot fake a server timestamp — §7.226). A `TZ=UTC` run alone proves nothing.
    ⚠ **DO NOT "FIX" THIS BY PINNING `timezoneId` IN THE DRIVER.** 43 of 50 drivers do not pin it; the unpinned driver
    on a UTC runner caught this bug. Pinning would have hidden it.
    ⚠ **The display half is the same axis and needs the house helpers.** `toLocaleDateString("en-SG", …)` with no
    `timeZone` renders the DEVICE's date; use `toSgDate()` then `formatSgDate()` (`lib/lessonDates.ts`).
    ⚠ **The driver is TIME-DEPENDENT coverage; the deterministic pin belongs in vitest.** `assessment.test.ts` asserts
    the boundary across five zones via `process.env.TZ` (as `lessonDates.test.ts` / `tableSort.test.ts`). A zoneless
    literal like `"2026-09-01T00:00:00"` (which the database never produces) in a test pins nothing — both sides move together. (2026-08-30.)

228. **The nightly uploads its SCREENSHOTS, and nobody had ever opened them — do that FIRST when a UI driver
    reddens.** `gh run download <run-id> -n ui-driver-run -D <dir>` pulls logs *and* `shots-<driver>/` PNGs.
    `verify-tenant-provisioning`: two wrong hypotheses, settled by `prov-created.png` showing "Creating…". **Run this
    before forming any hypothesis about a driver red.**
    ⚠ **THE CAUSE: a fixed `waitForTimeout` after an action that round-trips an API route.** **A fixed sleep converts a
    slower machine into a fake PRODUCT failure.** Wait for the OUTCOME — `page.waitForFunction` on success *or* error
    copy, generous timeout — never for a duration.
    ⚠ **DO NOT READ TOTAL WALL TIME AS RUNNER SPEED.** CI ran 8 checks vs local 15 (the red bailed out of a
    sleep-heavy block). **Compare like segments, or compare nothing.**
    ⚠ **A whole-body regex can PASS on a row the driver does not own.** `/SWIM-[A-Z2-9]{4}/` over `innerText("body")`
    matched the seed's `SWIM-TEST` in the table (§7.75, §7.101). Scope an assertion to the element the action produced.
    ⚠ **A detail string must not print the failure case as a success branch.** `noKey ? "warned + link shown" :
    "sent"` printed `sent` on failure. Print what was observed; give the neither-branch case its own words.
    ⚠ **A fallback that reads an attribute the app never renders is DEAD CODE that silently disables the
    driver.** `data-tenant-id` exists nowhere in the admin panel, so the `/api/resend-invite` fallback never ran and
    checks inside `if (inviteLink)` went unrun (§7.100's shape). Replaced with a named precondition (`RESEND_API_KEY`
    must be UNSET) and a loud skip: **a shrinking denominator is not a signal anyone reads.**
    ⚠ **When auditing for the dead-attribute shape:** `grep -o 'getAttribute("data-[a-z-]*"' drivers/*.mjs`,
    then grep the app for each name (`data-status` in `verify-admin-lesson-detail` is real). (2026-08-30.)

229. **`toSgDate()` THROWS on a malformed value ON PURPOSE — display and logic need DIFFERENT helpers, and
    "hardening" the shared one is how a loud crash becomes a silently wrong answer.** Its 34 call sites are mostly
    LOGIC compared **lexically** (`attendanceCompleteness.ts` backlog, `classCoverage.ts` bounds, `AssessmentGrid.tsx` →
    `isFreshGrade`, §7.227). A degrade → `parseDate` `NaN` → `expectedLessonDates` `[]` → "nothing expected", grades
    misclassify, billing silently blocked (caught by `/plan-review`, 2026-08-30). ⚠ **PROHIBITION: never add a NaN
    guard, a try/catch, or any degrade path to `toSgDate`, `todayInSg`, or `parseDate`.** For display use
    **`formatSgStamp(iso, opts)`** — degrades, never throws, DISPLAY ONLY, correct for a `timestamptz` **and** a bare
    `"YYYY-MM-DD"` (UTC midnight is 08:00 SGT the same day; east of Greenwich it never wraps). Use it for every
    rendered date; `formatSgDate` still takes a `"YYYY-MM-DD"` you already hold.
    (2026-08-30.)

230. **A source-scanning guard is only as good as its PARSER, and all three of its ways to lie are silent** —
    from `sgDisplay.drift.test.ts` (both apps). Enumerate and classify the reds before fixing anything.
    ⚠ **Blanking a comment must PRESERVE LENGTH** (overwrite with spaces), or every later match offset shifts.
    ⚠ **A template literal's `${…}` is CODE, not text.** Blank the literal segments; step over the substitutions.
    ⚠ **An allowlist matched by PROXIMITY is not an allowlist.** A flat 400-char window reached into a neighbouring
    function. Bound the window to the enclosing block. Pin every entry to file **and** content snippet, never
    file-level.
    ⚠ **Presence of an option is not correctness.** `timeZone: "UTC"` on a `timestamptz` is wrong 8 h/day (§7.227);
    the guard rejects UTC except where the `Date` was built as UTC. **And add a vacuity test**: assert the scanner
    finds call sites at all. (2026-08-30.)

231. **A guard lies in TWO directions, and testing it only one way proves half of it.** §7.230 is the parser; this
    is verdicts: a false RED and an invisible HOLE; §7.25's RED-proof only exercises the hole. From
    `authEmailConfig.drift.test.ts`:
    ⚠ **The false red lands on the line most likely to be EDITED.** `enable_confirmations = false # do not change`
    failed a raw-TOML compare (§8.65: a red nobody believes stops being an alarm). **Strip inline comments
    quote-aware, before unquoting.**
    ⚠ **The hole hides where the pattern's ANCHOR does not appear.** `/\{\{\s*\.(\w+)/` misses `{{ if .Emial }}` and
    double-captures `{{ .Data.foo }}`. **Find the enclosing constructs first, then the roots inside them**
    (`(?<![\w.])\.(\w+)`).
    ⚠ **A file that DOCUMENTS the rule it is scanned for trips its own guard** (email templates' "email clients strip
    `<style>`" comment). **Strip comments before scanning.**
    ⚠ **So: for every assertion, mutate BOTH ways** — break it and watch it redden, then make a plausible benign edit
    and watch it stay green. The second half is not optional. (2026-08-30.)

232. **A Supabase AUTH email template cannot be rendered through the live path without its own feature flag —
    there is no admin backdoor.** (`confirmation.html`, while `enable_confirmations` stays deliberately false — see
    `BACKLOG.md`.) **`auth.admin.generateLink()` mints a link and sends NOTHING** (hence
    `SwimSyncAdmin/lib/inviteEmail.ts`); `auth.resend({type:'signup'})` needs the flag; `admin.createUser()` does not
    send. ⚠ **Do not read "the template shipped" as "the template was sent."** Substitute: a structural diff against
    a production-proven template (`confirmation.html` markup is byte-identical to `recovery.html`) plus an offline
    render — and state that limit wherever the work is recorded.
    ⚠ **The hosted FLAG can be read back; the hosted TEMPLATE cannot.** `supabase config` has only `push`:
    `curl -s https://<ref>.supabase.co/auth/v1/settings -H "apikey: <anon>"`. ⚠⚠ **The field is INVERTED and
    the inversion is the trap: `"mailer_autoconfirm": true` means confirmations are OFF** — `true` is the safe state
    (confirmed on prod 2026-08-30). The template body stays a dashboard check, and a `config push` would carry the
    whole local config, toggle included. (2026-08-30.)
    `enable_confirmations` stays deliberately false — it stranded web parents (see `BACKLOG.md` → the shipped email-confirmation item).

233. **A source-scanning guard silently NARROWS when code moves to a new top-level folder — it does not fail,
    it just stops looking.** `SwimSyncAdmin` has no ESLint; structural rules are vitest source scans over a fixed path
    list. Hence the Students refactor's tiers live UNDER `app/(admin)/students/`, not top-level `ui/`/`domain/`/`dao/`,
    inheriting `sgDisplay.drift.test.ts`. When you add a guard OR relocate code, ask what each scan's path list still
    covers. Pattern: `tierBoundaries.drift.test.ts` — shrinking allowlist pinned by file AND content snippet, never
    file-level. (2026-09-12, the admin refactor.)

234. **Making a fixture now()-derived is only HALF the fix — the PAIRED DRIVER's own hardcoded dates rot the
    same day, and a hardcoded month can stay GREEN by matching UNRELATED dated data (green for the wrong
    reason).** `verify-unmarked-lessons.mjs` kept a hardcoded "2026-07" month picker (red from 2026-09-01);
    `verify-trial-visibility.mjs`'s coach-side `/\d{1,2}\s+Aug/` stayed green on an unrelated August date (§7.225).
    Rule: when a fixture goes now()-derived, grep the WHOLE driver for every date literal — form-fills AND assertions,
    on BOTH role-sides — and derive each from the fixture row. Weekday-dependent drivers: a booking `<= today` lands on
    TODAY, not NEEDS MARKING (§7.122); book strictly-past. (2026-09-12, nightly triage.)

235. **A `lib/` helper that takes the supabase client AS AN ARGUMENT is still a network reach from the caller —
    moving every `.from()` and `.rpc()` off a page does not get the client off it.** Students `page.tsx` still
    imported `@/lib/supabase` for `lib/studentStatus` helpers (`familyActiveChildren(supabase, …)`) that call
    `db.rpc()`, breaking "only `dao/` touches the client". Fix: bind them in `dao/<feature>.rpc.ts`
    (`export const familyActiveChildren = (id) => studentStatus.familyActiveChildren(supabase, id)`); the lib module
    does not move (drift-pinned to SwimSyncApp). The coach app's screens will hit this harder.
    (`docs/refactor/FEATURE_TIER_REFACTOR_PLAYBOOK.md` §1. 2026-09-12.)

236. **Grep a UI driver for the page's URL before crediting it with coverage — a driver's NAME says what it
    tests, not WHERE.** `verify-student-identity` was credited with admin Students coverage but is a coach-app driver
    that never opens `/students`; NO driver covers Merge or Rename there (queued in `BACKLOG.md`). Rule:
    `grep -lE '/<route>"' drivers/verify-*.mjs` is the coverage map; a table written from memory is a guess. Three
    such drivers hardcode ports and need a port-substituted copy for a worktree (BACKLOG). (2026-09-12.)

237. **A deep link into the Expo app is REPLACED by the landing tab, so the screen you asked for is mounted
    but hidden — assert its render by polling, and reach a nested-stack screen by PRESSING from the tab bar.**
    `app/_layout.tsx` does `router.replace(landing)`; the deep-linked screen survives `aria-hidden` (lib.mjs
    `includeHidden`) unless it is on the landing tab's stack, where it is popped (`/home/child/<id>`). Poll up to
    ~10 s (session-keyed effects); hidden = unpressable. Press the always-visible tab-bar label, then into the stack.
    (`verify-smoke-app.mjs`; `docs/TESTING.md` §5. 2026-09-13.)
    **Product half FIXED 2026-09-24 (§8.120)** — see §7.254: a deep link inside your own area is no longer
    replaced, so the requested screen is the visible one. `/login`, `/` and the other role's screens still redirect.

238. **Metro can serve a STALE bundle after an edit — grep the served bundle for a marker before believing a
    fix "didn't work".** The `…&unstable_transformProfile=hermes-stable` variant lacked the edit while `lazy=true` had
    it; `npx expo start --web --clear` fixed it. §7.31's rule: `curl` the bundle URL from the page's `<script src>`
    and grep for a string only the new code has. (2026-09-13.)

239. **Running a UI driver needs Docker + the Supabase stack + BOTH dev servers + Playwright at once, and on
    a tight machine that OOM-kills the Postgres container mid-run (exit 137) — recover with `supabase stop &&
    supabase start`, never a bare re-`start`.** Symptom: `supabase_db_SwimSync container is not running: exited`,
    and `supabase start` says "supabase start is already running" (stale lock). The runner hard-requires :3000 AND
    :8081; dev servers get reclaimed too — close what you don't use. Prefer `run-all-drivers.sh --only
    <name>` (~90 s) to the full sweep for one page. (2026-09-15.)

240. **A Playwright `waitFor({ state: "detached" })` (or an `exact:true` `getByRole`) on a button whose LABEL
    CHANGES on click resolves INSTANTLY — the relabel makes the locator match nothing, and "matches nothing"
    is reported as "detached".** A following `page.goto()` then aborted the in-flight POST and the mutation never landed. Wait on the RESULT:
    register `page.waitForResponse(r => r.url().includes("/api/x"))` BEFORE the click, `await` it, then read state.
    Bit `verify-tenant-suspension` (2026-09-16), whose nightly flake was a fixed `waitForTimeout(4000)` (§7.228).
    (`docs/TESTING.md` §5. 2026-09-16.)

241. **`sgDisplay.drift.test.ts` has a TWIN in each app, and BOTH scan `SwimSyncAdmin/app` — so a `toLocaleDateString`
    that MOVES between admin files must be repointed in the app twin's allowlist too, in the same commit, and you must
    run BOTH `npm test` suites.** Moving `formatBillingMonth` to `invoices/domain/invoiceRows.ts` went red on `main`
    (CI `frontend-tests (SwimSyncApp)`, run 35108878874). Playbook §2 gate: `cd SwimSyncAdmin && npm test` **AND**
    `cd SwimSyncApp && npm test` at every stage. Fix: repoint `SwimSyncApp/lib/sgDisplay.drift.test.ts` (`6fe19e6`).
    See the playbook §1-table "both twins" note. (`docs/refactor/FEATURE_TIER_REFACTOR_PLAYBOOK.md`.
    2026-09-16.)

242. **A `git add <pathspec>` that names a file `git mv` already moved fails the WHOLE `add`, and staging nothing
    else — so a stage commits only the rename and strands its real content on disk, where every gate still passes.**
    Classes refactor: `git add -A '<page>/' lib/tierBoundaries.drift.test.ts lib/locationOptions.ts
    lib/locationOptions.test.ts 2>/dev/null` after `git mv` of `locationOptions.*`. **The `2>/dev/null` is the trap.**
    Rules: after a `git mv`, do NOT re-list the moved paths in a later `git add`; never pipe a `git add` to
    `/dev/null`; **`git status` must be clean after every commit**. Recovered by fixup `7b19d8d`. (Classes refactor,
    2026-09-17.)

243. **A plan's grep assertion of the form "X must appear 0 times" MATCHES ITS OWN PROHIBITION COMMENT, forever.**
    E.g. `// Do NOT check strandedRes.error` matches `grep strandedRes.error` (`PLATFORM_REFACTOR_PLAN.md`) — a
    phantom violation. **Count over comment-stripped source**: `stripComments()` in
    `SwimSyncAdmin/lib/tierBoundaries.drift.test.ts` (why the fence's own checks never had this problem). Write plan assertions as "N in CODE" and name the tool that
    produced the number. (Platform refactor, 2026-09-18.)

244. **A bare `page.selectOption("select", …)` in a driver is a ONE-`<select>` DOM CONTRACT on the page under test,
    and nothing at either end says so.** `verify-platform-admin` relies on `@/components/Modal` rendering `null` when
    closed. A second unconditional `<select>` makes it silently drive the wrong control (strict mode does not fire for
    `selectOption`'s string form). Recorded in `platform/ui/StudentMoveSection.tsx`'s header. Its two "Search" buttons
    use `.first()`, so the student-move / family-status card DOM ORDER is a contract too. (Platform refactor,
    2026-09-18.)

245. **`verify-smoke-admin`'s exact-`h1` check cannot tell a page's REFUSAL branch from its content when both render
    `PageHeader` with the same title — so it is never evidence that an access gate works.** `/platform` renders
    `<h1>Platform</h1>` for both. The gate is asserted by `verify-platform-admin-scope` and `verify-platform-admin`
    (refusal TEXT). Don't count a smoke pass toward a gate change. (Platform refactor, 2026-09-18.)

246. **On a page that renders tenant names in TWO tables, `locator("tr", { hasText: <tenant name> })` is ambiguous
    and silently resolves to the FIRST one.** The platform page's Businesses overview matched first, and the failure
    read like broken tenant-narrowing. Scope with a second `hasText` (the parent's name) or a container locator.
    §7.75/§7.101. (Platform refactor, 2026-09-18.)

247. **Adding a route's PARENT directory to `SCOPE_DIRS` does not fence its nested `[param]/page.tsx` — each route
    unit needs its OWN entry, and nothing tells you it is missing.** `sources()` in `tierBoundaries.drift.test.ts`
    deliberately skips subdirectories holding their own `page.tsx`; the vacuity test cannot notice (`PAGES` derives
    from `SCOPE_DIRS`). Caught by `/plan-review`. Prove a nested scope is live with a breaker INSIDE it
    (`assessment/[classId]/ui/Break` → `../dao`). (Admin L-D, 2026-09-18.)

248. **A source-scanning test keyed on `page.tsx` loses coverage every time the tier refactor decomposes a page —
    silently, and while staying green.** `components/Table.test.tsx`'s §7.54 guard missed 24 tables moved to
    `<page>/ui/*.tsx`; widened to every non-test `.tsx` under `app/(admin)` (`b3bf04b`), RED-proven. §7.233's family.
    Before a refactor unit, `git grep -n 'page\.tsx' -- '*.test.ts*'` for any other. (2026-09-18.)

249. **Anything held in a component that renders BELOW a page's loading switch is destroyed on every reload, not
    just the first load.** Where `load()` flips `loading` on RELOAD (`makeups`, `trials`, `levels`,
    `assessment/[classId]`), `if (loading) return …` unmounts the child: keep `useTableSort` in the `domain/` hook,
    not a `ui/` table; `AssessmentGrid`'s "moved up to" flash never shows (BACKLOG). Before moving state into a
    child, check whether its parent unmounts it on reload. (Admin L-D, 2026-09-18.)

250. **A sole-importer `lib/` PAIR must move in ONE commit — moving half of it makes `lib/` import a route folder,
    and nothing stops it.** (`lib/adminAttendanceSave.ts` + `lib/adminAttendanceSaveDeps.ts`.) `tsc` forces the
    import and the fence never scans `lib/`. When the sole-importer grep (playbook §2) names a `lib/` sibling, move
    both together (Deps half into `dao/`). Assert every stage:
    `git grep -nE "from ['\"](@/app/|.*\(admin\)/)" -- 'SwimSyncAdmin/lib/*.ts'` → 0. (Lesson detail, 2026-09-18.)

251. **A hand-check that reports a product failure is wrong about as often as the product is — verify the
    CHECK before you believe it, and make its fixture writes THROW.** Both Admin L-E "failures" were the check:
    **service-role** counts span every tenant (scope by the page's `tenant_id`), and a fixture error never read
    (`is_active = false` without `deactivated_at`). `if (error) throw` on every fixture write, so a refused write can
    never be read as a product one. Shape: `docs/refactor/batch-e-handchecks.mjs`. (Admin L-E, 2026-09-21.)

252. **↪ Folded into §7.58 (2026-09-25)** — a repeat of that lesson; its unique detail now lives there.

253. **`CI=1 npx expo start` serves a FROZEN bundle — Metro does not watch files in CI mode — so every local
    driver run after an edit tests the code as it was at startup, and passes.** Found when a temp log never printed
    (§8.115). **Start Expo WITHOUT `CI=1`:** `npx expo start --web --port 8081 < /dev/null`. **Prove the bundle is
    current:** `curl` `/node_modules/expo-router/entry.bundle?platform=web&dev=true&…` and grep for a string only
    the new code has (§7.31). (Coach attendance, 2026-09-22.)
    A throwaway edit that appears and disappears within seconds proves the watcher.

254. **A coach's full-page load of ANY coach URL ends on Schedule, with the requested screen mounted HIDDEN
    beneath it — the root of §7.252.** `routeForSession` (`app/_layout.tsx`) replaced to `landingFor(…)`:
    `el.click()` works, but `page.url()` reads `/schedule`, `innerText` is empty (use `textContent`), and anything
    VISUAL is Schedule — reach the screen by an in-app tap. (2026-09-22.)
    **Product half FIXED 2026-09-24:** `isInsideLanding` (`lib/landing.ts`) skips the replace inside the user's own
    area; `/login`, `/` and the other role's screens still redirect. The tap advice is now caution only.

255. **A new table the ENGINE writes needs an explicit `GRANT … TO service_role` — its default privileges on new
    tables were revoked in `20260814000300`, and `table_grants.test.sql` deliberately does not cover service_role.**
    With a never-throwing log write it is a silent no-op everywhere. Grant in the migration, pin with
    `has_table_privilege('service_role', …, 'INSERT')`, make the Deno test read the row BACK, check the remote
    grant dump. (2026-09-22; `billing_runs.test.sql`, `runLog.test.ts`.)

256. **Any FK onto `profiles(id)` must be `ON DELETE SET NULL` (or `CASCADE`) — a plain FK makes that admin
    undeletable.** `delete-admin` relies on the `auth.users → profiles` cascade; the schema does not enforce it.
    `billing_runs.ran_by` is SET NULL, pinned by a pgTAP delete. (2026-09-22.)

257. **The billing engine's early returns are REFUSALS TO ATTEMPT, not attempts** — `before_run_day`,
    `auto_disabled`, `tenant_suspended`, `month_not_ended`, `already_complete`. Run logs / metrics / "last run" must
    skip them (daily cron would bury real runs). One list: `NON_ATTEMPT_STATUSES` in `generate-invoices/runLog.ts`
    — new early-return statuses join it. (2026-09-22.)

258. **A table with an FK onto `tenants` breaks the Deno suite's teardown unless the FK cascades.** The
    service_role tenant delete fails, the tenant LEAKS, and the second `test.sh` pass runs on leaked state (§7.15).
    Append-only tables have no DELETE grant — use `ON DELETE CASCADE`, as `billing_runs.tenant_id`. (2026-09-22.)

259. **`billing_periods.invoices_issued` counts only the invoices the SEALING run created — not the month's
    total.** (Aug 2026 sealed on prod with 0 beside 9.) Never display it as "N invoices for the month"; count
    `invoices`. (2026-09-22.)

260. **`advance_cancel_lesson.test.sql` #21 fails when CI starts between 00:00 and 00:01 SGT.** (CI
    `35751015146`.) **FIXED 2026-09-25:** expectation now derives from `now()`; a red on #21 is always real. **Rule:**
    a pgTAP check whose answer depends on the time of day must compute its expectation from `now()`, not hardcode
    the answer for "most of the day".

261. **On the Expo WEB build, moving or deleting ANY imported file while a UI driver runs breaks EVERY screen, not
    just yours.** (A mid-run `git mv lib/referralShare.ts` overlaid the error screen; drivers died at login.)
    **Never move, delete or break-import any imported module while a driver runs** ("never edit the page" is too
    narrow). Not-yet-imported files are
    safe; hold them OUT of the tree until their commit. (2026-09-23; playbook §4.)

262. **The nightly's "tenant-suspension flake" is its FIRST parent-login control, not the admin checks.**
    `appLoginDies()` (`verify-tenant-suspension.mjs:58`) returned `null` when the form never appeared, read as FAIL
    (nightly `35753594101`) — §7.108's shape. **Triage:** one red on those two controls is a re-run; a red on the POST-suspend parent checks is never a flake
    (§7.263). (2026-09-23.) **Hardened 2026-09-24:** `appLoginDies(page, email)` in `drivers/lib.mjs` waits 45 s,
    ONE press; a form that never appears prints `CANNOT SAY — the login form never appeared` via
    `loginVerdictDetail()`. A red WITHOUT that text is a real verdict.

263. **`loginExpo` HIDES a broken post-login redirect — ~25 drivers pass through a login regression.** Its retries
    (`lib.mjs:40-72`) restore the session via `routeForSession`. **After touching `app/(auth)/login.tsx` or
    `features/login/`, prove it with a ONE-SHOT login** (fresh context, one press, no reload; URL leaves `/login` within 10 s) — `verify-app-auth.mjs`
    check 1, from `docs/refactor/app-fgh-handchecks-fence.mjs`. (2026-09-23.)
    - **Red once (2026-09-25, nightly `36071084202`):** parent check 1 sat 10019 ms on `/login`, no error on screen; coach
      168 ms, the parent's later logins fine; local re-run 191 ms, 25/25 — accepted as a cold-load flake by the user. The
      first nightly carrying `75aaa82` (the `isInsideLanding` redirect change). **A second check-1 red is a real verdict.**

264. **The `public-invoice` / `public-package` Edge Functions allow ONLY `content-type` — an added header breaks
    the page silently.** (`index.ts:27`.) A failed preflight renders "Invoice/Package not found", so
    `verify-smoke-app` stays green. Keep the bare `fetch`, `content-type` only, `FUNCTIONS_URL` as literal
    `process.env.EXPO_PUBLIC_SUPABASE_URL`, QR build inside the `try`. Local runtime answers preflight itself —
    `verify-app-money`'s header-NAME check is the only guard. (2026-09-23.)
    **Probed against prod 2026-09-26, both functions:** a preflight asking for `x-client-info` (or, on `public-package`,
    `authorization, apikey`) gets `Allow-Headers: content-type` back, so a browser refuses the request. The local gateway
    answers the same preflight with `Allow-Origin: *` and echoes every requested header, so a local run cannot fail this
    way. Re-probe only if `corsHeaders` changes.

265. **Moving a setting from a global row to a per-tenant row, a read that swallows its `error` becomes a hidden
    DEFAULT — and on a billing schedule a default is an early bill that then seals the month.** Auto mode now
    FAILS CLOSED (`tenant_unreadable`, `generate-invoices/core.ts`); it RETURNS, never throws — one throw stops every
    business's billing. (2026-09-24; `docs/plans/ENGINE_TENANT_RUN_DAY_PLAN.md`.)

266. **A new engine early-return status has TWO registries, and the second one sends email.**
    `NON_ATTEMPT_STATUSES` (`runLog.ts`) and `shouldRetryTenantEmails` (`email.ts`, defaults to resend). Adding a
    status → decide it in both, with a test in `email.test.ts`. (2026-09-24.)
    `shouldRetryTenantEmails` runs on EVERY per-tenant status, defaulting to *yes* — an unreadable tenant may be suspended, so a new status must opt out explicitly.

267. **On the coach Schedule, NEEDS MARKING repeats DONE's text — scope any DONE-section press to after the
    "DONE" heading.** Use `pressAfterDone()` (`verify-cancel-lesson.mjs`, `compareDocumentPosition`, returns the
    COUNT; §7.101 — never a bare `.last()`/`nth`). (2026-09-24.)

268. **Auth links cannot be driven from an Expo on a non-default port.** Only `localhost:8081` is in
    `additional_redirect_urls`; GoTrue silently swaps an unlisted `redirect_to` for `site_url` (§7.41). `verify-app-auth.mjs` needs **exactly :8081** (`docs/WORKTREES.md`).
    (2026-09-24.)

269. **Mailpit is shared by every session on the stack — never `DELETE /api/v1/messages`.** Filter by recipient
    AND `Created` after your send, as `verify-app-auth.mjs` does. (2026-09-24.)

270. **Every early-return branch of a screen's load hook must set what the route's render guard checks.**
    `useAttendanceLoad`'s cancelled branch skipped `resolved`, so its notice never rendered (since §8.81). In
    `load()`, pass `cls.title`, not state `classTitle`. Test:
    `features/mark-attendance/domain/useAttendanceLoad.test.ts`. (2026-09-24.)

271. **Vercel deploys EVERY commit of a multi-commit push, so a bundle-grep "before" control can already be
    after.** (`c4f8173`; §7.31, §7.51.) Grep for a string only the LAST commit adds, confirm the old source never
    held it (`git grep <old-sha>`), read `gh api repos/…/commits/<sha>/status`. (2026-09-25.)

272. **A driver fixture left loaded breaks `supabase test db`.** `fixtures-packages.sql` and `makeup_bookings.test.sql`
    share student `c5000000-…01` → §7.116, on a file never touched. Tear down every fixture you loaded (its
    `-teardown.sql`) before `supabase test db`. (2026-09-25.)

273. **To simulate a slow cold hydrate in a driver, never rewrite the Expo bundle, and don't delay it with
    `page.route` alone.** `domcontentloaded` absorbs it, so the helper never sees it; `setTimeout`-wrapping
    **crashes Metro** — restart Expo after. Admin races: slow `_rsc`. (2026-09-24.)
    The `setTimeout` wrap makes Expo's HMR register a bogus `./login` entry and Metro dies with `UnableToResolveError` — every later driver fails. Use it once for a proof, then restart Expo.

274. **`router.replace` to the route ALREADY showing re-mounts it — every `useState` on the screen is wiped.** A
    recovery link mounted `/reset-password` FOUR times; `routeForSession`'s replace lands only after its `profiles`
    read, so on CI or a slow phone it cleared the typed password (nightlies `36006182210`, `36071084202`) — and the
    invite form's name + password too. Fix: `showAuthScreen()` (`app/_layout.tsx`) skips a replace to the current
    path; one mount ~30 ms in (before `PASSWORD_RECOVERY`, before the form renders) remains and is harmless. Locally the read wins the race, so a driver must HOLD it: `holdProfilesRead()` (`verify-app-auth.mjs`,
    GETs only). A refill loop in a driver HIDES this — assert the typed value survived. (2026-09-26.)

275. **NativeWind's `darkMode` must be `"class"` — under the default `"media"` the web runtime throws on EVERY page
    load.** `global.css` sets the darkMode flag after `react-native-css-interop`'s `color-scheme.js` has loaded; the
    MutationObserver that notices it calls `colorScheme.set()`, which refuses under `"media"` ("Cannot manually set
    color scheme…"). Drivers allowlisted it from 2026-09-13. Fixed `7f969cb`; `lib/darkMode.drift.test.ts` pins it.
    ⚠ Under `"class"` a `dark:` variant applies only with `<html class="dark">` — i.e. never. Adding dark mode means
    toggling that class, not just writing `dark:` classes. Prod proof: served CSS holds `--css-interop-darkMode:class dark`. (2026-09-26.)
