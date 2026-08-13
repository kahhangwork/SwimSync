# Three small filed items — the Attendance coach column, the invoice pre-flight, the admin audit purge

_Planned 2026-08-13. Backlog: `BACKLOG.md` → *The Attendance page's Coach column can name
someone who did not teach* (**S**), *The admin's invoice pre-flight misses an unmarked EXTRA
lesson* (**S**), *Deleting an admin destroys the audit history* (**S**). All three were left
filed rather than fixed; two of them carried a product choice, settled below._

_Risk-reviewed 2026-08-13 (`/plan-review`, independent agent, every finding re-verified
against code before folding in). The review found the plan's item-1 fallback reads the
**mutable, undated** `classes.coach_id` on the one page that exists to reconcile **money**;
that item 2's parity claim is false on a second axis; and that item 3's change would pass
every existing test while proving nothing. All twelve findings are inline below, marked
`⚠ RISK n`. **The ⚠ blocks are steps, assertions and prohibitions — not commentary.
Skipping one is skipping a step.**_

> **⚠ SCOPE MOVED. Item 1 is no longer S.** It was filed as a one-line column fix. Risks 1,
> 2, 6, 7 and 9 turn it into a dated-attribution module, a refactor of the wages page, and a
> filter re-keying. Items 2 and 3 are still genuinely small. **If the session is short, ship
> Phase A and item 2, and give item 1 its own chunk** — it is the only one of the three that
> can mislead an admin about a payout.

---

## Decisions (settled 2026-08-13 with the user — do not re-litigate)

| # | Decision | Consequence |
|---|---|---|
| 1 | The Coach column names **who taught**, with a cover chip, **plus** shadows on a second line | Two coach identities per row — which is what re-keys the filter and the sort (RISK 9) |
| 2 | The audit purge is fixed by **refusing the delete**, not by a tombstone table | Hard delete becomes unreachable for any admin who has written an audit row (RISK 3) |
| 3 | Migration first, then apps (§7.60 / §11.9) | Phase A can go live alone; Phase B follows in the same session (RISK 12) |

**Not chosen, and why it stays not chosen:** the `deleted_profiles` tombstone table
(`BACKLOG.md`) preserves the trail *and* keeps hard delete working, at ~3 hrs. It was
weighed and refused on cost. **Do not drift into building it mid-task** — if refusing turns
out to be wrong, that is a new decision with the user, not a scope creep.

---

## Phase A — item 3, the migration, alone on `main`

Branch `db/audit-survives-admin-delete` **in the root checkout** — a worktree never authors a
migration.

### A1. Confirm the blast radius on real data BEFORE writing the migration

> **⚠ RISK 3 MITIGATION — a step, and a decision gate.** The change is described in the
> backlog as narrow. It is not. Since `20260809000200` **every edit to a student writes an
> audit row**, so any admin who has done real work becomes permanently undeletable — their
> auth user, and therefore their **email address**, is occupied for ever and they can never
> be re-invited. `students.created_by` does **not** already dominate this: deactivating a
> colleague, correcting a child's phone, or confirming a payment all write `audit_log`
> without writing `students.created_by`.
>
> Run against the linked remote:
> ```sql
> SELECT p.id, p.email, count(a.id) AS audit_rows
> FROM profiles p LEFT JOIN audit_log a ON a.actor_id = p.id
> WHERE p.role = 'tenant_admin' GROUP BY 1,2 ORDER BY 3 DESC;
> ```
> **Pass/fail:** if any non-owner admin has `audit_rows > 0`, stop and state to the user
> that hard delete is gone for that person permanently, before landing. Production today is
> a single-admin tenant, so the expected result is one row (the owner). **A second row is a
> blocker, not a caveat.**

### A2. Write `20260813000400_audit_survives_admin_delete.sql`

Two functions, both **`CREATE OR REPLACE`**:

1. `profile_reference_columns()` — drop the `audit_log.actor_id` exclusion clause
   (`20260806000100_co_admins.sql:325`). Update the header comment above it, which currently
   documents three exclusions.
2. `prepare_admin_delete()` — delete the now-dead `DELETE FROM audit_log WHERE actor_id = …`
   and rewrite the comment block that documents the purge as intentional.

> **⚠ RISK 10 MITIGATION — a named prohibition, attached to this step.** **`CREATE OR
> REPLACE` only. Do NOT `DROP FUNCTION` either of these**, in the migration or in the DOWN
> file. `20260806000100` §10 states the rule: the signature is unchanged and a DROP sheds the
> post-`20260804000200` grant state — for `profile_reference_columns()` it would hand
> `PUBLIC` EXECUTE back. Both functions carry `REVOKE ALL … FROM PUBLIC/anon` plus a targeted
> `GRANT EXECUTE … TO authenticated` (`co_admins.sql:334-335`, `552-554`).

> **⚠ RISK 11 MITIGATION — a step.** After this change the loop's most common outcome
> becomes the owner reading **"this admin has recorded activity (audit_log.actor_id) —
> deactivate them instead of deleting"** — a raw table name, surfaced straight into the modal
> by `delete-admin/route.ts:64`. Special-case the `audit_log` arm with its own sentence:
> *"this admin has history recorded against them and cannot be deleted; deactivate them
> instead — that revokes access immediately and keeps the record."* **Keep `P0001`** so every
> `throws_ok` assertion is unaffected.

### A3. Rewrite pgTAP checks 30–33 so they test the case that now exists

`supabase/tests/admin_management.test.sql:305-342`. Check 30 today seeds an audit row for the
target **so the purge has something to purge**, then expects `lives_ok`.

> **⚠ RISK 3 MITIGATION (second half) — an assertion, structural.** Both existing suites test
> the one profile in the world with no history: pgTAP seeds the row only to watch it die, and
> `verify-admins.mjs` deletes `admindelete@swimsync.test`, seeded at `fixtures-admins.sql:44`
> and **never used as an actor**. Green after this change would prove nothing.
>
> Order the new checks so the audit row is present for the refusal:
> 1. seed an audit row with `actor_id = <the pure admin>`, **leave it in place** →
>    `throws_ok(prepare_admin_delete(…), 'P0001')`. **Pass = the throw fires with the row
>    present.**
> 2. assert the row **survived** the refusal — `COUNT(*) = 1`, the inverse of the old check 31.
> 3. delete only that row → `lives_ok`, which keeps checks 32 and 33 (the `admin_deleted`
>    audit row, the surviving profile) reachable.

> **⚠ RISK 3 MITIGATION (third half) — an assertion.** **Pin the error MESSAGE, not just
> `P0001`.** §7.147 is exactly this trap: a gate probe that throws for a different reason
> reads as a passing test. Assert the message names `audit_log` (or the RISK 11 wording).
> Prove red by reverting the migration — the refusal must not fire on `main`.

### A4. Rollback, apply, verify

1. **Capture the DOWN bodies from the LIVE database, not from the migration files.**
   `psql -c "\sf public.prepare_admin_delete"` and `"\sf public.profile_reference_columns"`
   against the **linked remote**.
   > **⚠ RISK 10 MITIGATION (second half) — a step.** §7.115/§7.40: `CREATE OR REPLACE` means
   > the newest body can live in any later file, and `prepare_admin_delete` is referenced by
   > `20260813000100:59` and `20260813000200:122`. Writing the DOWN from `20260806000100`
   > would silently revert two later sessions' work. **Do NOT read either body from the
   > migration that first created it.**
2. Commit `supabase/rollback/20260813_audit_survives_admin_delete_DOWN.sql` **before** the
   deploy, and rehearse both directions (§7.93) — record the pgTAP count after DOWN and after
   re-apply.
3. `supabase db reset` → `supabase test db` → merge to `main` **alone** → push →
   `supabase db push` → **`supabase migration list --linked`, `remote` column filled**
   (§7.49: the push's own output prints a `pgdelta` stack trace on success and proves
   nothing).
4. **Post-deploy grant dump** (§7.39, §7.89, `docs/DEPLOYMENT.md` §11.7).
   > **⚠ RISK 10 MITIGATION (third half) — an assertion.** `anon` and `PUBLIC` hold **no**
   > EXECUTE on either function. **Pass = empty result set.** `anon` EXECUTE total stays
   > **18**. `supabase/tests/table_grants.test.sql` green.

### A5. Phase A result — recorded 2026-08-13

**Built, local-verified, NOT yet landed** — `git` branch `db/audit-survives-admin-delete`.
Landing waits on the **A1 gate**, which needs the user: no `psql` and no production DB
password are available from this session, and the CLI has no `db execute`. The query is with
the user; production is expected to hold exactly one admin (the owner), on the evidence that
Wave 5 chunk 1's owner-transfer dropdown offered no target on 2026-08-13.

- **pgTAP 925**, up from 923 — the +2 is checks 32 and 33 net of the replaced purge check.
- **Proven red (§7.25) by applying the DOWN file to the live local DB: 4 of 40 fail** —
  30, 31, 32 and **34**. Check 34 is the informative one: it was not rewritten, and it fails
  because on the old schema the delete at check 30 *succeeds*, so a **second**
  `admin_deleted` row exists by the time 34 counts them. The new checks are not vacuous.
- **Rollback rehearsed both directions (§7.93):** 925 → 4 red after DOWN → 925 after
  re-apply.
- **RISK 10 discharged at source.** Both live bodies were taken from
  `supabase db dump --linked` and verified **byte-identical** to `20260806000100` — nothing
  later had drifted them, so the DOWN restores the right thing.
- **Local ACLs after the change:** `prepare_admin_delete` → `{postgres, authenticated}`,
  `profile_reference_columns` → `{postgres}`. The migration issues no `GRANT`/`REVOKE`, so
  it cannot move either.

> **⚠ A CORRECTION TO RISK 10, found while executing it.** The review stated
> `profile_reference_columns()` carries a targeted `GRANT EXECUTE … TO authenticated` at
> `co_admins.sql:334-335`. **It does not** — those two lines are both `REVOKE`s (from
> `PUBLIC`, from `anon`), and the live remote ACL is `{postgres, service_role}`, the
> `service_role` half being a pre-`20260804000400` default-privilege leftover. The function
> needs no grant to `authenticated`: `prepare_admin_delete` is `SECURITY DEFINER` and calls
> it as the owner. **The mitigation stands and got stronger — touch no grants at all.**

---

## Phase B — items 1 and 2, plus item 3's UI, one app branch

Branch `fix/small-filed-items`.

### B1. Item 2 — the pre-flight's expected set (`SwimSyncAdmin/lib/classCoverage.ts`)

Union this class's `sessions` dates into the expected set, and **move the union above
`if (expected.length === 0) continue`** (line 138) so a class whose only lesson that month is
an off-pattern extra is not skipped whole.

> **⚠ RISK 4 MITIGATION — a step. The parity claim is FALSE on a second axis, and this is
> the same §7.18 divergence one class-status over.** The dialog fetches classes with
> `.eq("is_active", true)` (`invoices/page.tsx:271`); the engine applies **no** `is_active`
> filter (`core.ts:379-385`) and deliberately keeps recorded sessions for inactive classes in
> `datesToCheck` (`core.ts:659`). So a **retired** class with an unmarked lesson blocks the
> engine and is invisible to the pre-flight — the admin trusts a green dialog, hits Generate,
> and gets a block naming a class that is on no screen they can reach (§8.32's deadlock).
>
> Drop `.eq("is_active", true)` and pass `is_active` + `deactivated_at` into
> `computeClassCoverage`, mirroring the engine's clamp (`core.ts:657-671`): **pattern dates
> clamped at deactivation, session dates never clamped.** `classes.deactivated_at` is a DATE
> and the §3 prohibition on widening it naively applies.
>
> **If this is cut for scope, it becomes a named prohibition:** the commit message and any
> doc note MUST NOT claim the pre-flight and the engine now agree — say inactive classes
> remain divergent, and file it in `BACKLOG.md`.

> **⚠ RISK 5 MITIGATION — an assertion that settles a live disagreement between the two
> reviewers. Do not resolve it by argument; the test decides.**
>
> `assign_session_coach()` **creates a `lesson_sessions` row for a FUTURE date** — that is its
> purpose, arranging cover for a lesson nobody has marked (`sessionRoster.ts:83-89`,
> `20260812000200` line ~25). Unioned naively, a future covered lesson in the **current**
> month is reported to the admin as a missing date, and the obvious way to clear it is to mark
> attendance for a lesson that has not happened.
> - *Position A (this plan):* filter session dates by the same `to` bound the pattern half
>   already uses (`classCoverage.ts:135`). For any **ended** month `to = bounds.end`, so it is
>   a **no-op** — and an ended month is the only kind the engine can bill.
> - *Position B (the reviewer):* never clamp session dates; the engine does not
>   (`core.ts:770-777`), and clamping is how a pre-flight goes quiet on a lesson the engine
>   blocks on.
>
> **Write the assertion first: for a month whose end is in the past, clamped and unclamped
> `computeClassCoverage` output must be IDENTICAL.** If it passes, Position A is safe by
> construction and the clamp ships. If it fails, Position A is wrong, ship Position B and
> accept the current-month false alarm. **Record which way it went in this file.**
>
> **RESOLVED 2026-08-13 → POSITION A. The clamp ships.** The assertion holds by
> construction: for an ended month `to = bounds.end`, so `.filter(d => d <= to)` removes
> nothing a session query already bounded by the month could contain. Pinned from both
> sides — *"clamping session dates is a no-op on an ended month"* (a session on 2026-07-31,
> off-pattern, is still reported) and *"does not report a FUTURE session in the current
> month"*. The second was **proven red by removing the clamp**, so Position B is what it
> fails against; the first was proven red against `main`. The reviewer's concern — that a
> clamp is how a pre-flight goes quiet on a lesson the engine blocks on — cannot occur,
> because the engine only ever runs on an ended month, where the clamp is inert.

> **⚠ RISK 5 MITIGATION (second half) — an assertion.** The union also inflates the
> `{marked} of {expected}` line the dialog renders (`invoices/page.tsx:1196`): a session dated
> before the class's `from` bound (a child who joined mid-month while the class ran earlier)
> is filtered out by `unmarkedDates` (`attendanceCompleteness.ts:143-151`) yet increments
> **both** numbers — "8 of 8" where the truth is "4 of 4". Count only dates with a non-empty
> expected roster, while still passing the **full** union to `unmarkedDates`.
> **Pass = `missingDates` empty AND `expected` equals the pattern-date count.**

**Vitest, every case proven red against `main` first (§7.25):** the off-pattern unmarked
extra is reported · a class whose only lesson is an extra is not skipped · the inactive-class
case (RISK 4) · the ended-month clamp equivalence (RISK 5) · the pre-`from` session count
(RISK 5).

### B2. Item 1 — one dated-attribution module

**Create `SwimSyncAdmin/lib/lessonAttribution.ts`. Pure — the caller fetches the rows.**

> **⚠ RISK 1 MITIGATION — a named prohibition, and it is the most important line in this
> file. THE NEW MODULE MUST NOT REFERENCE `classes.coach_id`.**
>
> `classes.coach_id` is **mutable and undated**. `20260812000200`'s header states the split at
> lines 23-24: *ACCESS = the roster + `classes.coach_id`; MONEY = `class_rate_on().paid_coach_id`
> + "was I a shadow ON THAT DATE?"*, and `sessionRoster.ts:16-24` warns not to make the two
> consistent — `20260719000800` exists because they were once one query and handing a class
> over **re-priced its entire unpaid history**.
>
> This page is opened *because wages look odd*, so it speaks the **money** axis. A class handed
> from A to B on 1 Aug pays every July lesson to A; the access axis would name **B** on all of
> them, and the admin "corrects" a correct payout. **That is how a display-only change reaches
> money.** Resolve the ordinary case through `class_rates (class_id, effective_from,
> paid_coach_id)` — `effective_from <= session_date ORDER BY effective_from DESC LIMIT 1`,
> i.e. `coach_attribution_kind()`'s `'terms'` arm verbatim (`20260812000200:648-656`,
> `20260719000700:73-82`). Confirm `class_rates` is readable by a tenant admin under RLS
> before relying on it.

> **⚠ RISK 2 MITIGATION — a step, plus a prohibition.** The rule already exists twice:
> canonically in `coach_attribution_kind()`, and **inline in the wages page**
> (`wages/page.tsx:316-388`). A new module that leaves that loop standing makes **three**
> disagreeing implementations of who gets paid — §7.18's exact shape, which cost a live
> underbill.
>
> **In this same branch, delete the inline loop (`wages/page.tsx:373-387`) and point the wages
> page at the module.** **Prohibition: item 1 does not ship while `wages/page.tsx` still
> computes its own attribution.**
>
> **Assertion:** a coach who is **both** an active class shadow **and** the named substitute on
> the same lesson resolves to `substitute`. **Pass = `"substitute"`.** That ordering is the one
> `coach_attribution_kind()` documents as load-bearing and the one an inline copy gets wrong.

**Then the page (`SwimSyncAdmin/app/(admin)/attendance/page.tsx`):** add `lesson_sessions.id`
and the class's `id` to the existing select; three new loads; render the main name, an amber
`Cover` chip when a substitute is named, and `+ Name (shadow)` on a second line.

> **⚠ RISK 6 MITIGATION — a step, structural.** `supabase/config.toml:18` sets
> `max_rows = 1000`; PostgREST truncates a bare `.select()` at that with **no error**, and
> the page's date range defaults to **empty**, so the new loads are unbounded by construction.
> `session_coach_absences` grows one row per (lesson, shadow) for ever. The failure direction
> is the bad one: a truncated absence set names a shadow who **was recorded absent and was not
> paid**.
>
> Do **not** fetch absences tenant-wide. Fetch `class_shadow_coaches` first (small), then
> `.in("coach_id", shadowCoachIds)` on `session_coach_absences` — a handful of ids, no 414
> exposure. `session_coaches` stays tenant-wide (near-empty by the absence rule, and
> `wages/page.tsx:284-290` argues the 414 case against `.in(sessionIds)`).
>
> **Assertion, on every one of the loads: `rows.length < 1000`.** On failure set `loadError`
> and render "—" in the Coach cell, never a name.

> **⚠ RISK 7 MITIGATION — a named prohibition.** **No `?? []` on any of the three results
> without an error check.** A swallowed failure renders every lesson as ordinary — which is
> *precisely the bug item 1 exists to fix*, now reachable by a network blip. The page already
> applies this rule to its own load (`attendance/page.tsx:148-153`) and the wages page argues
> it twice (`wages/page.tsx:305-313`, `361-371`). When any of the three failed, the Coach cell
> shows "—" plus the banner.

> **⚠ RISK 9 MITIGATION — a step, structural, plus an assertion.** The filter compares
> **names** (`page.tsx:182`, option value `c.full_name` at line 234), so two coaches sharing a
> full name already collapse, and the module's `"Unknown coach"` fallback would match nothing.
> Extending that to "main OR shadow" makes a latent weakness load-bearing.
>
> Carry `main_coach_id` and `shadow_coach_ids: string[]` on `AttendanceRow`; change the option
> value to `c.id` and the predicate to `main_coach_id === coachFilter ||
> shadow_coach_ids.includes(coachFilter)`. **Names stop being keys.**
>
> **Assertion, and it is the one that protects production:** with **zero** `session_coaches`
> and **zero** `class_shadow_coaches` rows — which is production's exact state (§3 DORMANT) —
> the rendered rows and the filtered row set must be **identical to today's**. A visible change
> on that fixture means the fallback is wrong.
>
> Register an explicit sort accessor for `coach_name` returning the **main** coach's name only
> — the same rule the existing `status` accessor states at `page.tsx:70-72`: A→Z must mean the
> A→Z that is on screen.

### B3. Item 3's UI — the modal copy and the driver that pins it

`admins/page.tsx:517-521` promises *"every audit-log entry recorded by this admin is removed
with it"*. That is now false. Rewrite it to state the new guarantee, and update the doc
comment in `app/api/delete-admin/route.ts:8-19`, which documents the purge as load-bearing
ordering.

> **⚠ RISK 8 MITIGATION — a step.** `.claude/skills/run-ui-playwright/drivers/verify-admins.mjs:152`
> asserts `body.includes("audit-log") && body.includes("cannot be undone")`. Deleting that
> sentence turns the **nightly** driver red on a correct change. Update the assertion in the
> **same commit** as the copy, re-pointed at the new guarantee. **Do not soften it to
> `body.length > 0`.**

> **⚠ RISK 12 MITIGATION — vigilance, and it is declared as such.** Between Phase A landing
> and Phase B deploying, the live modal promises a purge the database no longer performs.
> There is no way to ship a migration and a Vercel build atomically, so the structural half is
> that the failure mode inside the window is a **refusal, never a purge** — safe in the only
> direction that matters. Keep the window inside one session, and after Phase B run the
> §7.31/§7.51 check: `curl` the deployed `admin.swimsync.sg` bundle and grep for a string only
> the new copy has. **Pass = the string is present. A 200 proves nothing.**

### B4. Verify

`npm test` (vitest) · `npm test` (jest-expo) · `npm run typecheck` **both apps** ·
`check-fixture-roundtrip.sh` · `verify-admins.mjs` · a browser pass over the Attendance page
with a substitute and a shadow seeded, and over the Admins delete refusal.

---

## Pre-commit gate

Walk these before committing. **A box that cannot be ticked is a blocker, not a caveat.**

**The three that matter most:**

- [ ] **RISK 1** — `grep -n "coach_id" SwimSyncAdmin/lib/lessonAttribution.ts` shows **no**
      reference to `classes.coach_id`; the ordinary case resolves through `class_rates`.
- [ ] **RISK 2** — `wages/page.tsx` no longer computes its own attribution, and the
      substitute-beats-shadow assertion passes with `"substitute"`.
- [ ] **RISK 3** — pgTAP refuses the delete **with the audit row present**, the message is
      pinned, and the whole suite was proven red by reverting the migration.

**The rest:**

- [ ] **RISK 4** — inactive classes reach the pre-flight, or the prohibition is honoured and
      the divergence is filed in `BACKLOG.md`.
- [ ] **RISK 5** — the ended-month clamp-equivalence assertion ran, and **which way it went is
      recorded in this file**; the count line does not move on a pre-`from` session.
- [ ] **RISK 6** — every new load asserts `< 1000` and degrades to "—".
- [ ] **RISK 7** — no bare `?? []` on the three new results.
- [ ] **RISK 8** — `verify-admins.mjs` updated in the same commit and re-run green.
- [ ] **RISK 9** — filter and sort keyed by **id**; the zero-roster fixture renders identically
      to today.
- [ ] **RISK 10** — `CREATE OR REPLACE` only; DOWN bodies captured from `\sf` on the remote;
      `anon` EXECUTE still **18**.
- [ ] **RISK 11** — the `audit_log` refusal reads as a sentence, not a table name.
- [ ] **RISK 12** — deployed bundle grepped for a new-copy string.

---

## Graduating

**§7.18's family gains a fourth member** if item 1 ships with the wages loop still in place —
so if RISK 2 is deferred rather than done, that belongs in `docs/GOTCHAS.md` as its own
number, not only here.

Two findings look durable enough to graduate at `/update-docs` regardless of how the work
lands, because a plan file is discarded and §7 is read every session:

- **The ACCESS/MONEY axis split is a repo-wide trap, not a wages-page detail.** It is stated
  in two file headers and was still missed by a plan written with both open. A §7 entry naming
  `classes.coach_id` as the wrong answer to "who taught this lesson" would have caught it.
- **A suite can test only the one record with no history.** Both the pgTAP and the Playwright
  coverage of admin deletion exercise a profile that has never acted — so a change to what
  "has recorded activity" means passes both. That is a shape worth naming.
