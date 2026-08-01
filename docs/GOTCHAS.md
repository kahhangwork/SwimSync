# SwimSync — Gotchas (§7)

_Split out of `HANDOVER.md` on 2026-07-26. Read this when you are about to touch a
subsystem, not cover-to-cover — it is a reference, not a narrative._

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
7. **`new Date().toISOString().split("T")[0]` is a bug in SGT** — it's the UTC date, a
   day behind before 08:00 local. Worse, pairing it with a **local** `getDay()` lets the
   weekday and the date disagree: the Today screen listed Saturday's classes while
   writing attendance to Friday's date, and re-marking later created a second session
   that **double-billed everyone**. Use `todayInSg()` + `dayOfWeekOf()` (§6). Pinned by
   `verify-tz-saturday.mjs`; audit with
   `grep -rn --include="*.ts" --include="*.tsx" -e "toISOString()\.split" -e "toISOString()\.slice" SwimSyncApp SwimSyncAdmin`.
   **THIS FAMILY INCLUDES TIME OF DAY, AND A SECOND INSTANCE WAS LIVE UNTIL 2026-07-26.**
   The coach's Today screen computed "is this class happening now?" as
   `now.getHours() * 60 + now.getMinutes()` — the DEVICE's clock — sitting directly beside a
   date from `todayInSg()`. Same disagreement, new axis. It only drove a cosmetic "Now"
   badge, which is why it survived; the moment a card's *status* depended on "has this class
   ended yet", a device an hour behind SGT would have shown "Upcoming" on a finished lesson
   and the coach would never have been told to mark it — the hole the Unmarked Lessons net
   exists to close (§8i). Fixed by `lib/timeOfDay.ts`, whose **shape** is the guard: only
   `nowMinutesInSg()` knows about timezones, and everything that compares times takes a
   plain `nowMinutes: number`, so it cannot read a clock and therefore cannot read the wrong
   one. **Extend the audit:**
   `grep -rn "getHours()\|getMinutes()\|getDay()" SwimSyncApp/app SwimSyncAdmin/app`
   — every hit is either a bug or needs a comment saying why not.
8. **~~The engine's completeness gate never fires on the admin path.~~ FIXED 2026-07-18
   (§8a).** For months, `SwimSyncAdmin/app/api/generate-invoices/route.ts` hardcoded
   `force: true`, which bypassed the gate, the auto switch and the month seal — so the
   admin confirm modal's gap report was the *only* thing between a forgotten lesson and an
   underbill, and it merely warned. The route no longer sends `force`, and unmarked
   attendance now **blocks** generation outright in every mode. Kept here because the
   shape of the mistake is worth remembering: **a safety gate that the only live caller
   bypasses is not a gate.** `force` still means "skip the sealed-month guard" (the
   documented reopen path) and nothing more — don't re-add it to the route to "make
   generation work"; if generation refuses, the answer is to mark the lesson.
9. **`react-native-web` gives EVERY ScrollView `flexGrow: 1`** — horizontal ones
   included (`commonStyle` in its `ScrollView/index.js`). So a horizontal ScrollView in
   a column layout **expands to fill the leftover vertical height**, and its row content
   container then stretches every child to that height (RN's default `alignItems` is
   `stretch`). The parent Attendance chips shipped as ~180px tall capsules on web while
   looking perfect on native — same "works on native, broken on web" family as §12a.
   **Any horizontal ScrollView needs both:** `className="flex-grow-0"` on the ScrollView
   *and* `items-start` on `contentContainerClassName`. Audit:
   `grep -rn --include="*.tsx" "horizontal" SwimSyncApp/app`. Pinned by
   `verify-parent-attendance.mjs`, which measures chip height from the DOM rather than
   trusting a screenshot.
10. **A screen you navigate *away* from stays mounted underneath.** The native stack
    keeps the previous screen in the DOM, so `document.body.innerText` contains both.
    This produced a **false-passing test**: an assertion for "admin will assign your
    child soon" passed against the *home* screen's identical copy while the Attendance
    screen was showing something else entirely. Assert only on strings unique to the
    target screen. (Also `run-ui-playwright` gotcha #6.)
11. **A frontend `tsc` that passes locally can fail in CI — the Next/Expo type stubs are
    git-ignored.** `SwimSyncAdmin`'s tsconfig `include`s `next-env.d.ts` + `.next/types/**`,
    and `SwimSyncApp` leans on Expo's `expo-env.d.ts` / `.expo/types` — **all git-ignored**,
    so they exist on your machine (a prior `npm run dev` / `expo start` generated them) but
    **not in a fresh CI checkout**. A local `tsc --noEmit` therefore typechecks against stubs
    CI won't have. Both apps happen to pass without them today (verified), but before trusting
    any frontend typecheck, reproduce the CI condition: hide the artifacts
    (`mv .next .next__x; mv next-env.d.ts next-env.d.ts__x`) and re-run. This is why the CI
    typecheck guard (§8d) was validated against a stubbed-out fresh checkout, not just a local
    pass.
12. **The invoice engine's DEFAULT billing month was UTC-derived** — same family as #7,
    different door. `core.ts` computed the previous month from `new Date().getMonth()`,
    which is the **UTC** month on Edge Functions. The daily cron POSTs an empty body, so it
    used this default: at the 1am SGT run (17:00 UTC the day before) it would bill a month
    early (1 Aug → June, not July). Latent because invoicing is manual (the admin always
    sends an explicit month) and cron is off. **Fixed** (§8a) — the default now derives the
    calendar date in `APP_TIMEZONE` via `generate-invoices/dates.ts`. Don't reintroduce a
    `new Date()`-field month derivation in the engine. Audit:
    `grep -rn "getMonth\|getFullYear\|new Date()" supabase/functions/generate-invoices/core.ts`.

13. **Billing must follow ATTENDANCE ROWS, not active enrolments.** `core.ts` used to build
    its billable student set from `student_class_enrolments … is_active`, so closing an
    enrolment dropped that child's *already-attended* lessons from the invoice entirely.
    Latent while nothing could unenrol — then the "Remove from class" button (§8a) made a
    silent month-sized underbill one tap away. The two questions are genuinely different:
    **active enrolments answer "who must be marked" (the completeness gate); attendance
    rows answer "who gets billed."** Don't collapse them back together. Audit:
    `grep -n "activeStudentIds" supabase/functions/generate-invoices/core.ts`.
14. **`Number(null)` is `0`, so a "missing setting" can clamp to the *most aggressive*
    value.** `clampRunDay` coerced first and clamped into 1..28, which turned an unset
    `invoice_run_day` into **day 1** — the earliest possible run, exactly what the setting
    exists to prevent. Missing/unparseable/out-of-range-low now falls back to the default;
    only too-*high* values clamp (29–31 → 28, which would otherwise never fire in
    February). When normalising config, decide separately what "absent" means and what
    "out of range" means — they are not the same answer.
15. **A test suite that seals state can pass once and fail on the second run.** Manual runs
    now seal a month (§8a), so every completing test left a `billing_periods` row and the
    *next* run short-circuited on `already_complete`. `teardown()` clears the months its
    sessions fall in. **Run the Deno suite twice** after touching the engine — once proves
    nothing about leaked state.
16. **`SET LOCAL ROLE` outside a transaction is a no-op, and psql will not stop you.** An
    RLS check written without `BEGIN`/`COMMIT` runs as `postgres`, which **bypasses RLS
    entirely** — so every case "passes", including the ones that should be denied. Wrap
    RLS probes in an explicit transaction, and make sure at least one case is expected to
    FAIL, so a silently-superuser session is visible.
17. **A guard made of "nothing went wrong" conditions fires hardest when nothing happened.**
    The month seal required no-incomplete-class AND no-deferred-parent AND no-failed-write —
    every one of which is **vacuously true on an empty run**, so a month where nobody had
    marked any attendance sealed itself and was locked out of billing (§8a.1). It reached
    production. **When a terminal/irreversible action is gated on a conjunction of negatives,
    add a positive: require that the work actually occurred** (here: at least one class
    genuinely reckoned with). Same shape as §7.14 (`Number(null)` → 0 → the most aggressive
    value): in both, an *absence* of input silently satisfied a rule written to police
    *presence* of input. Ask what your guard does on empty input, not just on bad input.
18. **The engine's completeness gate could not see a lesson nobody touched.** FIXED
    2026-07-18 (phase 0 of tenanting). `core.ts` selected `lesson_sessions` rows that
    **exist** and checked those were fully marked — but sessions are created *lazily* by
    attendance marking (PRD §7.5), so a lesson nobody touched has **no row**, and a class
    with no rows at all was `continue`d entirely. A month with four lessons where three were
    marked reported **"complete — billing month sealed"**: it billed three, sealed the month,
    and the fourth could never be billed (later runs short-circuit on `already_complete`, and
    the no-double-billing guard skips a parent who already has an invoice). A single
    forgotten lesson became a permanent, silent underbill — the exact hole §8aD was written to
    close.
    **The shape worth remembering:** the rule existed in four hand-written copies and they
    had *drifted*. The admin's `computeClassCoverage()` derived expected dates from the class
    weekday and caught this; the engine never did. So the only effective gate was the
    **client-side** one — gotcha §7.8 inverted (there, the only live caller bypassed the
    gate; here, the real gate wasn't the server's). **Two implementations of one safety rule
    is one implementation and one liability.** Now shared — see §6.
    Pinned by four Deno tests, incl. one that fails on the pre-fix engine with
    `"complete — billing month sealed"` instead of `"incomplete_attendance"`.
19. **A type union is not a code path.** Phase 2 added `tenant_admin` to the app's `Role`
    type but left login branching on `role === "coach"`. The tenancy backfill correctly made
    the real coach a `tenant_admin`, and they were met with *"Unrecognised role. Please
    contact support."* — **locked out of production.** The design had always said to route on
    **which extension rows exist**, not the enum. When you widen a type to admit a new value,
    grep for every branch that consumes it. Now one pure function (`lib/landing.ts`) used by
    both call sites.
20. **A new table does NOT inherit RLS.** `CREATE TABLE` leaves row-level security *off*,
    and a table with policies but RLS disabled reads as though the policies were never
    written — they are simply not consulted. Three tenancy tables shipped that way in
    development, leaving **every join code world-readable**. Always
    `ALTER TABLE … ENABLE ROW LEVEL SECURITY` explicitly. Audit:
    `SELECT relname FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace AND NOT relrowsecurity;`
21. **Postgres does not track function bodies as dependencies.** Dropping
    `is_superadmin()` errored on the *policies* that used it (good — that is how the storage
    policies were found) but said nothing about `close_student_enrolment()` and
    `handle_attendance_update()`, which call it in their bodies. Those would have failed at
    **runtime**, on a live coach-facing path. After removing a function or column, grep the
    function bodies too: `grep -rn "<name>" supabase/migrations/`.
22. **`Number("")` is 0 — again.** A blank wage-rate field passed a `>= 0` guard and saved a
    **$0 rate**, which is worse than no rate: the coach reads as "on payroll" and earns
    nothing. Same shape as §7.14 (`Number(null)` → day 1). Check for empty *before*
    coercing, every time.
23. **Watching one app's deploy tells you nothing about the other's.** The mobile app and
    the admin are **separate Vercel projects**. After a push, `/wages` 404'd while the app
    bundle had already changed. Compare a known-good route against a known-bad one to tell
    "not deployed yet" from "broken build", and wait on the surface you actually changed.

24. **A deleted Next.js route leaves a stale generated type behind, so the admin typecheck
    fails *after* you clean up.** A throwaway `app/logocheck/page.tsx`, added to render a
    component in isolation and then deleted, left `.next/types/app/logocheck/page.ts`
    behind — and `SwimSyncAdmin/tsconfig.json` `include`s `.next/types/**`, so
    `tsc --noEmit` failed with `TS2307: Cannot find module '…/app/logocheck/page.js'`,
    naming a file that no longer exists. Same family as §7.11 from the opposite direction:
    there the git-ignored type stubs were *missing* in CI, here a *stale* one lingered
    locally. It never reaches a commit or CI (`.next` is git-ignored) — it only breaks the
    local check, confusingly, and looks like your own change broke something. Fix:
    `rm -rf SwimSyncAdmin/.next/types/app/<route>`. Related: Next treats `_`-prefixed
    folders as **private**, so a scratch route named `_logocheck` silently 404s.

25. **A test can pass for the WRONG REASON, and a green suite hides it.** Writing the
    regression test for the repricing bug (§8), I dated the price change `2026-08-01` —
    *future* relative to the test clock. The display-sync trigger only tracks rates already
    in force, so `classes.price_per_lesson` never moved and the **pre-fix engine read the
    right number by accident**. The test passed on the very code it existed to catch. It was
    only found by deliberately reverting the fix and re-running. **Every test written for a
    known bug must be run against the unfixed code before you trust it** — "it passes" is
    not the claim being made; "it fails without the fix" is. All 26 tests added this session
    were checked that way, and five of the nine wages tests do *not* discriminate (they are
    regression guards, and that is written next to them).
26. **A guard that fires correctly can look like a broken fix.** The new
    settled-money guard in `set_class_terms()` refused my own test, because the shared wages
    fixture marks a **December 2026** payout paid while the test clock is July — so
    "reprice from today" legitimately collides with a later paid period. The instinct is to
    weaken the guard to make the test pass. **Move the test instead**: `class_terms.test.sql`
    got its own tenant. A fixture is not a reason to loosen a real rule.
27. **`git push` to `main` deploys the WEB APPS but not the database.** Obvious in the
    abstract, and I still got the order wrong this session: pushing before
    `supabase db push` shipped an admin panel calling `set_class_terms()` **before the RPC
    existed**, so class editing was broken in production until the migration landed. The
    rule from §6 is directional — **adding? migrate first. dropping? deploy the app first**
    — and it governs the *push*, not just the migration command. Nothing is atomic here.

28. **A `.select()` result is `any`, so reading a column off the WRONG JOINED TABLE
    typechecks.** The parent home query nests
    `students(… student_class_enrolments(is_active …))`, and I added `s.is_active` to the
    mapping — which resolved to nothing, because `is_active` was on the *enrolment*, not
    the student. `tsc` was clean; **every child would have rendered as "Inactive"** in
    production. Only driving the app caught it. When a column name exists on more than one
    table in a nested select, read the select's shape, not the mapping's. Audit:
    `grep -n "is_active" <the select block>` and check the nesting level.
29. **Removing a value from an enum silently changes what OTHER screens say.** Dropping
    `inactive` from `assignment_status` left departed children reading **"Unassigned"** to
    their own parents, and reappearing in the admin's **Unassigned Children** queue as if
    awaiting placement — because that is now literally their assignment status. Neither is
    a type error and neither failed a test. When you retire an enum value, find every
    screen that *rendered* it and decide what it says now, not just every branch that
    compared to it (§7.19 is the compile-time half of this; this is the runtime half).

30. **`supabase db push` APPLIES EVERY PENDING MIGRATION, and auto-confirms when it is not
    on a terminal.** It prints a `[Y/n]` listing them; run non-interactively, that is a
    yes. This is §7.27's successor and it bit *harder*, because the deploy had been
    explicitly designed in two phases and the contract migration **renumbered to sort last**
    an hour earlier specifically so it could be held back. **Renumbering is a convention the
    tool does not read.** All seven went in together, production dropped
    `students.swimming_ability` while both live bundles still selected it, and six screens
    broke. To hold one back it must not be in the directory:
    `mv supabase/migrations/<contract>.sql /tmp/hold/` → push → deploy apps → move it back
    → push again. Recovery is usually **forward** (deploy the app that stopped querying the
    column), not a rollback.
31. **An HTTP 200 does not tell you which BUNDLE is being served.** Both web apps are SPAs
    that return 200 with the old JS. After the push above, the admin's `/levels` had gone
    404→200 (§7.23's comparison, working) while `swimsync.sg` was **still serving the old
    bundle including the dropped column's query**. Grep the deployed asset for a string only
    the new build has:
    `B=$(curl -s https://swimsync.sg | grep -oE '/_expo/static/js/web/[^"]+\.js' | head -1); curl -s "https://swimsync.sg$B" | grep -c "<new-string>"`

32. **A CLAMP THAT MAKES A CHECK FAIR CAN ALSO MAKE IT VACUOUS.** The completeness gate
    clamps its window to today (`windowTo = todayDate < monthEnd ? todayDate : monthEnd`) so a
    lesson that has not happened yet is not reported as a gap. Entirely correct in itself —
    and it meant a run on an **in-progress** month saw only the lessons so far, judged the
    month **COMPLETE**, billed them, and **sealed** it. Every remaining lesson of that month
    was then permanently unbillable (later runs short-circuit on the seal; the
    `already_exists` guard skips the parent even if it is reopened). Nothing validated that
    the billing month had **ended** — the engine checked only the `YYYY-MM` *format*, and the
    admin's picker defaulted to the current month with no `max`. Fixed 2026-07-19: the engine
    refuses `billingMonth > previousBillingMonth(now)` before anything can seal, and `force`
    cannot reach it. **The shape worth remembering:** when a rule is relaxed to be fair to
    incomplete input, ask what it now says about input that is *entirely* incomplete. Same
    family as §7.17 (a conjunction of negatives is satisfied hardest by an empty run) — there
    the guard was vacuously *true*, here the window was vacuously *small*.
33. **A test suite that reads the real clock changes meaning as the calendar advances.** The
    engine suite hardcoded billing months (`2026-07`, `2027-11`, `2028-02`) and mostly did not
    say what "now" was, so months sat in the *future* of the test clock — where
    `expectedLessonDates` returns nothing and the completeness gate passes by having nothing
    to check. Tests were partly inert and nobody could tell, because the suite was green.
    Correcting the clock made the gate engage for the first time and immediately exposed two
    fixtures that had never actually been complete. Fixed by making the clock part of the
    fixture (`monthEnded()` in `test-helpers.ts`), with `newScenario()` **throwing** on a
    scenario that expects zero lessons. **Never date a test's fixture relative to the wall
    clock**, and prefer a helper that cannot construct the vacuous case over a comment asking
    the next person to check for it.
34. **An absolutely-positioned element with NO `left`/`top` is placed at its STATIC position,
    which is not necessarily the corner.** The auto-generation toggle's knob was
    `absolute top-0.5` with no `left`, plus `translate-x-5` for the "on" state. A `<button>`
    **centres its content**, so the knob's static x was already ~22px into a 44px track and
    the transform pushed it to 42px — **18px outside the track**. Both states were wrong (off
    sat flush against the *right* edge), which is why the reported symptom was "a blue pill
    with no knob". Always anchor a transform-driven knob (`left-0`) so the offset is measured
    from a known origin. Found by **measuring rects from the DOM**, not by looking at a
    screenshot — `verify-invoice-controls.mjs`, same technique as §7.9. **Run a driver against
    the unfixed code first**: the 14/21 baseline is what located the cause, and without it the
    fix would have been a guess that happened to work.
35. **`CREATE FUNCTION` GRANTS `EXECUTE` TO `PUBLIC` BY DEFAULT — including `anon`.** A
    `SECURITY DEFINER` function runs as its owner and **bypasses RLS entirely**, so its own
    body is the whole boundary; there is no policy behind it to catch a mistake. Combined
    with the default grant, forgetting either layer exposes it to unauthenticated callers.
    Always **`REVOKE ALL … FROM PUBLIC`** *and* gate the body. And test the gate against
    **every caller shape that can reach it** — for `platform_tenant_overview()` that is anon,
    a parent, a coach *and* a tenant admin, not "a non-admin": three of those four arrive
    through ordinary sessions, and a test that tries only one proves almost nothing. Audit:
    `grep -n "SECURITY DEFINER" -A 12 supabase/migrations/*.sql` and check each has both.
    **AND THAT IS STILL NOT ENOUGH IN PRODUCTION — see §7.39.**
36. **A shared table component that does not emit its own `<tr>` splits the convention, and
    the losing half is INVALID HTML.** `<th>` cannot be a child of `<thead>`; React reports
    it as a **hydration error at runtime**. `Thead` left the row to callers, so nine call
    sites wrapped their `<Th>`s and three did not — `/wages`, `/levels` and `/platform` were
    throwing hydration errors **in production** and nobody had noticed, because the page
    still renders. Fixed by making `Thead` own the `<tr>`, which makes the broken form
    unrepresentable rather than something each caller must remember. **When a shared
    component leaves part of a required structure to its callers, the callers will diverge** —
    put the required part inside. Audit: watch the Next dev overlay's issue count, and check
    the browser console on a page you have touched; a hydration error is silent otherwise.
37. **A STORED COLUMN THAT NOTHING MAINTAINS IS NOT A FACT — don't display it, derive it.**
    Two of these shipped together on the new Platform page and the user caught both within a
    minute of seeing their own row:
    - `tenants.kind` reads `'private'` because that is its **DEFAULT** and the tenancy
      backfill hardcoded it. No screen, RPC or admin control has ever set it. Displaying it
      as "Type" would have said *private* for a genuine swim school and nobody would have
      questioned it, because it looks like data.
    - The "no rate" warning fired on a **private coach**, whose absent rate is the state
      PRD §7.13 calls **correct** — their income is their parents' invoices. A warning about
      a correct state is noise that never goes away.
    Both are now derived from *is this coach also the tenant's admin* — a fact something
    actually maintains. **Before putting a column on a screen, find its writer.** If nothing
    writes it, either derive the answer or don't show it; a reserved-for-later field rendered
    as truth is worse than an empty column, because an empty column prompts a question.
    Audit: `grep -rn "<column>" supabase/migrations/ | grep -i "update\|insert\|set "` — no
    hits beyond the DDL means nothing maintains it.

38. **A `SECURITY DEFINER` trigger cannot see who the client is — `current_user` inside it
    is `postgres`, so every current_user-seam check waves everyone through.** The package
    lifecycle trigger shipped its first draft as DEFINER (to read products "safely") and a
    parent's request could insert itself as `active` — caught because pgTAP tests the
    parent role path. `pin_student_tenant()` works precisely because it is NOT definer:
    client DML arrives as `authenticated`, definer functions as `postgres`, the engine as
    `service_role`, and a plain trigger sees those differences. If a trigger needs both the
    seam and privileged reads, it is two functions, not one flag. Audit:
    `grep -B3 "current_user" supabase/migrations/*.sql | grep -i "definer"` — any hit is
    this bug.

39. **`REVOKE ALL … FROM PUBLIC` DOES NOT REMOVE ROLE GRANTS, AND THE LOCAL STACK WILL NOT
    SHOW YOU THE DIFFERENCE.** `provision_tenant()` shipped with the §7.35 recipe —
    `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO authenticated;` — and local `pg_proc`
    confirmed it: `{postgres, authenticated}`. A `supabase db dump` of the **remote**, taken
    straight after `db push`, showed `GRANT ALL … TO "anon"`, `"authenticated"` *and*
    `"service_role"`. Two causes, both permanent:
    - **`PUBLIC` is its own grantee, not an umbrella** over `anon`/`authenticated`/
      `service_role`. Revoking it leaves every role-specific grant untouched.
    - **Supabase *cloud* carries project-level `ALTER DEFAULT PRIVILEGES` granting EXECUTE
      on new `public` functions to all three roles.** This repo's `20260309000800_grants.sql`
      sets default privileges for **TABLES and SEQUENCES only** — the function grants are the
      platform's, and **the local stack does not reproduce them.**
    So a grant verified with `pg_proc` locally can be wrong in production, and a pgTAP
    assertion on it is **vacuous by construction** — it passes locally for the wrong reason.
    **The only honest check is a dump of the remote after pushing**, which is now a step in
    every deploy. Write `REVOKE ALL … FROM anon, service_role` explicitly, next to the
    PUBLIC revoke. Nothing was exposed here (both roles have `auth.uid() = NULL`, so the
    body gate refused them) — but the second layer was absent while a comment claimed it
    held. **Still outstanding:** `regenerate_join_code()` and `close_student_enrolment()`
    have the same grants; backlogged, not swept mid-deploy. Audit:
    `supabase db dump --file /tmp/p.sql && grep -E '(GRANT|REVOKE).*ON FUNCTION' /tmp/p.sql | grep '"anon"'`.

40. **GET A FUNCTION'S CURRENT DEFINITION FROM THE DATABASE, NOT FROM THE MIGRATION FILE YOU
    FOUND FIRST.** Extending `platform_tenant_overview()` meant copying its body verbatim —
    so I copied it from `20260719002300_platform_tenant_overview.sql`, the file whose name
    matches. But `20260719002400` had already redefined it: `kind` → a derived `shape`,
    `coaches_without_rate` → `staff_without_rate`. The new migration silently **reverted
    both**, and the verbatim-diff check I wrote to prevent exactly this passed — **because it
    diffed against the same wrong file.** It was caught only by dumping the live definition.
    A function redefined N times has N files and only the last one is true; the filename tells
    you when it was written, not whether it is current. Same family as the package trigger's
    "start from `grep -ln … | tail -1`", except `tail -1` is *also* only a heuristic — the
    database is the fact:
    `SELECT pg_get_functiondef('public.<fn>()'::regprocedure);`
    Then diff your new body against **that**, not against a file.

41. **AN UNLISTED AUTH REDIRECT IS NOT REJECTED — IT IS SILENTLY REPLACED WITH `site_url`.**
    The first invite generated came back with `redirect_to=http://127.0.0.1:3000` instead of
    the `/accept-invite` we asked for, because that URL was not in
    `[auth].additional_redirect_urls`. Nothing errored: the email sends, the link works, the
    token is valid — the user just lands on the wrong page, which for a first-time invite is
    the admin root instead of the form that sets their password. **If an auth email lands
    somewhere unexpected, suspect the allow-list before the code.** Note it is an **exact**
    match, so `localhost:3000` and `127.0.0.1:3000` are different entries. Remember it is
    read only at **boot** (§4): `supabase stop && supabase start`.
    - **⚠ THE SUSPICION WAS CORRECT, AND IT WAS LIVE FOR WEEKS.** This entry used to say the
      admin panel's `/reset-password` was unlisted and so the forgot-password flow was
      "**likely** landing wrong in production too". On **2026-07-27** it was checked:
      `https://admin.swimsync.sg/reset-password` was **missing from the production
      dashboard's allow-list**, so every admin password reset had been silently landing on
      the wrong page. Added, then reset was tested end to end on **both**
      `https://swimsync.sg` and `https://admin.swimsync.sg` — both work. The parent app's
      `https://swimsync.sg/reset-password` was also missing from `config.toml` and has been
      added.
    - **PRODUCTION AND `config.toml` ARE TWO SEPARATE LISTS AND NOTHING KEEPS THEM IN STEP.**
      Production's copy lives in the **Supabase dashboard**; no migration touches it, no
      test reads it, and `supabase db push` does not carry it. That asymmetry is why the
      two drifted apart unnoticed for weeks, and it is the durable lesson here:
      **fixing the file does not fix production, and fixing production does not fix the
      file — do both, every time.** Audit production by hand:
      `grep -rn "redirectTo\|resetRedirectTo" SwimSyncAdmin/app SwimSyncApp/app` lists every
      URL an auth email can ask for; each one must appear in the dashboard list *and* here.

42. **A `SECURITY DEFINER` WRITER IS EXEMPT FROM `pin_student_tenant()` — AND FROM EVERY
    TRIGGER THAT USES THE `current_user` SEAM.** §6 records that the tenant boundary on
    `students` is a trigger rather than a policy, and that the seam is `current_user`
    "so any new SECURITY DEFINER writer inherits the exemption automatically". That
    sentence reads like a convenience. It is also a **hole**: such a function can write a
    student into *any* tenant and nothing downstream will stop it.
    **So every SECURITY DEFINER function that writes a tenanted row must derive
    `tenant_id` itself — from the class, the student, the invoice — and must NOT accept it
    as a parameter.** `add_unclaimed_student()` and `link_invited_parent()`
    (`20260725000200`/`000300`) both do; copy that shape.
    Confirmed empirically rather than reasoned: inside a `postgres`-owned SECURITY DEFINER
    function, `auth.uid()` is the **caller** while `current_user` is **`postgres`**. Both
    halves matter — the first is what lets `created_by = auth.uid()` record the real coach,
    the second is what disables the pin.

43. **~~`lesson_sessions` HAS A SECOND WRITER NOW.~~ RETIRED 2026-07-25.** It briefly
    did — `add_unclaimed_student()`'s trial mode created one — and that is why this
    gotcha existed. Trials became BOOKINGS (§8.11), which write no session at all, so
    the attendance save is once again **the only writer in the codebase**, as §6 says.
    The underlying rule still stands and is why the change was safe: a duplicate
    `(class_id, session_date)` row double-bills a whole class (§7.7), so any future
    second writer needs `ON CONFLICT … DO NOTHING` and a date **parameter**, never
    `now()`.

44. **`supabase db reset` LEAVES KONG POINTING AT A DEAD AUTH CONTAINER.** The reset
    recreates `supabase_auth_*` but not `supabase_kong_*`, which holds the old upstream —
    so **every** call through `/auth/v1` returns **502** while `docker ps` shows both
    containers "Up (healthy)". In the Deno suite this surfaces as
    `createUser(coach) failed: {}` — an **empty error object** — on all 91 tests at once,
    which reads like a catastrophic code regression and is not one.
    **Fix: `docker restart supabase_kong_SwimSync` after any `db reset`.** Cost most of an
    hour before it was diagnosed by curling the auth endpoint directly.
    A second-order effect worth knowing: because `newScenario()` throws *after* inserting
    its tenant, every failed run leaks one. 91 tests × a few runs left **177 orphan
    tenants**, and `SWIM-` + 4 hex is only 65k codes — so the next run started failing on
    `tenants_join_code_key` duplicates, a completely unrelated-looking symptom.


45. **`classes.category_id` IS MUTABLE, AND MONEY NOW DEPENDS ON IT.** Every other input
    to a price in this schema is effective-dated — `class_rates`, `coach_rates`,
    `trial_rates`. A class's **category** is a plain column anyone can change. Since a
    trial is priced through it, re-tagging a class would silently re-value every unbilled
    trial in it across the five-week gap between a lesson and its invoice run — §7.7's bug
    through a new door, and exactly what §6 forbids: *a fact about a past lesson is never
    a live lookup.*
    **So anything that prices by category must SNAPSHOT it at the moment of sale.**
    `trial_bookings.category_id` is that snapshot, and the engine is prohibited from
    joining `classes` to price a trial. The same trap waits for any future feature that
    prices by category.

46. **THE LIST OF WHAT CASCADES FROM A TABLE IS NOT STATIC, AND A STALE COPY OF IT IS A
    DATA-LOSS BUG.** `BACKLOG.md` asserted for weeks that *"of five FKs into `students`,
    only `parent_students` cascades … so a mis-aimed merge cannot destroy anything"*, and
    the merge design rested on that sentence. It was **already false when it was written**:
    `student_settlements` (`20260725000100`) and `trial_bookings` (`20260725000700`) had
    been added **in the same session**, both `ON DELETE CASCADE`. `student_claims` then
    made a fourth in the very migration series that corrected the documentation. So the
    count went five/one → eight/four while a document confidently stated otherwise.
    **A comment cannot be the mitigation, because the person who adds the next cascading FK
    will not read it.** Any function that DELETEs a tenanted row must ask the catalogue and
    refuse on anything it has not been taught to move:
    ```sql
    SELECT string_agg(conrelid::regclass::text, ', ') FROM pg_constraint
     WHERE confrelid = 'students'::regclass AND contype='f' AND confdeltype='c'
       AND conrelid::regclass::text NOT IN (<the ones it handles>);
    ```
    `merge_students()` does this and `student_merge.test.sql` proves it by **creating a
    cascading FK at runtime** and asserting the merge refuses. Audit:
    `SELECT conrelid::regclass, confdeltype FROM pg_constraint WHERE confrelid='<t>'::regclass AND contype='f';`

47. **A BUSINESS'S OWN ADMIN CANNOT UNLINK A PARENT FROM A CHILD — SO ANY FEATURE THAT
    CREATES A FAMILY LINK MUST SHIP ITS OWN REVERSAL.** `parent_students_delete` is
    `USING (parent_id = current_parent_id() OR is_platform_admin())`: the **parent** can
    unlink and the **platform** admin can, but the tenant admin — the person clicking the
    button that creates the link — cannot. Found while reviewing the claim-approval flow,
    where it would have made a mis-approval permanent and fixable only by SQL against
    production. `undo_student_claim()` (`20260726000400`) is that reversal, and it ships in
    the **same migration** as approve for exactly this reason.
    **Do NOT "fix" this by widening `parent_students_delete` to tenant admins** — that
    grants a blanket delete over every family link in the business to close a one-row
    problem, and RLS is row-level, so there is no way to say "only the link you just made".

48. **A PARENT WHO HAS JOINED BY CODE BUT HAS NO CHILD YET IS INVISIBLE TO THE BUSINESS'S
    ADMIN.** `profiles_select` reaches a parent through
    `EXISTS (… tenant_serves_parent(p.id))`, and that helper goes via **the parent's
    children's enrolments**. A parent who has redeemed the join code and added nothing is
    served by nobody, so the admin cannot read their name, email or phone.
    This bit the claim queue — the one screen whose entire job is *"who is asking?"* — which
    showed an em dash for every requester while every RPC underneath was correct. **A join
    that works under `service_role` in a REST probe can return NULL under the caller's own
    RLS; test the read path as the actual role.** Only the UI driver caught it. The fix is a
    narrow `SECURITY DEFINER` reader (`list_student_claims()`), not a sixth branch on the
    most load-bearing policy in the schema.
    **IT HAPPENED TWICE MORE THE NEXT DAY, and the shape is worth memorising: A POLICY GAP
    IS INDISTINGUISHABLE FROM A FEATURE NOBODY WROTE.** The parent's "your trial is on
    Saturday" card read the right table, rendered the right component, and showed the old
    text — because `trial_bookings_select` had no parent branch at all
    (`current_tenant_id()` is NULL for a parent; they are not a coach). Fixed, it then
    rendered "their class", because `classes_select` asks `parent_has_child_in_class()`,
    which only knew about ENROLMENTS and a trial is a booking. Two policies, one feature,
    each failing silently and neither raising anything.
    **So: when a new screen reads a table its audience has never read before, probe the
    policy AS THAT ROLE before writing the UI** —
    `SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claims" TO '{"sub":"<id>"}'; SELECT count(*) FROM <table>;`
    A count of 0 there is the whole bug, and it takes ten seconds.

49. **NUMBER A CONTRACT MIGRATION *LAST*, OR STAGING THE DEPLOY LEAVES IT OUT OF ORDER.**
    `supabase db push` applies **everything** pending — there is no "up to migration X"
    flag — so an expand/contract deploy is staged by physically **moving the contract file
    out of `supabase/migrations/`**, pushing, then moving it back. That works, but if the
    held-back file has an **earlier** timestamp than something you did push, the CLI then
    refuses it as *"local migration files to be inserted before the last migration on
    remote"* and demands `--include-all`.
    That happened here: `20260726000600` (the contract) was held while `20260726000700`
    (an additive function) went out. `--include-all` is correct and safe when the two are
    independent — verify with `--dry-run` that it would push **only** the intended file —
    but the cleaner fix is upstream: **give the contract migration the highest timestamp
    in the batch**, so holding it back never creates a gap. Expand/contract is now the
    normal shape for this codebase (§6), so this will recur.

50. **`audit_log.actor_id` STOPS YOU DELETING A PROFILE, AND CANNOT BE CASCADED OR
    BLANKED.** It is `NOT NULL` and `NO ACTION` against `profiles`, so any account that
    has ever *done* something — filed a claim, added a child, marked attendance — cannot
    be deleted until its audit rows go first. Hit while writing the production
    test-data cleanup: five throwaway accounts had authored six rows between them, and the
    delete failed with a bare FK error naming a UUID.
    Delete audit rows **authored by** the doomed accounts only. Rows written by someone
    else *about* a deleted entity are fine and should be kept — `entity_id` has no foreign
    key, so they dangle harmlessly and they are the business's own record.
    This also means **an account can never be fully deleted without losing part of the
    audit trail** — a real tension worth knowing before promising anyone a clean deletion.
    Audit:
    `SELECT count(*) FROM audit_log al JOIN profiles p ON p.id = al.actor_id WHERE p.email = '<addr>';`

51. **A MINIFIED BUNDLE ONLY PROVES WHAT USER-VISIBLE STRINGS SURVIVE — GREPPING FOR AN
    IDENTIFIER OR A SPLIT LITERAL PROVES NOTHING.** Verifying a Vercel deploy by fetching
    `/_expo/static/js/web/entry-*.js` and grepping is genuinely necessary (§7.23's
    app-lags-admin problem needs it), but it lies in two directions:
    - **Identifiers are renamed.** `upcomingTrials` and `awaitingTrial` both return 0 in a
      live bundle that contains the feature.
    - **JSX splits literals.** `Trial{n === 1 ? "" : "s"} coming up` never appears as
      `"Trials coming up"` anywhere — only `" coming up"` does.
    Both read as "the deploy failed", and the second nearly sent this session chasing a
    problem that did not exist. **Grep only for a contiguous user-visible string you can
    see verbatim in the source**, and sanity-check with one you know was already live.
52. **A NEW EMBED ON A PAGE'S PRIMARY LIST QUERY PUTS THE WHOLE PAGE AT RISK — ADD A
    SECOND QUERY INSTEAD.** PostgREST returns `null` for the **entire** select when one
    embed fails — a policy gap, an ambiguous relationship, a typo in the nesting. So
    bolting a nice-to-have join onto the query that renders the table means a failure
    **blanks the table** rather than degrading the extra. Fetch supplementary data in its
    own query, defaulted to empty, and let the page render without it.
    - Hit while adding the Classes page's "See students" drawer (2026-07-26): the first draft
      extended `loadClasses()`'s select with `enrolments → students → tenant_levels`, which
      would have put every class on `/classes` behind a three-level embed resolving. It is
      now a separate `loadRoster()`, **verified by breaking the roster query on purpose**
      and confirming the class table still rendered while the drawer said why it could not.
    - The corollary is a UI rule: a supplementary read that fails must say so. An empty
      list where the fetch errored is indistinguishable from a class with nobody in it.
53. **`ON CONFLICT DO NOTHING` DOES NOT MAKE A FIXTURE IDEMPOTENT WHEN THE ONLY UNIQUE
    INDEX IS PARTIAL.** Two of this schema's uniqueness rules are deliberately partial —
    `one_active_enrolment_per_student` (`WHERE is_active`) and
    `trial_bookings_live_slot_uniq` (`WHERE cancelled_at IS NULL`) — precisely so that
    closed enrolments and cancelled bookings may repeat. A fixture row that is *inactive*
    or *cancelled* therefore conflicts with nothing and **re-inserts on every run**, which
    is exactly the negative-control row a test is relying on being singular. Use an
    explicit `WHERE NOT EXISTS` keyed on what "already seeded" means. Caught by running
    the fixture twice and diffing the row counts — do that for any new fixture.
54. **WHEN A SHARED COMPONENT STARTS EMITTING AN ELEMENT ITS CALLERS USED TO EMIT, THE
    SWEEP IS NOT THE FIX — A TEST IS.** `42803db` made `Thead` own its `<tr>`, swept the
    call sites, **missed `levels/page.tsx`**, and left a docblock asserting the broken
    form was now "unrepresentable". It was not: that page kept its `<Tr>`, rendered
    `<tr>` inside `<tr>`, collapsed all five headers into one cell in column 1, and
    shipped a visibly broken table to production **for a week**. Prose in a component
    cannot enforce a call-site contract. If a shared primitive takes over an element,
    land a scan test over the call sites *in the same commit* —
    `SwimSyncAdmin/components/Table.test.tsx` is the one for this contract, and it walks
    every `app/(admin)/**/page.tsx` so a page that does not exist yet is already covered.
    - **Every text assertion passes on a table whose columns are misaligned.** The
      labels were all present, correctly spelled and in the right order — just in the
      wrong place. That is why nothing caught it and why a human looking at the page is
      what eventually did. Geometry must be **measured**, not read: §7.34 again, now
      twice over. `verify-levels-table.mjs` compares each `th`'s rect against its
      column's `td`.
    - **React's own `validateDOMNesting` warning is NOT a usable signal here — tested.**
      Run against the known-broken page React logged **nothing**, so a check on it went
      green on a page that was plainly wrong. Count `thead tr tr` off the DOM instead.
      A check that passes on known-broken code is worse than no check.
    - **A driver that has never been seen to fail proves nothing.** Both new checks were
      run against the unfixed tree first: the scan test failed naming the file, and the
      geometry check failed with a worst offset of **488px** (fixed: **0px**). Those two
      numbers are what set the 2px tolerance — calibrate it, never guess it.
55. **GIT WORKTREES SPLIT THE CODE AND SHARE THE DATABASE — SO MIGRATIONS LAND ON `main`,
    ALONE, ONE AT A TIME.** Every worktree's `supabase/config.toml` says
    `project_id = "SwimSync"`, and the CLI names its containers from that — so N checkouts
    address **one** `supabase_db_SwimSync`. Git isolates your files; nothing isolates the
    schema. Two consequences, and the second is the one that reaches production:
    - **`supabase db reset` rebuilds the shared DB from whichever worktree ran it.** A
      migration living only on a feature branch ceases to exist in the running database
      the moment anyone else resets — the file is still there, the code still looks right,
      and nothing points at the cause. **Observed live 2026-07-26**: the shared DB held
      **75** applied migrations while `main` had **74 files**, the extra one existing only
      as an *untracked* file in one worktree.
    - **Parallel migrations apply in FILENAME order locally and in MERGE order on
      production.** Branch A writes `…000100`, branch B writes `…000200`, B merges first:
      production runs `b → a`, every local `db reset` ran `a → b`. Where both touch the
      same object the end states differ silently — and most migrations here are
      `CREATE OR REPLACE FUNCTION` or `DROP POLICY; CREATE POLICY`, i.e. last-writer-wins.
      The attendance trigger is on its seventh redefinition.
56. **A FRESH WORKTREE HAS NO `.env` FILES, AND THE FAILURE LOOKS LIKE YOUR CHANGE.**
    `SwimSyncApp/.env` and `SwimSyncAdmin/.env.local` are git-ignored, so a new worktree
    gets neither — nor `node_modules`. The admin fails loudly (it will not start), but
    **the Expo app starts fine and serves a 200**; it simply cannot reach Supabase, so the
    login screen never renders its fields and any driver dies on
    `getByPlaceholder('you@email.com')` after a 30s timeout. That reads exactly like "the
    change under test broke the app."
    - Cost real time this session: `verify-levels.mjs` failed this way and was initially
      suspected as a regression in the Levels fix. **What settled it was running the driver
      against the *unfixed* code and getting the identical failure** — do that before
      diagnosing anything else, it is two minutes and it partitions the search space.
    - Setup for a new worktree, before any driver:
      `cp <root>/SwimSyncAdmin/.env.local <wt>/SwimSyncAdmin/ && cp <root>/SwimSyncApp/.env <wt>/SwimSyncApp/`
      then `npm install` in both. **Check the copied file points at `127.0.0.1:54321`**
      before using it — copying a cloud-pointed env into a worktree aims your drivers at
      production.
    - Related: run the admin on a **non-default port** (`npm run dev -- -p 3100`) when
      siblings may hold 3000. `drivers/lib.mjs` already reads `ADMIN_URL`/`EXPO_URL`, so no
      driver needs editing — and do not edit it, since it is shared with every worktree.
    - **The rule:** write migrations in the `main` worktree on a short `db/…` branch, apply,
      `supabase test db`, merge to `main` **before** anything depends on them; feature
      branches then `git merge main` to *consume* the schema and never carry it. One in
      flight at a time. Announce before `db reset` — it wipes every other worktree's
      fixtures.
    - **Do NOT give each worktree its own stack** by editing `project_id`/ports:
      `config.toml` is **tracked**, so per-folder values are one `git add -A` from being
      committed and one `git checkout` from being clobbered.
    - **`WORKTREE.md` is per-worktree scratch and must stay gitignored** — two worktrees
      cannot own one path, and committing it makes every sibling's `git merge main` fail
      with *"untracked working tree files would be overwritten"*. Anything durable in it
      belongs here or in `BACKLOG.md` **before** the worktree is retired.
      - **This bit immediately.** The 2026-07-27 worktree branched *before* that rule
        landed and committed `WORKTREE.md`; it was caught at merge time and removed with
        `git rm --cached`. If your branch predates `12cf553`, check before you commit.
    - **`git status` BEFORE `git commit`, not after — a sibling session can move `HEAD`
      between your checkout and your commit.** On 2026-07-16 a branch was created for six
      backlog items, a concurrent merge to `main` moved `HEAD` in between, and the commit
      (`3e1270c`) landed **on `main`** while the branch was left an empty pointer. Docs-only,
      so no harm — but note the second-order cost: `3e1270c` **has no CI run of its own**,
      because it was pushed between two other commits and the green run belongs to
      `b89ca52`, which merely contains it. A commit that never ran CI is invisible to every
      later "CI was green" claim. Two sessions in one repo also means **check `git log`
      before assuming an uncommitted file is yours**. (Promoted from §8g/§8h, 2026-07-16.)

57. **A `BEFORE INSERT` TRIGGER ALSO FIRES FOR ROWS THAT RESOLVE TO AN *UPDATE*.**
    PostgREST emits `.upsert(rows, { onConflict })` as `INSERT … ON CONFLICT DO UPDATE`,
    and Postgres runs BEFORE INSERT triggers for **every candidate row, before the
    conflict is detected**. So a guard written as "INSERT only" silently governs updates
    too.
    This was one review pass away from shipping: the attendance window guard
    (`20260727000100`) would have refused **every correction to an already-invoiced
    lesson** — the credit-note flow (PRD §7.8), which is the exact feature the
    INSERT/UPDATE split was chosen to protect. Worse, the coach's save sends **every
    student in ONE statement**, so a single refused row fails the whole class's save with
    a generic error.
    **The fix is to detect the update inside the trigger** — if a row already exists for
    the conflict key, it is a correction, so return early. A client-side "split insert
    from update" would not do: it leaves direct REST calls unguarded.
    Confirmed empirically with a throwaway probe table before the guard was written, not
    reasoned about. Audit: `grep -rn "BEFORE INSERT" supabase/migrations/` — for each, ask
    whether its table is ever written by `.upsert()`.

58. **A DEEP-LINKED RN-WEB SCREEN CAN BE PHYSICALLY OVERLAID BY THE ONE YOU LEFT, SO
    `click({force:true})` PRESSES THE WRONG ELEMENT.** §7.10 records that the previous
    screen stays mounted and pollutes `document.body.innerText`. Reaching a screen by
    **deep link** is worse: the stale screen is also laid out on top, so
    `document.elementFromPoint()` at a button's own centre returns a card belonging to the
    *other* screen. `force: true` skips the actionability check but still clicks those
    coordinates — the press lands on the overlay, nothing errors, the state never changes,
    and the driver reads as "the feature is broken".
    Cost an hour on `verify-attendance-guard.mjs`, where the two save checks failed while
    the save worked fine by hand. **Diagnose by asking the DOM, not by screenshot:**
    ```js
    const r = el.getBoundingClientRect();
    document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) // is it your element?
    ```
    The fix is to dispatch `pointerdown`/`pointerup`/`click` on the element itself
    (`pressByText()` in that driver). Prefer in-app navigation where you can; use this
    when a deep link is the point of the test.

59. **A `COUNT(*)` BASELINE IS ROLE-DEPENDENT UNDER RLS, SO "NOTHING WAS WRITTEN" CAN
    FAIL WHILE BEING TRUE.** A pgTAP fixture captured `SELECT COUNT(*) FROM lesson_sessions`
    as `postgres` (which sees every row) and compared it later under `SET LOCAL ROLE
    authenticated`, where the coach sees only their own classes' sessions. The two numbers
    count different things, so the assertion failed no matter what the code did — and the
    failure looks like the guard leaking a write, which is the most alarming possible
    misdiagnosis.
    **Scope both sides to the same rows** (`WHERE class_id = …`), or take both counts as
    the same role. This is §7.16's sibling: there the role was silently *wrong*, here it
    silently *changes between two reads*.

60. **`git push … :main` IS A DEPLOY STEP. IT IS THE *APP* DEPLOY.** Vercel builds both
    web apps from `main`, so the moment a branch lands there the new frontend is going
    live — before any `db push` or `functions deploy` you have not already run.
    §7.27 says the expand/contract ordering "governs the **push**, not just the migration
    command". That was written after getting it wrong once. It was got wrong again on
    2026-07-27 (§8.15) by someone who had *written the deploy order into the plan an hour
    earlier*: the branch went to `main` first because that felt like source control, and
    the apps deployed ahead of the schema and the engine.
    **The reason a note is not enough** is that "merge my branch" and "deploy the
    frontend" feel like different categories of action, and only one of them sounds
    risky. They are the same action.
    **So: for a backend-first change, do `db push` and `functions deploy` BEFORE the push
    to `main`** — the branch is already tested, and nothing is watching it. Landing on
    `main` is the last step, not the first. Harmless on 2026-07-27 only because
    production had zero attendance rows; on a live month it would have been the exact
    deadlock the change existed to remove.

61. **FAMILY/CHILD STATUS PROPAGATION IS DELIBERATELY *NOT* A TRIGGER, AND MUST NOT BE
    "TIDIED" INTO ONE.** Deactivating a family's last active child also marks the family
    inactive (PRD §7.14). That happens in the **write path** — event-shaped, one-way — and
    it looks like an invariant begging to be enforced in the database. It is not. Two
    independent reasons:
    - **A trigger fires after the write and cannot ask anything.** The UI prompts the user
      about the sibling effect before committing to it; a trigger would make that prompt a
      lie, because the decision would already have been taken.
    - **A trigger maintaining `no active children ⇔ family inactive` BREAKS RE-ACTIVATION.**
      A returning family has zero active children *by design* — they re-enter the join code
      first and are assigned to a class afterwards — so the trigger would flip them straight
      back to inactive on the way in, and the join code (the only re-entry route, PRD §5.1)
      would silently stop working.
    The accepted consequence is that a family **can** be inactive while holding an active
    child; propagation is one-way and nothing reconciles the two. That is the design, not a
    gap. (Promoted from §8.4, 2026-07-19 — this reasoning existed nowhere else.)

62. **A SCHEMA CHANGE CAN SILENTLY BREAK A UI FIXTURE, BECAUSE NO FIXTURE RUNS IN CI.**
    `20260719000600_students_tenant_not_null.sql` made `students.tenant_id` NOT NULL.
    `fixtures-attendance-window.sql` and `fixtures-unmarked-lessons.sql` insert students
    without it, so **from that day both fixtures failed to load** — and nothing said so.
    CI runs pgTAP, Deno and the two frontend suites; it has never applied a fixture.
    **The damage is not that the driver fails, it is HOW it fails.** The fixture is a
    plain `psql` script, so the failing statement aborts and *the rest still runs*: the
    parent, the class and the sessions land, the children do not. The driver then reports
    a low score that reads like a product regression, and a half-loaded fixture leaves
    orphan rows that make the *next* run behave differently again.
    This is the real reason `verify-attendance-window.mjs` scored **0/4** for a week —
    not the stale clock assumption that was written down at the time. **A wrong diagnosis
    in the backlog is worse than none**: it sends the next person to fix the dates.
    **When a migration adds a NOT NULL column or a constraint, grep the fixtures:**
    `grep -l "INSERT INTO <table>" .claude/skills/run-ui-playwright/drivers/fixtures-*.sql`
    — and run each one it names. Until fixtures run in CI, that grep is the only guard.
    (Found 2026-07-26 while writing the missing teardowns; the round-trip harness in
    `docs/WORKTREES.md` Phase 4 is what surfaced it.)

63. **A FIXTURE MUST SCOPE EVERY WRITE TO ITS OWN ROWS — `FROM students` WITH NO FILTER
    COLLIDES WITH EVERY OTHER FIXTURE, AND THE COLLISION ABORTS THE STATEMENT.**
    `fixtures-unmarked-lessons.sql` wrote `FROM students st CROSS JOIN classes c` and
    `FROM sess CROSS JOIN students st` with no filter on `st`, so it enrolled **and marked
    present** every student in the database. Measured: 6 children enrolled and marked
    instead of 2, four of them belonging to another fixture.
    **The second-order failure is worse than the first.** Enrolling a student who already
    has an enrolment violates `one_active_enrolment_per_student`, which aborts the whole
    `INSERT` — so when any sibling fixture was loaded first, this fixture's *own* two
    children were **never enrolled at all**. It silently produced the exact opposite of the
    scenario it exists to build, and the driver's low score read as a product regression.
    Attendance is worse still: those rows are what billing is derived from, so a stray
    `present` is a **billable lesson attributed to someone else's child**.
    **The rule: every `INSERT … SELECT` in a fixture must be scoped to identifiers the
    fixture owns** — its own parent's family links, or its own UUID prefix. Never a bare
    `FROM <table>`. Audit:
    `grep -n "CROSS JOIN\|FROM students\|FROM classes" .claude/skills/run-ui-playwright/drivers/fixtures-*.sql`
    and for each hit ask "would this pick up a row another fixture created?"
    This is §7.62's sibling: there a *schema change* made a fixture statement fail, here a
    *sibling fixture* does. Both fail the same way — psql aborts the statement, the rest of
    the script runs, and the fixture half-loads without saying so. (Fixed 2026-07-26.)

64. **EXPO ROUTER REUSES A MOUNTED SCREEN WHEN ONLY A SEARCH PARAM CHANGES, SO A
    MOUNT-ONLY `useEffect` NEVER RELOADS — AND THIS WROTE ATTENDANCE TO THE WRONG DAY.**
    Every lesson is marked at one route, `/(coach)/classes/[id]/attendance`, identified
    only by `?date=`. Today's card, the Unmarked Lessons row and the roster all push that
    same route with a different date. The screen's loader was `useEffect(() => { load() },
    [])`, so it ran once per *mount* and never again. `date` comes from
    `useLocalSearchParams` and IS reactive, so the header repainted to the new lesson while
    `resolvedSessionId`, `students` and `attendance` still belonged to the previous one.
    **Measured in production 2026-07-26:** the coach marked Sun 26 Jul, opened Sun 19 Jul
    from the backlog, marked two children, and got *"Attendance saved."* — the rows landed
    on the **26 Jul** session. 19 Jul stayed unmarked (correctly: nothing was written to
    it), while today's lesson silently acquired statuses nobody had entered for it.
    **Every signal said success.** The `attendance` upsert returned 200, `audit_log`
    returned 201, the toast was green. The only tells were in DevTools: **no
    `lesson_sessions` POST at all** (proving the screen held an already-resolved id), and a
    `lesson_session_id` in the payload belonging to the other date. A billing-correctness
    bug that reads as a UI annoyance.
    **`[]` deps are not a style choice on a screen whose identity is a search param.** The
    other five param-driven screens in the app all depend on theirs (`[id]`,
    `[invoiceId, packageId]`, `[id, todayDate]`) or use `useFocusEffect`; this one was
    alone. Audit:
    `grep -rn -A3 "useLocalSearchParams" SwimSyncApp/app --include=*.tsx | grep -B1 "}, \[\])"`
    **Two more layers, because the deps alone have already been got wrong once.**
    `lib/attendanceSession.ts` makes a session id inseparable from the date it was
    resolved FOR — anything not provably about the current date is `stale`, and the save
    re-resolves from `(class_id, date)` rather than writing what it holds. And the spinner
    covers the gap between a param change and the reload landing: the effect runs *after*
    paint, and a tap is faster than a frame.
    **Only an in-app-navigation driver can catch this.** A deep link mounts a fresh screen
    and passes, which is why `verify-attendance-guard.mjs` — which navigates by URL
    throughout — scored **14/14 against the broken build**. `verify-stale-screen.mjs`
    clicks through Today's card then the backlog row: **4/8 before the fix, 12/12 after**
    (with §7.65). (Found and fixed 2026-07-26, live the same day.)

65. **`router.back()` ON THE ATTENDANCE SCREEN POPPED INTO A *DIFFERENT LESSON*, BECAUSE
    THE SCREEN LIVES IN A TAB IT IS NOT ALWAYS PUSHED FROM.**
    `classes/_layout.tsx` puts the attendance screen in the **Classes** tab's `Stack`, but
    Today's class card and Unmarked Lessons row push it from the **Today** tab. Switching
    tabs does not unwind the Classes stack — it only hides it — so the stack accumulates
    one attendance screen per lesson visited:
    `Today → 845am card` leaves `[classes-index, att(845)]`; the back chevron returns to
    Today **without popping it**; `Today → 930am card` makes it
    `[classes-index, att(845), att(930)]`; and saving the 9:30 class popped to the **8:45**
    screen, its session id still in the URL. Pressing the back chevron first is the step
    that makes it reproducible — that is what leaves a screen behind.
    **The fix is to stop asking "what is underneath?".** The caller states where it came
    from (`&from=today` / `&from=roster`) and the screen leaves with **`replace`, not
    `back`** — which also drops it out of the history, so nothing can pop back into a
    lesson the coach has finished.
    **This compounded with §7.64 and the two are easy to confuse.** §7.64 made the rows
    land on the wrong lesson; this made the *screen* the wrong lesson. With only §7.64
    fixed, the driver's "class A's lesson is untouched" check still passes while the
    navigation check fails — that split is the fastest way to tell which one you are
    looking at. (Found and fixed 2026-07-26, live the same day.)

66. **A DUPLICATE IN ONE UPSERT MAKES POSTGRES REFUSE THE WHOLE STATEMENT, SO A
    DOUBLY-ENROLLED CHILD WOULD BLOCK ATTENDANCE FOR AN ENTIRE CLASS.**
    The Mark Attendance screen saves the class in a single
    `.upsert(rows, { onConflict: "lesson_session_id,student_id" })`. Two rows with the same
    conflict key in one command is not a no-op and not a last-write-wins — it is an error:
    `ON CONFLICT DO UPDATE command cannot affect row a second time`. The whole save fails,
    reported to the coach as only *"Failed to save attendance. Please try again."*
    **Where the duplicate came from.** The screen's roster is built from enrolment ROWS
    matched by DATE SPAN, not by `is_active`, and a child can hold more than one row for the
    same class — unenrol then re-enrol keeps history (PRD §11.5). Two spans covering one
    date therefore listed the child twice. `mergeRoster` deduped the *extras* (attendance
    rows, trial bookings) but passed `activeStudents` through untouched.
    **`attendanceCompleteness.ts` had been right all along** — `studentsEnrolledOn` dedupes
    and its comment says exactly why. The billing gate was correct and the screen was
    wrong, which is the §7.18 asymmetry in miniature: two places answering "who is in this
    lesson?" and only one of them careful.
    **THIS IS A LATENT HAZARD, NOT AN OBSERVED INCIDENT — and the first version of this
    entry got that wrong.** It was written while diagnosing a "Failed to save attendance"
    report and asserted it was the cause. It was not: the check
    `group by student_id, class_id having count(*) > 1` returned **zero rows** on
    production, so no roster had ever duplicated. The real cause was §7.67. The dedupe is
    still correct — the billing gate has always done it — but nothing has yet reached it.
    Reaching it needs two enrolment rows for one child in one class with overlapping spans,
    which no current write path creates; a hand-written data fix could.
    **The screens that filter on `is_active` cannot hit this**, because
    `one_active_enrolment_per_student` is a unique partial index — at most one active
    enrolment per child. Only a span-based reader can duplicate, and the attendance screen
    is the only one. So the guard belongs in `mergeRoster`, which owns "who is on this
    screen", not at the call site. Audit for the next span reader:
    `grep -rn "enrolled_at" SwimSyncApp/app SwimSyncAdmin/app | grep -v is_active`
    (Found and fixed 2026-07-26, live the same day.)

67. **A `.upsert()` WHOSE ROWS HAVE DIFFERENT KEYS SENDS `NULL` FOR THE MISSING ONES — NOT
    THE COLUMN DEFAULT — SO ONE PARTIALLY-MARKED LESSON BECAME PERMANENTLY UNSAVEABLE.**
    supabase-js derives PostgREST's `columns=` parameter from the **union** of keys across
    every row in the body. PostgREST then runs the body through
    `json_populate_recordset` against that column list, and a row that omits a key gets
    **NULL** — the column DEFAULT never applies.
    The attendance save attached the row's primary key conditionally:
    `...(state.existingId ? { id: state.existingId } : {})`. On a lesson where SOME children
    were already marked and others were not, the key sets differed, `id` joined the column
    list, and the unmarked children were inserted with `id = NULL` against
    `attendance.id uuid NOT NULL DEFAULT gen_random_uuid()`:
    `23502 null value in column "id" of relation "attendance" violates not-null constraint`.
    **Postgres refuses the whole statement**, and the screen saves a class in ONE upsert, so
    the lesson could never be completed — and because `handleSave` returns early on the
    error, the coach was also stranded on the screen. All they saw was "Failed to save
    attendance. Please try again."
    **The shape of the symptom is the diagnosis.** A fully unmarked lesson saved fine (no row
    had `id`) and so did a fully marked one (every row did). Only the partial case failed —
    which read as "just this one date is broken" and sent two investigations down the wrong
    path (see §7.66). If one date fails and its neighbours do not, **compare what already
    exists on those dates**, not what is different about the date.
    **`id` was never needed.** `onConflict: "lesson_session_id,student_id"` is what matches
    an existing row — that pair is UNIQUE. Verified against local PostgREST: omitting `id`
    returns 201, the existing row KEEPS its id (absent from the payload, so absent from the
    `DO UPDATE SET`), and a new row takes the default. The `existingId` plumbing was
    removed entirely, including from `attendanceBulk.ts`, whose comment claimed it made the
    save "update in place rather than duplicating" — it never did.
    **The rule: build every upsert row from one object literal with no conditional keys.**
    If a column is genuinely per-row optional, send it as explicit `null`.
    `lib/attendancePayload.ts` owns this now, and `hasUniformKeys()` asserts it.
    (Found and fixed 2026-07-26, live the same day.)

68. **"FULLY MARKED" MEANS TWO DIFFERENT THINGS TO INVOICING AND TO A COACH'S SCREEN, AND
    ONE OF THEM IS LOAD-BEARING FOR MONEY.**
    `isLessonFullyMarked([], undefined)` returns **true** — a lesson nobody was expected at
    is complete. That is correct for the billing gate: there is nothing to collect, so it
    must not block a month. `unmarkedDates()` relies on it to skip dates before a class had
    anyone in it (§8.15) and the engine relies on it to seal a month (§8a).
    It is also a **lie on a card**. A class with an empty roster rendering a green "Marked"
    tells the coach it is done when nobody has touched it — and if a student is added later,
    that lesson is now silently unmarked behind a green chip.
    **The tempting fix is to change the shared helper. Do not.** It is duplicated in
    `SwimSyncAdmin` and in the engine's Deno copy, it has a drift test, and changing it
    changes which months can be invoiced for every tenant — either blocking one that should
    bill or sealing one with a lesson unbilled.
    **The rule: a display concern gets solved in the display layer.**
    `lib/attendanceSummary.ts` returns a distinct `no-students` state, checked FIRST so an
    empty expected set cannot fall through to `complete`; `attendanceCompleteness.ts` is
    untouched. A test in `attendanceCompleteness.test.ts` now pins the vacuous `true` and
    says why, so the next person to "fix" it breaks something that argues back.
    **The same asymmetry governs the button.** Only `complete` may quieten the
    "Mark Attendance" CTA — written `kind === "complete"`, never `kind !== "unmarked"` — so
    any state added later inherits the LOUD button. A card that stops asking for marks it
    still needs is a lesson that never gets marked, and that blocks the month with no
    override. Nagging unnecessarily is annoying; going quiet wrongly costs money. When a
    default has an asymmetric cost, encode the asymmetry, don't rely on the next reader
    noticing it. (2026-07-26.)

69. **A DISPLAY FILTER MUST NOT BE REUSED AS A DESTRUCTIVE-ACTION GUARD.**
    Making the Swimming Levels *Students* column count only **active** children is right —
    it answers a roster question. Reusing that same number in the level's **removal warning**
    is not, and it was one line from shipping. `students.level_id` is `ON DELETE SET NULL`
    (`20260719001800_tenant_levels.sql:70`), so removing a level never errors — it blanks the
    level for **every** student pointing at it. A level with 0 active and 2 departed children
    would have said *"No students are on this level."*, the admin deletes it, two children
    lose a level nothing anywhere records, and reactivating one later cannot restore it.
    **The rule: the filter that answers "what should I show?" is not the filter that answers
    "what will this destroy?"** Check what the CONSTRAINT reads — here it does not read
    `is_active`. `lib/studentCounts.ts` keeps both numbers side by side for this reason.
    Caught by measuring the modal's text **before and after** the change: the pre-fix string
    was *correct by accident* because it counted everyone, so only a before/after diff showed
    a regression being introduced rather than fixed. (2026-07-26.)

70. **A CLIENT-SIDE `.length` IS SILENTLY CAPPED AT `max_rows = 1000`, SO IT IS THE WRONG WAY
    TO COUNT ANYTHING.**
    PostgREST simply returns fewer rows — no error, no header, no warning. Counting a table
    by fetching it and taking `.length` therefore under-reports past 1000 and looks perfect
    until it doesn't. Use `.select("id", { count: "exact", head: true })`, which is exact at
    any size and transfers no rows.
    This was written up inside `platform/page.tsx`'s own comments, where nobody reads it.
    The admin Dashboard now uses a head count; **the Students page still counts client-side
    and deliberately inherits the ceiling**, because that whole page is an unpaginated
    client-side list — which is why the two surfaces are implemented differently and must not
    be "tidied" into consistency. (2026-07-26.)

71. **`w-full` ON A TABLE CELL IS A *PREFERRED* WIDTH, NOT A FLOOR — SO THE COLUMN YOU GROW
    IS THE COLUMN THAT GETS CRUSHED.**
    Marking one column `w-full` while the rest are `w-px whitespace-nowrap` reads as "that
    column takes the leftover space", and it does — until the columns over-subscribe the
    table, at which point the percentage column is the only one that CAN shrink and it
    absorbs the entire shortage. **Measured** on admin Classes at 1600px: seven hugging
    columns took 1167px of a 1278px table and `Class Name` — the primary column, the one
    being grown — rendered at **110px, narrower than `Day`**, its title broken mid-phrase.
    Two consequences: keep such a column `nowrap` so its min-content becomes a floor and the
    card scrolls instead; and prefer letting the **last** column take the slack via one
    `[&_th:last-child]:w-full` on the table over a per-table prop, which additionally needs a
    call-site test to catch a table that nominates none.
    Found by measuring `getBoundingClientRect()` per column in a Playwright run. **Every
    class name in the markup was correct**, so reading the diff or the DOM would not have
    shown it — this is a class of bug only measurement finds. (2026-07-26.)

72. **§7.31 REFINED: NEXT.JS CODE-SPLITS PER ROUTE, SO GREPPING THE WRONG PAGE'S CHUNKS
    REPORTS "NOT DEPLOYED" FOR A BUILD THAT IS ALREADY LIVE.**
    §7.31 is right that a 200 proves nothing and you must grep the served bundle for a string
    only the new build has. It is incomplete for the admin panel: `/login`'s HTML never
    references `/attendance`'s chunk. Cost: **eight consecutive wrong conclusions**, with the
    tell in plain sight — the chunk hash never changed, because it was never the right chunk.
    - Fetch **the route you changed** and grep
      `_next/static/chunks/app/(admin)/<route>/page-*.js`.
    - For a **shared** component or lib module, expect the string in a common chunk
      (`582-*.js`, `789-*.js`) rather than any page chunk — so search every chunk the page
      references, not just the page's own.
    - A compiled **CSS** rule (`th:last-child{width:100%}`) is greppable in the stylesheet
      and is stronger evidence than a class name in the markup, which proves only that the
      source shipped, not that the rule applies.
    The Expo app does not have this problem — it serves one `entry-*.js` bundle, which is why
    §7.31's original recipe kept working there. (2026-07-26.)

73. **AN UNORDERED `LIMIT 1` OVER A SHARED TABLE IS A BUG THAT CANNOT FIRE UNTIL A SECOND ROW
    EXISTS — AND THEN IT PICKS THE WRONG TENANT.**
    `fixtures-student-identity.sql` opened with `SELECT id INTO v_tenant FROM tenants LIMIT 1`
    and took the class on the next line by title, from the seed business. With one tenant in
    the database the two always agreed, so it was correct for months. The moment
    `fixtures-phase4-billing.sql` created a second business ('Harbour Swim Club'), the
    unordered scan could return **that** one: the children were written into one tenant and
    enrolled into another's class, and `enforce_enrolment_tenant()` refused with
    `cross-tenant enrolment refused`.
    **The tell is that nothing changed in the failing file.** The bug was introduced by a
    *different* fixture starting to work — which is why it appeared the same day
    `check-fixture-roundtrip.sh` fixed phase4-billing, and why it had never been seen before.
    - **`LIMIT 1` with no `ORDER BY` has no defined row.** Postgres may return a different one
      after a vacuum, an index change, or a plan change, with no schema change at all.
    - **Derive, don't re-look-up.** The fix was `SELECT id, tenant_id INTO v_class, v_tenant
      FROM classes WHERE title = …` — one query, so the two values cannot disagree by
      construction. That is strictly better than adding `ORDER BY` to the original, which
      would only have made the wrong answer *stable*.
    - Same shape as the `.order("id").limit(500)` in §8.19's table work, which took an
      arbitrary 500 rows and presented them as the most recent. Audit with
      `grep -rn "LIMIT 1" .claude/skills/run-ui-playwright/drivers/fixtures-*.sql` and ask of
      each: "is there more than one row this could match, ever?"
    Caught by the pass-2 stacked check the first time it ran, not by any driver.
    (Fixed 2026-08-01.)
---

74. **AN "EMPTY STATE" ASSERTION MUST CLAIM THE SIBLING STATE IS *ABSENT*, NOT ONLY THAT ITS
    OWN STRING IS PRESENT — THE PREVIOUS SCREEN IS STILL MOUNTED UNDERNEATH.**
    The parent Attendance screen has two empty states that mean opposite things:
    *"No lessons marked yet"* (a lesson happened, the coach is behind) and *"No lessons have
    taken place yet"* (nothing has happened, nobody is behind). Telling a family the first
    when the second is true accuses their coach of being late (PRD §5.1) — the distinction
    IS the feature.
    A check written as `/No lessons marked yet/.test(text)` can pass on **the other child's
    panel**: §7.10/§7.58 mean the screen you navigated away from stays mounted and its text
    is still in `document.body.innerText`, so a mis-tapped chip proves nothing and reads
    green. That is the §8.19 "assertion passes vacuously" shape, at the assertion layer
    rather than the fixture layer.
    - **Assert presence AND sibling-absence**, always, for any pair of states that are
      mutually exclusive by design. `expected present && sibling absent` cannot be satisfied
      by a stale overlay showing the other one.
    - Assert the **selected entity's name** is on screen first, so a mis-tap fails loudly
      instead of silently reading the wrong panel.
    - The failure detail should distinguish "expected sentence absent" from "BOTH sentences
      on screen" — the second names the mis-tap directly.
    Applied in `verify-attendance-guard.mjs` when it absorbed `verify-attendance-window.mjs`.
    (2026-08-01.)

75. **A DRIVER THAT DOES `.first()` ON A LIST IT DOES NOT CONTROL SCHEDULES AGAINST THE WRONG
    ROW — AND THE CHECK NEXT TO IT KEEPS PASSING WHILE THREE OTHERS GO RED.**
    `verify-attendance-guard.mjs` opened the extra-lesson dialog with
    `getByText("Extra lesson").first()`. Correct while its fixture had exactly one class;
    the moment a second was added the admin table listed it first and every extra lesson was
    scheduled **against the wrong class**. Measured: 14/14 → 10/14.
    **The diagnostic trap is which check survived.** *"admin can schedule an extra lesson"*
    still **PASSED**, because it only asserted that a confirmation containing `Scheduled for`
    appeared — and one did, for the other class. The three that failed were the ones that
    queried the DATABASE by `class_id`. A UI assertion that does not name the entity it acted
    on cannot tell "it worked" from "it worked on something else".
    - **Scope to the row**: `locator("tr", { hasText: <title> }).getByText("Extra lesson")`.
    - **Assert the dialog names the entity** — the modal titles itself
      `Extra lesson — <class>`, so one regex converts a vacuous pass into a real one.
    - This is §7.73 in the UI layer: never index into a list whose length you do not control.
      Same audit question — *"is there more than one row this could match, ever?"*
    Found because the fixture change was made FIRST and the **unchanged** driver re-run
    before any driver edit, which left exactly one suspect. Do that split; it is cheap.
    (2026-08-01.)

76. **A BARE `as SomeType[]` ON AN RPC RESULT DOES NOT CHECK ANYTHING — RENAME A COLUMN AND
    THE UI RENDERS NOTHING, FOREVER, WITH NO ERROR.**
    `platform_tenant_overview()` returns `kind` and `coaches_without_rate`. The page declared
    `shape` and `staff_without_rate` and bridged the two with
    `setTenants((data ?? []) as TenantRow[])`. A `as` cast is an *assertion*, not a
    conversion: TypeScript believed it, so both fields were `undefined` at runtime. Result —
    the "Shape" column rendered **blank** on every row, and the amber
    `{t.staff_without_rate > 0 && …}` badge was `undefined > 0`, which is **false**, so the
    warning that exists to catch *a staff coach being paid nothing by payroll* had
    **never rendered once** since it was written (found 2026-08-01).
    **Both failures look like "there is nothing to report", which is the answer the reader
    wants** — an empty column reads as no data, a missing badge reads as no problem. Nothing
    logs, nothing throws, and the page that exists to surface trouble reports calm.
    - **Never `as` an RPC result.** Read the migration's `RETURNS TABLE` and match the names,
      or map field-by-field so a rename is a compile error.
    - The durable fix is generated types (`BACKLOG.md` → *Generate real Supabase `Database`
      types*). This is the concrete cost of not having them; it is not hypothetical.
    - **Audit:** `grep -n "as [A-Z][A-Za-z]*\[\]" **/*.tsx` and check every hit against the
      RPC that feeds it.
    - Its sibling: **supabase-js infers a to-one embed as an ARRAY while PostgREST returns an
      OBJECT.** Verified against the running API — `profiles!inner(role)` yields
      `"profiles": {"role": "tenant_admin"}`, not `[{…}]`. `tsc` will reject the honest cast
      here, and the temptation is `as unknown as T`, which silences the compiler and leaves
      the field undefined if the shape ever moves. Accept both shapes and normalise.
    (2026-08-01.)
