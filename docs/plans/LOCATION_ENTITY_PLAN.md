# Location Entity — Implementation Plan

_Status: BUILT 2026-08-24 on branch `db/location-entity` (not committed yet). Phases 0–5 DONE
+ all suites green locally: pgTAP **1445**, admin vitest **539**, app jest **404**, Deno **236 ×2**
(expand AND contract schemas), both typechecks clean, UI driver `verify-locations` **6/6** against
the real browser. The CONTRACT migration (column drop) is written, PROVEN locally, and HELD as
`.hold` — it lands LAST at deploy and needs the fixture/seed sweep documented in its header.
**Phase 6 (prod deploy) is NOT done — hand to `/deploy`.**

Deliverables:
- Migrations: `20260824000100_locations_entity_expand.sql` (+ rollback), `20260824000200_..._contract.sql.hold`.
- Tests: `supabase/tests/locations.test.sql` (17), `SwimSyncAdmin/lib/locationOptions.test.ts`,
  `SwimSyncApp/lib/locationFilter.test.ts`, `stranger_isolation`/`adminNav` controls updated,
  Deno helpers now insert `location_id`, driver `verify-locations.mjs`.
- Admin: `/locations` CRUD page + nav; classes form/list wired to the entity; calendar/lessons repointed.
- Mobile: coach classes/schedule/roster repointed + coach location filter; parent home + child (address/notes).

### Deploy sequence for Phase 6 (run `/deploy`)
1. **Expand migration → prod** (`supabase db push`; it applies `20260824000100`, NOT the `.hold`).
2. **Grant dump** after (new table + changed function signature — §7.39/§7.89).
3. **Apps → `main`** (Vercel builds both). Verify the served bundles no longer `.select()` the free-text
   columns (they don't) and the `/locations` route chunk shipped.
4. **The column drop is a SEPARATE later change:** do the fixture/seed sweep (contract header lists it),
   land it on the db branch green, THEN rename `.hold`→`.sql` and push it LAST. Until then the entity is
   already the single source of truth (app writes only `location_id`; the trigger mirrors the columns).

## Goal

Promote the free-text `classes.location_name` into a per-tenant **`locations`
entity** (name + address + notes), admin-managed with CRUD, referenced by a
required FK from every class. Add location filters to the admin Classes page,
repoint the existing admin Calendar/Lessons location filter at the entity, and
add a net-new location filter to the coach mobile app. Drop the free-text
columns. Mirror the existing `tenant_levels` pattern throughout.

## Decisions locked with the user

- **Fields:** location holds `name` (required, unique per tenant), `address`, `notes`.
- **Single source of truth:** class points at a location by FK. The free-text
  `classes.location_name` / `classes.location_address` columns are **dropped**.
- **Required:** `classes.location_id` is NOT NULL for every class (active and retired).
- **Coach app filter:** build now (net-new UI).
- **Parent app:** no filter. Show location clearly — name on the home class
  card, name + address + notes on the child-detail page.
- **Delete = archive.** "Delete" sets `locations.archived_at`. Blocked only when
  an **active** class references it; retired classes are ignored. Archived
  locations vanish from the manage list, the class-form picker, and all filters.
  The row physically remains so retired classes keep a valid FK (reactivate never
  breaks) and still display their old location. Partial-unique
  `(tenant_id, name) WHERE archived_at IS NULL` lets a name be reused after archiving.

## Why archive instead of hard delete

A hard delete would force nulling the retired classes' `location_id`. Reactivating
one of those later would then need a location — but `reactivate_class()` **must
never grow a refusal** (HANDOVER prohibition; it is the only exit from retirement).
Archiving sidesteps this: `location_id` stays NOT NULL for everyone, the FK stays
valid, and reactivate is untouched.

## Existing surface (from codebase exploration)

- `classes` already has `location_name` (NOT NULL) + `location_address` (nullable, unused).
  Base def `supabase/migrations/20260309000100_initial_schema.sql:103-104`.
- Mirror template for a per-tenant lookup: `tenant_levels`
  (`supabase/migrations/20260719001800_tenant_levels.sql` — table + RLS + grants +
  cross-tenant enforce trigger) and its CRUD page `SwimSyncAdmin/app/(admin)/levels/page.tsx`.
- Cross-tenant FK guard to copy: `enforce_class_category_tenant()`
  (`20260720000100_lesson_packages.sql`).
- Helpers: `is_platform_admin()`, `current_tenant_id()`, `can_admin_tenant()`,
  `parent_in_tenant()` (`20260718000900_tenant_rls.sql`); `coach_owns_class()`
  (`20260309000600_rls_policies.sql`).
- Grants whitelist enforced by `supabase/tests/table_grants.test.sql` — a new table
  is auto-covered **iff** its migration includes both a policy and the matching GRANT.
- Class create = direct insert `classes/page.tsx:559`; edit = `set_class_terms` RPC
  (`20260719001000_set_class_terms.sql`) + a direct `.update` for category/capacity/colour.
- Admin location filter already exists on Calendar + Lessons, derived from free text:
  `lib/calendarLessons.ts:520` (`locationOptions`), `lessons/page.tsx:177` (`<select>`).
- Mobile reads `location_name` in 5 places: coach classes/schedule/roster, parent
  home + child detail. Coach location comes via the `classes_select` RPC.

  > **⚠ RISK 5 MITIGATION (correction — the line above is wrong).** `classes_select`
  > is an RLS **policy** on `classes` (`20260811000200_session_coach_roster.sql:271`),
  > not an RPC; there is no location RPC to extend. Every mobile read is a direct
  > PostgREST `.select()` on `classes`. The 5 files: coach `schedule/index.tsx`
  > (`CLASS_SELECT`), coach `classes/index.tsx`, coach `classes/[id]/roster.tsx`,
  > parent `home/index.tsx`, parent `home/child/[id].tsx`. Admin also has read sites
  > Phase 2.1 does not list: `lib/calendarData.ts:42`,
  > `app/(admin)/lessons/[classId]/[date]/page.tsx:145,509`, `classes/page.tsx:321`.
  > These lists are a starting inventory only — the Phase 3 grep is the completeness
  > gate (§7.142: grep for the pattern, then sanity-check it against one known site).
- **Billing engine does NOT read location** in production logic — only Deno
  test-helpers insert `location_name` because the column is NOT NULL. No engine
  version bump; test helpers switch to `location_id` when the column is dropped.

## Phase 0 — Expand migration (`db/…` branch, land on main FIRST)

1. New `locations` table mirroring `tenant_levels`: `id`, `tenant_id` (FK, ON DELETE
   CASCADE), `name` TEXT NOT NULL, `address` TEXT, `notes` TEXT, `sort_order` INT,
   `archived_at` TIMESTAMPTZ, partial-unique `(tenant_id, name) WHERE archived_at IS NULL`.
   ENABLE RLS. SELECT policy (`is_platform_admin OR current_tenant_id OR parent_in_tenant`),
   write policy (`can_admin_tenant`). `GRANT SELECT,INSERT,UPDATE,DELETE … TO authenticated`
   + `GRANT ALL … TO service_role`.

   > **⚠ RISK 4 MITIGATION (assertion).** Coaches reach `locations` only through
   > `current_tenant_id()` (= `profiles.tenant_id`), and mobile fetches it as an
   > **embedded join** from `classes` — under RLS an invisible joined row comes back
   > as `location: null` with **no error**, so a policy gap shows as silently blank
   > screens, not `permission denied`. Pass/fail assertion, in pgTAP: selecting
   > `classes` with the embedded `locations` row **as a coach role and as a parent
   > role** returns a non-null location (fail = null). `table_grants.test.sql`
   > assertion 1 auto-covers the GRANT only if policy and grant land in the same
   > migration — keep them together (§7.87). After `db push`, take the remote grant
   > dump — local and cloud disagree by construction (§7.39, §7.89).

   **1b. Archive enforcement lives in the DATABASE (new step).**

   > **⚠ RISK 6 MITIGATION (structural).** The "blocked while an **active** class
   > references it" rule must not exist only in the admin page: the `locations`
   > write policy is `can_admin_tenant`, so any admin API call can set `archived_at`
   > directly, bypassing the page's pre-check entirely — the §7.143 shape ("every
   > writer includes PostgREST"). Add a `BEFORE UPDATE OF archived_at ON locations`
   > trigger that refuses the NULL→NOT NULL transition while
   > `EXISTS (SELECT 1 FROM classes WHERE location_id = NEW.id AND is_active)`.
   > The Phase 1 page pre-check is then UX only. pgTAP proof: a direct
   > `UPDATE locations SET archived_at = now()` as a tenant admin, with an active
   > referencing class, must throw (proven RED by removing the trigger, §7.25).
2. Add `classes.location_id` **nullable** FK → `locations(id)` ON DELETE RESTRICT.
   Add `enforce_class_location_tenant()` trigger (copy of `enforce_class_category_tenant`).
3. **Backfill in the same migration:** insert one location per distinct
   `(tenant_id, location_name)` (address from `location_address` where present), then
   set every `classes.location_id`. Assert zero NULL `location_id` afterward.

   > **⚠ RISK 3 MITIGATION.** This backfill runs against real prod names, and three
   > concrete traps each abort the migration mid-deploy or fabricate wrong entities:
   > (a) `classes.location_name` is NOT NULL but has **no CHECK** — `''`/whitespace
   > values are legal (the `locationOptions` test exercises `' '`); if `locations.name`
   > mirrors tenant_levels' `CHECK (length(trim(label)) > 0)`, the INSERT aborts.
   > (b) Names differing only by whitespace (`'Clementi '` vs `'Clementi'` — the exact
   > pair `calendarLessons.test.ts:401` tests) must collapse to ONE location or the
   > partial-unique index rejects the second insert. (c) One name can carry two
   > different `location_address` values across classes — the insert must pick one
   > deterministically. Therefore, structurally: group by
   > `(tenant_id, trim(location_name))`, map blank-after-trim to the literal
   > `'Unspecified location'`, take `min(location_address)` over non-null values.
   > **Pre-flight (concrete step, before writing the migration):** run read-only
   > against PROD: `SELECT tenant_id, trim(location_name), count(*),
   > count(DISTINCT coalesce(location_address,'')) FROM classes GROUP BY 1,2;` —
   > every surprise found here is a failed prod migration avoided.
   > **Assertions (pass/fail), inside the migration:**
   > `count(*) FROM classes WHERE location_id IS NULL` = **0**, and
   > `count(*) FROM locations WHERE length(trim(name)) = 0` = **0**.

   **3b. Sync trigger for the expand window (new step).**

   > **⚠ RISK 2 MITIGATION (structural).** Between this migration landing on prod
   > and the new apps deploying, the OLD admin bundle still **creates** classes with
   > only `location_name` and still **edits** through the old `set_class_terms` args —
   > every such write leaves `location_id` NULL or pointing at the WRONG location.
   > The Phase 4 `SET NOT NULL` then fails on prod, or worse seals a silently wrong
   > location onto a real class. Make divergence impossible rather than hoping the
   > window is short: add a `BEFORE INSERT OR UPDATE OF location_name ON classes`
   > trigger (expand-only; the contract migration drops it with the columns) that
   > resolves `location_id` from `(tenant_id, trim(location_name))`, creating the
   > location if missing. `SECURITY DEFINER SET search_path = public` — it reads and
   > inserts `locations` across RLS from whatever role touched `classes` (§7.125
   > family). Note §7.57: BEFORE INSERT also fires for upsert-resolved updates —
   > the resolve-or-create logic is idempotent, so that is safe here, but keep it so.
   > The contract migration additionally **re-runs the backfill idempotently and
   > re-asserts NULL-count = 0 before `SET NOT NULL`** — the assert is the gate,
   > this trigger is why it passes.
4. Extend `set_class_terms` RPC with `p_location_id` (write `location_id`).

   > **⚠ RISK 7 MITIGATION.** Adding `p_location_id UUID DEFAULT NULL` via
   > `CREATE OR REPLACE` does **not** replace the current 11-arg function — it
   > creates a SECOND `pg_proc` row and PostgREST can keep calling the old body
   > (§7.124). Concrete steps, in order: `DROP FUNCTION public.set_class_terms(
   > uuid, text, day_of_week, time, time, text, numeric, uuid, date, boolean, text)`
   > first; create the 12-arg form with `p_location_id UUID DEFAULT NULL` **appended
   > last**; assert exactly **1** row for the name in `pg_proc` (pass/fail); then
   > re-`REVOKE`/`GRANT` — the new signature is a new row and is callable by nobody
   > until granted (§7.87). The default is what keeps the live admin working through
   > the window: `classes/page.tsx:544` is the only `.rpc("set_class_terms")` caller
   > (verified with the `\.rpc(` pattern per §7.142 — mobile has none), and §7.123's
   > test is "the surviving signature must be callable with the OLD argument list".
   > pgTAP callers (`class_terms.test.sql`, `class_shadow_coaches.test.sql`, …) call
   > it POSITIONALLY with 11 args — they keep passing only while the new param stays
   > LAST. **Named prohibition: `p_location_id` goes at the end of the signature,
   > and the 11 existing parameters keep their order and names.**
5. Keep `location_name`/`location_address` (Phase 4 drops them).
6. `supabase test db` + rollback rehearsal (run the DOWN), then land on main.

## Phase 1 — Admin: manage locations + wire the class form

1. New `SwimSyncAdmin/app/(admin)/locations/page.tsx` modeled on `levels/page.tsx`
   (direct insert/update + sort-order reorder). **Delete = archive:** pre-check the
   **active** referencing-class count; if >0 block with a friendly message, else set
   `archived_at`. Archived rows hidden everywhere.

   > **⚠ RISK 6 MITIGATION (continued).** The pre-check here is UX only; the Phase 0
   > step 1b trigger is the enforcement. **Named prohibition: do not skip the trigger
   > because the page checks** — the page is one writer of several.
2. Add **Locations** to the admin nav.
3. `classes/page.tsx`: replace the free-text location `<input>` with a `<select>` of
   the tenant's non-archived locations; thread `location_id` through the create insert
   and the `set_class_terms` call.

   > **⚠ RISK 6 MITIGATION (edit trap).** A retired class can be reactivated while
   > its location is archived — `reactivate_class()` takes no refusals and must not
   > grow one for this (standing prohibition). When the class form opens on such a
   > class, a picker built only from non-archived locations cannot represent its
   > current value, and saving would silently move the class or wedge the form.
   > Concrete step: the picker **always includes the class's current location**,
   > labelled "(archived)", even when archived; only the set of NEW choices is
   > filtered to non-archived.
   >
   > **⚠ RISK 1 MITIGATION (forward compatibility).** Through the expand window the
   > 12-arg `set_class_terms` still requires `p_location_name` (no default). The new
   > admin sends **both** `p_location_id` and `p_location_name` (the picked
   > location's name, so the two columns agree) until the Phase 4 contract redefines
   > the function. Same for the create insert: write both `location_name` and
   > `location_id` while the free-text column is still NOT NULL.
4. Add a location `<select>` filter to the Classes list (reuse lessons-page pattern).

## Phase 2 — Repoint read sites + coach filter

1. Admin `lib/calendarLessons.ts` + calendar/lessons pages: read joined location
   (name/id); key the filter `<select>` off `location_id`; options = non-archived locations.

   > **⚠ RISK 5 MITIGATION (completeness).** Also repoint the admin sites the plan
   > originally missed: `lib/calendarData.ts:42` and
   > `app/(admin)/lessons/[classId]/[date]/page.tsx` (select at 145, display at 509),
   > plus the classes list select at `classes/page.tsx:321`. Filter-option nuance:
   > options = non-archived locations **plus any archived location still referenced
   > by a lesson in the visible range**, or historical lessons at an archived
   > location become unfilterable — decide explicitly, don't inherit it from the
   > picker's rule.
2. Mobile reads (5 sites): embed `locations(name, address, notes)` in each file's
   direct `.select()` on `classes` (see the RISK 5 correction above — `classes_select`
   is a policy and needs **no change**; there is no RPC to extend).
3. **Coach filter (net-new):** location picker on coach classes + schedule screens.
4. **Parent display:** keep name on the home card; expand the child-detail "Location"
   row to name + address + notes.

## Phase 3 — Verify apps no longer read the free-text columns

Grep both apps for `location_name` / `location_address`; every read must now go through
the entity. Gates Phase 4.

> **⚠ RISK 1 MITIGATION (gate, pass/fail).** The exact command:
> `grep -rn "location_name\|location_address" SwimSyncApp SwimSyncAdmin --include=*.ts --include=*.tsx | grep -v node_modules`
> must return **0 hits in app code** (the Deno helpers under `supabase/functions/`
> are Phase 4's job). Per §7.142, sanity-check the grep against one call site you
> know exists (e.g. temporarily re-add one) before trusting an empty result —
> silence from grep is indistinguishable from absence.

## Phase 4 — Contract migration (`db/…` branch, lands LAST)

1. Set `classes.location_id` NOT NULL; drop `location_name` + `location_address`.

   > **⚠ RISK 1 MITIGATION — this phase can break every screen at once, in two ways
   > the original plan missed:**
   >
   > **(a) `set_class_terms` still writes the dropped columns.** Its current body
   > (`20260812000200_class_shadow_coaches.sql:1014`) does
   > `SET location_name = p_location_name, location_address = p_location_address`.
   > Dropping the columns without redefining the function breaks **every class edit
   > in prod** with a runtime "column does not exist". Concrete step: the contract
   > migration MUST redefine `set_class_terms` to stop touching those columns.
   > **Named prohibition: keep `p_location_name`/`p_location_address` in the
   > signature as accepted-and-ignored parameters through this deploy** — removing
   > them changes the named-argument set the deployed admin sends and reopens
   > §7.123; drop the dead parameters in a later cleanup migration once no deployed
   > bundle sends them. Same-signature redefinition = plain `CREATE OR REPLACE`,
   > no re-grant needed; a changed signature would re-trigger the RISK 7 steps.
   >
   > **(b) A deployed app whose `.select()` names `location_name` gets a PostgREST
   > 400 on the WHOLE query** — coach schedule/classes/roster and parent home/child
   > go blank, not merely locationless. Gate (pass/fail): before applying the
   > contract, grep the SERVED bundles of swimsync.sg and admin.swimsync.sg for
   > `location_name` — must be **0 hits** (§7.31/§7.51: a 200 proves nothing).
   > Stale already-open tabs still break until refresh — accepted; note it in
   > HANDOVER at deploy time.
   >
   > **Structural hold-back:** the contract migration file must not exist under
   > `supabase/migrations/` until gates (a) and (b) pass — keep it in `docs/plans/`
   > and move it in as the final step, so a reflexive `supabase db push` cannot
   > ship it early.
   >
   > **⚠ RISK 2 MITIGATION (assertion).** Immediately before `SET NOT NULL`, the
   > contract migration re-runs the Phase 0 backfill idempotently (same
   > trim-and-create logic) and asserts
   > `count(*) FROM classes WHERE location_id IS NULL` = **0** — rows created or
   > edited by the old admin during the window are healed here, not hoped away.
   > It also drops the Phase 0 step 3b sync trigger together with the columns.

2. Update Deno `test-helpers.ts` + the 3 test files that insert `location_name` → `location_id`
   (the helpers must first create a `locations` row per test tenant to reference).

   > **⚠ RISK 7 MITIGATION (continued).** Also update the POSITIONAL pgTAP callers
   > of `set_class_terms` (`class_terms.test.sql`, `class_shadow_coaches.test.sql`,
   > and any grant probe naming its signature) in the same change — a
   > `has_function_privilege()` probe naming a gone signature **errors** and aborts
   > the whole file with a bad plan (§7.124). `grep -rn set_class_terms supabase/tests/`
   > is the caller inventory.

3. `supabase test db` + Deno ×2 + rollback rehearsal.

## Phase 5 — Tests

- **pgTAP:** locations RLS isolation; tenant-guard trigger; archive blocked by active
  class; archive allowed with only retired classes; archived hidden from pickers; name
  reusable after archive; retired class still resolves its archived location; backfill
  correctness. `table_grants.test.sql` auto-covers grants.
- **vitest:** locations CRUD page + classes location filter.
- **jest-expo:** coach location filter.
- **UI driver:** new `verify-locations` (CRUD + refuse-archive-while-active + class
  filter); confirm the calendar/lessons filter driver still passes after repointing.
- Every test proven RED without the fix before it counts.

## Phase 6 — Deploy (run `/deploy`, sequenced — §8.70 expand/contract pattern)

Expand migration → grant dump → apps to main → verify served bundle →
**contract migration LAST** (held back via file-move until apps stopped reading the
dropped columns). Engine unchanged; confirm with `supabase functions list`.

> **⚠ RISK 1 + RISK 2 MITIGATION (deploy-order assertions).**
> - The "verify served bundle" step IS the Phase 4 gate (b): grep both prod bundles
>   for `location_name` = **0 hits** before the contract file moves into
>   `supabase/migrations/`. Not optional, not a spot check.
> - Grant dump after **each** prod push that touches privileges — the expand push
>   changes a function signature and adds a table, so at minimum after it (§7.39,
>   §7.89, `docs/DEPLOYMENT.md` §11.7).
> - Between expand-push and apps-live, the prod DB serves OLD apps against NEW
>   schema. That window is safe **only because of** the defaulted 12th parameter
>   (RISK 7) and the sync trigger (RISK 2) — if either was cut during
>   implementation, stop and restore it before `supabase db push`.

## Pre-commit gate

Walk before committing each phase; the first three are the ones that take
production down if skipped.

- [ ] **(RISK 1a)** Contract migration redefines `set_class_terms` to stop touching
      the dropped columns, keeping `p_location_name`/`p_location_address` as
      accepted-and-ignored parameters (same signature, no re-grant needed).
- [ ] **(RISK 1b)** Served-bundle grep for `location_name` on swimsync.sg AND
      admin.swimsync.sg = 0 hits **before** the contract file enters
      `supabase/migrations/`.
- [ ] **(RISK 2)** Sync trigger in the expand migration; contract re-backfills
      idempotently and asserts `classes WHERE location_id IS NULL` = 0 immediately
      before `SET NOT NULL`. Proven by creating a class via SQL with only
      `location_name` and seeing `location_id` filled.
- [ ] **(RISK 3)** Prod pre-flight distinct-name query ran; backfill groups by
      `trim`, maps blank→'Unspecified location', picks address deterministically;
      both in-migration count assertions present.
- [ ] **(RISK 7)** Old 11-arg signature `DROP`ped before the 12-arg `CREATE`;
      `pg_proc` shows exactly 1 row for the name; new signature re-`REVOKE`/`GRANT`ed;
      `p_location_id` is LAST and defaulted; positional pgTAP callers green.
- [ ] **(RISK 4)** pgTAP asserts coach AND parent roles see the embedded `locations`
      join non-null; `table_grants.test.sql` green; remote grant dump taken after
      each privileged push.
- [ ] **(RISK 6)** DB trigger refuses archiving a location with an active class —
      tested by direct `UPDATE`, not through the page; class-form picker shows the
      current archived location labelled "(archived)".
- [ ] **(RISK 5)** Phase 3 grep = 0 app-code hits, sanity-checked against a known
      call site first; no work was spent "extending the classes_select RPC" (it is
      a policy; the change is the `.select()` strings).
