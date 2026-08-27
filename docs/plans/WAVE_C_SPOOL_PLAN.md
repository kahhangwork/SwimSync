# Wave C S-pool — sequenced plan

_Planned 2026-08-27 via `/plan-with-confidence` (decisions below are the user's answers) +
`/plan-review` (risk mitigations — the full blocks live inline in each `BACKLOG.md` item body;
the load-bearing ones are restated here next to the step they govern, marked `⚠`)._

## Decisions (settled with the user — do not re-litigate)

| Decision | Answer |
|---|---|
| Scope | All five pool items, sequenced below |
| Filtering/search surface | **High-traffic tables only** — Students, Attendance, Invoices, Credit Notes, Classes, Packages; the rest stay sort-only |
| Skills grading | **Graded**, on a **per-tenant custom scale** (admin-editable labels), seeded default *Developing / Competent / Mastered* |
| "Done" for the n-of-m summary | **Top grade = done** — a skill counts when it holds the highest rank in the tenant's scale |
| Level change | **Keep records, show current level's list** — nothing is ever deleted; moving up and back loses nothing |
| Grade-scale edits | Rename freely; **deleting/resizing a level in use is refused structurally** (FK `RESTRICT` from progress rows) — planner's call, veto before Piece 4 |

Risk ranking (from `/plan-review`, most→least): move-student · skills · filtering/search ·
family-status scan · email copy. Sequence below is the user's value order, not the risk order.

_Second pass (fable, 2026-08-27): ranking confirmed against code — and sharpened. Move-student
is riskier than the first pass knew: the RPC it edits is **broken in production today** for any
levelled student (see the CORRECTION in Piece 3). Skills' top risk is not the grants but a
cross-tenant reference hole RLS cannot see (Piece 4 step 1a). Filtering's top risk is that the
planned `.ilike` pushdown does not work on joined columns without `!inner` (Piece 1 step 1)._

---

## Piece 1 — Better filtering & search (S, ~half a day incl. Piece 2)

Search box + per-table filters on the six high-traffic tables. No migration, no engine — apps-only deploy.

1. Add a shared search helper in `SwimSyncAdmin/lib/` that pushes the term into the Supabase
   query (`.ilike` on the table's text columns).
   **⚠ RISK 3:** PostgREST `max_rows = 1000` truncates SILENTLY — no `.filter()`-in-JS search
   over a fetched list. If any client-side search is unavoidable, gate it on the UNFILTERED
   fetch count and refuse when capped (the CSV cap-block pattern).
   **⚠ RISK (fable) MITIGATION — CORRECTION: bare `.ilike("col", …)` only works for columns on
   the BASE table, and most of what a user searches here is JOINED** (attendance → student name
   via `students!inner(full_name)`; invoices/credit-notes → parent name via embeds). Two rules,
   both structural:
   - An `.ilike` on an embedded column filters the parent row **only when that embed is
     `!inner`**. Without `!inner` the parent rows all come back with `null` embeds — a silent
     WRONG answer, worse than the cap. The helper must take the embed path AND assert/apply
     `!inner` on it; it may not accept a bare column name for a joined field.
   - The attendance page already does this correctly (`ROW_LIMIT = 1000`, `!inner` embeds,
     embedded `.order`/`.gte` — `attendance/page.tsx` ~228–246). **Extend that query; never
     write a parallel one.** The other five pages have NO explicit limit — they are already
     silently capped at 1000 by PostgREST, so the pushdown is a live fix there, not future-proofing.
   **Assertion:** one vitest per searched-joined-column proving a non-matching row is EXCLUDED
   (not returned with a null embed) — this is the test that fails when `!inner` is forgotten.
2. Per-table filters on the six tables. **⚠ Prohibition:** every filter keys on **id, never
   display title** (two classes can share a name — the Attendance precedent).
3. Reuse `lib/tableSort.ts` comparisons — never a second comparison.
   **Assertion:** the `tableSort.ts` vitest count is unchanged before/after.
4. Vitest for the search/filter helpers, proven RED without the code (§7.25). `npm run typecheck`.

## Piece 2 — Family-status scan fix (S, bundled into Piece 1's session)

Same disease as Piece 1, so fix it in the same pass: `handleFamilySearch` on
`app/(admin)/platform/page.tsx` fetches ALL `parent_tenants` and filters in JS.

1. Push the term into the query (`.ilike`). The page already reads `parent_tenants` under the
   platform admin's RLS, so **prefer the pushdown over a new RPC** — a new function is callable
   by NOBODY until granted (§7.87) and is only needed if the pushdown can't express the search.
   **⚠ RISK (fable) MITIGATION — CORRECTION: the search is over TWO fields TWO embeds deep**
   (`parent_tenants → parents → profiles`, matching `full_name` OR `email` —
   `platform/page.tsx:405–419`), so a plain `.ilike` cannot express it. The pushdown shape is:
   `select("…, parents!inner(profile_id, profiles!inner(full_name, email))")` +
   `.or("full_name.ilike.*<q>*,email.ilike.*<q>*", { referencedTable: "parents.profiles" })` —
   both embeds `!inner`, or non-matching memberships return with null embeds (Piece 1's trap).
   **Named prohibition — `.or()` string injection:** the term is interpolated into PostgREST's
   or-grammar, where `,` `(` `)` and `%`/`*` are syntax. A name containing a comma breaks the
   query (or worse, changes it). Sanitise/escape the term in the shared helper (vigilance only —
   no structural fix exists for the or-string syntax; if escaping proves unreliable, THAT is the
   trigger for the RPC fallback, which then follows RISK 4's grant steps in the backlog item).
2. **⚠ Assertion:** parity with the old client filter — same case-insensitive substring
   semantics, one vitest running both shapes over the same fixture rows.
   **⚠ RISK (fable) addition to the same vitest:** hostile-term cases — a term containing
   `,`, `(`, `%` and a `*` must either match literally or refuse cleanly; it must never throw
   or silently return everything. Also cover the second query (`parent_students` `.in(...)`):
   it is uncapped too, but is now bounded by the matched set — assert the fixture keeps it so.

## Piece 3 — Move-student loose ends (S, one session — RISKIEST, §7.123/§7.57 country)

`reassign_student_tenant(uuid, uuid)` gets its two silent ends fixed. Migration → apps, via `/deploy`.

0. **⚠ RISK (fable) MITIGATION — CORRECTION: the RPC is broken in production TODAY for any
   student with a level.** `trg_student_level_tenant` (`20260719001800`, `BEFORE INSERT OR
   UPDATE OF level_id, tenant_id ON students`) raises `'That level belongs to a different
   business.'` whenever `tenant_id` changes while `level_id` still points at tenant A's ladder —
   and the RPC updates `tenant_id` without clearing `level_id`. SECURITY DEFINER does not skip
   triggers, and this trigger has no role carve-out. **Step:** the rewrite sets
   `level_id = NULL` alongside `assignment_status = 'unassigned'` (same rationale: tenant A's
   vocabulary means nothing at B; the admin at B re-levels). **Assertion (pgTAP):** moving a
   LEVELLED student succeeds and lands unlevelled — this test is RED against the current
   function body by construction, the cleanest §7.25 proof in the whole wave. Verify the
   deployed body with `pg_get_functiondef()` before editing, not from the migration (§7.115).
1. **⚠ Keep the signature `(uuid, uuid)` and the return type** (verified: `RETURNS VOID`,
   SECURITY DEFINER, single definition in `20260719000200`) — same-signature
   `CREATE OR REPLACE`, no grant dump (§11.32). The credit warning therefore lives
   **client-side**: the admin panel checks the family's balance at tenant A *before* calling
   the RPC and shows an advisory confirm ("credit stays at A and becomes unspendable —
   continue?"). If a signature change ever looks necessary, STOP and run
   `grep -rn '\.rpc(' SwimSyncApp SwimSyncAdmin` first (§7.123).
   **⚠ RISK (fable):** the balance read works — `parent_tenant_balances_select` grants
   `is_platform_admin()` (verified, `20260813000300`) — but must cover **every** linked
   parent (see step 2), summed per parent; a one-parent assumption under-warns.
2. Inside the RPC: write the `parent_tenants` membership at tenant B **if missing** — the
   parent can already be joined at B via another child. **⚠** Check `parent_tenants` for
   triggers before reaching for upsert semantics: a `BEFORE INSERT` trigger also fires for
   upsert-resolved UPDATEs (§7.57).
   **⚠ RISK (fable) MITIGATION — the §7.57 fear is REFUTED, and the real trap is different.**
   Verified: the only trigger on `parent_tenants` is `trg_guard_parent_offboard`
   (`20260822000200`) — `BEFORE UPDATE`, `WHEN (OLD.is_active AND NOT NEW.is_active)` — so a
   plain INSERT fires nothing, and an upsert cannot trip it (a move never deactivates). The two
   cases the plan actually missed:
   - **"The parent" is 0..N parents.** `parent_students` is many-to-many, and an admin-created
     child may have NO linked parent at all. The membership write iterates every linked parent
     and is a clean no-op for zero. **Assertion (pgTAP):** two-parent student → two memberships
     at B; zero-parent student → move succeeds, no membership row.
   - **Exists-but-INACTIVE membership at B** (a previously offboarded family — `is_active`
     exists on `parent_tenants`, default TRUE). Insert-if-missing leaves the family invisible
     at B: the child moves, the pickers and billing grouping filter on `is_active`. The RPC must
     handle it explicitly — reactivate on move (the rescue-tool semantics; reactivation does not
     fire the offboard guard) — and a pgTAP case pins whichever way it lands. Silently skipping
     this case is the same silent end this piece exists to close.
3. **⚠ Prohibition:** the warning is ADVISORY — do NOT move credit (never crosses businesses,
   PRD §5.6) and do NOT grow the rescue tool toward "move everything".
4. pgTAP proven RED without the fix (§7.25): membership written at B · already-joined case is a
   no-op · isolation at A intact. Vitest for the balance-check + dialog.
5. **⚠** The tool is dormant — exercise the whole flow once in the local UI (Platform page)
   before deploying, so production's first firing isn't THE first firing.

## Piece 4 — Swim skills, graded (M, 1–2 sessions — new table + new coach write surface)

All four product decisions are settled (table above). Migration authored in the ROOT checkout
on a `db/…` branch, **one in flight** (§7.55).

1. **Migration** (one file): `skill_grade_levels` (tenant_id, rank, label — seeded per tenant
   with the 3-stage default, mirroring the Default-location-per-tenant seed pattern) +
   `student_skill_progress` (tenant_id, student_id, skill_id, grade_level_id FK **ON DELETE
   RESTRICT**, graded_by, graded_at). The RESTRICT is the structural guard: a level in use
   cannot be deleted; renames are free.
   **⚠ RISK 2:** policy AND the matching GRANT in the SAME migration (§7.87); extend
   `table_grants.test.sql`'s whitelist deliberately; budget the remote grant dump after
   deploy (§7.39/§7.89, DEPLOYMENT §11.7).
   **⚠ Prohibition:** do NOT widen `students_update` — this table exists so that grant is
   never touched.
   **⚠ RISK (fable) MITIGATIONS — three holes in the table shape as planned** (existing model
   verified: skills live in `tenant_level_skills` keyed by `level_id` → `tenant_levels`
   (per-tenant); the child's current level is `students.level_id`, nullable, `ON DELETE SET NULL`):
   - **1a. Cross-tenant reference hole — structural guard required.** RLS cannot see cross-table
     consistency (the exact lesson `20260719001800` records for `students.level_id`): a coach's
     row could pair their student with ANOTHER tenant's `grade_level_id`, or a `skill_id` from a
     different tenant's ladder. Add a `BEFORE INSERT OR UPDATE` trigger on
     `student_skill_progress` mirroring `enforce_student_level_tenant()`: the skill's tenant
     (via its level) AND the grade level's tenant must both equal the student's tenant.
     **Assertion (pgTAP, RED first):** a row referencing another tenant's grade level or skill
     is refused even for an otherwise-authorised writer. Note §7.57 applies to this trigger by
     construction — it must be a pure validation (no INSERT-only assumptions) so upsert-resolved
     updates are governed identically.
   - **1b. `skill_id` deletion semantics — decide, don't inherit.** `tenant_level_skills`
     CASCADE-deletes when its level goes, and the EXISTING admin levels editor deletes skills
     and levels today. A default/CASCADE FK on `skill_id` silently erases children's earned
     records (violates the keep-records decision); therefore `skill_id` FK is **ON DELETE
     RESTRICT**, mirroring the settled grade-level call. Consequence to build, not discover:
     the existing levels page's skill-delete and level-delete now REFUSE when progress exists —
     surface both as the same friendly message as the scale editor's (step 5), and pgTAP both:
     in-use skill/level delete refused · unused ones still deletable.
   - **1c. The upsert key.** `UNIQUE (student_id, skill_id)` in the same migration — it is the
     grading write's `onConflict` target, and without it the tap-cycle UI inserts duplicates
     and every n-of-m count double-counts. **Assertion (pgTAP):** second grade for the same
     (student, skill) replaces, never adds.
   - **1d. Seed must cover FUTURE tenants.** "Mirroring the Default-location seed pattern"
     must include the on-tenant-creation half, not just the backfill. **Assertion (pgTAP):** a
     tenant created AFTER this migration has the 3 default grade levels.
2. **Policies:** coach writes progress only for a child in a class they teach (per-student
   predicate — `coach_serves_student`-shaped is deliberate here, unlike
   `close_student_enrolment`'s per-class rule; record why in the migration comment) · parent
   reads own children · admin manages the scale.
   **Assertion (pgTAP, proven RED first, §7.25):** cross-tenant write refused · coach can't
   grade a child not in their classes · parent is read-only.
3. **Coach UI** (`SwimSyncApp`): class roster → per-child skill list for the child's CURRENT
   level, tap cycles/selects grade. Fetch per class, not per student (36-row note in the
   backlog item). Jest.
   **⚠ RISK (fable):** `students.level_id` is NULLABLE — unlevelled children are common
   (level deletion SET-NULLs it, and Piece 3 now nulls it on every cross-tenant move). Both
   the coach and parent views need an explicit "no level set" empty state; a jest case each,
   proven against a null-level fixture. **Named prohibition:** the grading write's failure
   surface must NOT be `Alert.alert` — it is a silent no-op on RN-web (CLAUDE.md); use
   `confirmAction` / Toast / inline, and the "top grade = done" count is computed from
   `MAX(rank)` at read time, never stored as a boolean (adding a level must retroactively
   re-open skills, per the settled top-grade-is-done semantics).
4. **Parent UI:** child view shows "n of m at <top grade label>" + per-skill grades, current
   level only. Jest.
5. **Admin UI** (`SwimSyncAdmin`): minimal scale editor — rename labels, add a level; delete
   surfaces the FK refusal as a friendly message. Vitest.
   **⚠ RISK (fable) MITIGATION — CI page-count pin.** `verify-platform-admin-scope.mjs` pins
   the sidebar at exactly **24 business pages** (line ~145) and enumerates `TENANT_PAGES`.
   Structural avoidance: host the scale editor on the EXISTING `/levels` page (it is the same
   audience and data family) — no new route, pin untouched. If a separate route is ever chosen
   instead, `TENANT_PAGES` and the 24-count bump in the SAME commit as the page. Either way the
   levels page changes, so run the levels-table UI driver (`fixtures-levels-table.sql` pair)
   locally before merge, plus 1b's refusal paths by hand.
6. Deploy: migration → (no engine — `core.ts` untouched) → apps last, via `/deploy`.

## Piece 5 — Email-confirmation copy (S, ~1h, anywhere it fits)

1. Author the branded confirmation template following `supabase/templates/recovery.html`;
   wire it in config.
   **⚠ RISK (fable):** `config.toml` governs LOCAL auth only — the hosted project's template
   and confirmation flag live in the Supabase dashboard / `supabase config push`. If this piece
   pushes config to the hosted project, diff what ELSE a config push would change first and
   push nothing beyond the template wiring; the stranding toggle lives in that same config
   surface (vigilance only — no structural guard exists over a dashboard/config push).
2. **⚠ Prohibition:** do NOT switch email confirmation ON to test — it stranded web parents
   once; that is why it is off. Render locally.
3. **Assertion:** after the work, the auth config still has confirmation OFF — read BOTH
   `config.toml` (`enable_confirmations = false`, two occurrences) AND the hosted project's
   setting, not memory.

---

## Pre-commit gate (walk per piece; a box that can't be ticked is a blocker)

- [ ] New tests proven RED without the fix (§7.25) ← highest value
- [ ] Schema/privileges touched → policy + GRANT in the SAME migration (§7.87), `supabase test db` green, grant dump budgeted (§7.39/§7.89) ← highest value
- [ ] RPC signature unchanged, or `\.rpc(` grep run and every caller walked (§7.123)
- [ ] No `.filter()`-in-JS search over a fetch that can hit `max_rows = 1000`
- [ ] *(fable)* Every `.ilike` on a JOINED column rides an `!inner` embed, and the excluded-not-null-embed vitest exists per searched join
- [ ] *(fable)* Piece 3 pgTAP includes the LEVELLED-student move (RED against today's function body) and the zero/two-parent + inactive-membership cases
- [ ] *(fable)* New cross-table references (`skill_id`, `grade_level_id`) carry a tenant-consistency trigger with pgTAP proven RED — RLS alone cannot see them
- [ ] *(fable)* Admin sidebar page count: no new route, or `verify-platform-admin-scope.mjs`'s `TENANT_PAGES` + 24-pin bumped in the same commit
- [ ] `/deploy` before any backend push (migrations first, apps to `main` last)
