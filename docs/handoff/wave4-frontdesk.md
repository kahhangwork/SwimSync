# Worktree — Wave 4 lane 2: Front-desk role walkthrough driver

**Branch:** test/front-desk-role · **Base:** main @ 48b61ce · **Started:** 2026-10-05
**Plan:** docs/plans/WAVE4_START_DATE_FRONT_DESK_PLAN.md (Lane 2, 2.0–2.4) · **Backlog:** Wave 4 → Front-desk walkthrough; "A co-admin without pricing access may see NO teaching coach anywhere"

**Sibling:** lane1 = root checkout (`main` / `feat/enrolment-start-date`), landing migration 20261005000100. Lane 1 owns `supabase/` and the admin app's add-to-class modals.
**Shared DB owner:** lane1 owns migrations; lane 2 only loads/tears down its own `fd_` fixture. NEVER `supabase db reset`, NEVER `run-all-drivers.sh --only`.

## I own
- `supabase/` — **NO**
- `.claude/skills/run-ui-playwright/drivers/fixtures-front-desk-role.sql`
- `.claude/skills/run-ui-playwright/drivers/fixtures-front-desk-role-teardown.sql`
- `.claude/skills/run-ui-playwright/drivers/verify-front-desk-role.mjs`
- the nightly list entry in `docs/TESTING.md` for this driver (only that line)

## I must NOT touch
- `HANDOVER.md`, `PRD.md`, `BACKLOG.md`
- `drivers/lib.mjs`, `supabase/config.toml`, `run-all-drivers.sh`
- any migration; anything under `SwimSyncAdmin/` (lane 1 is editing the add-to-class modals)

## Ports
- admin dev server: **3100** (`ADMIN_URL=http://localhost:3100`)

## Fixture prefix
`fd_` / `FD ` names; uuids in the `fd0…` range; persona `frontdesk@swimsync.test`.

## To graduate at session close (from the ROOT checkout, on main)
- **BACKLOG "A co-admin without pricing access may see NO teaching coach anywhere" — CONFIRMED 2026-10-05** by
  verify-front-desk-role checks 2/3a/3b (Front desk persona): Calendar card has no coach name; lesson page
  "Teaching: —"; prev/next strip "Unassigned (1 of 1)" — while the same page's substitute hint names the class's
  regular coach (classes.coach_id is readable). Cause: policy `class_rates_admin_select` requires
  `has_admin_area(..., 'pricing', 'view')`; readers `lib/calendarData.ts:45` and
  `lessons/[classId]/[date]/dao/lessonDetail.repo.ts:39` select class_rates directly → 0 rows for pricing:none
  (owner sees 2). Fix = plan §2.3 migration 20261005000200_who_taught_for_operations (root, after lane 1's).
  **FIXED** by lane 1: 20261005000200 class_coach_terms (prod + main 0984b0c) + reader switch ccc0e4a
  (calendarData.ts, lessonDetail.repo.ts, attendance.repo.ts:92). verify-front-desk-role 11/11 after it → BACKLOG
  item is SHIPPED, delete it (→ PRD: Front desk sees the teaching coach).
- **SHIPPED:** verify-front-desk-role.mjs + fixtures (main ebd4188), 11 checks, in the nightly table (TESTING.md).
  Mutation proofs in its header: Operations=None → 2/11; Billing=View → 8/11 (only 1a/1b + precondition red).
- **makeup_bookings.test.sql #19 counts ALL make-up rows, so any loaded fixture turns it red** — pgTAP that
  counts globally fails while any sibling's fixture is loaded in the shared DB. Tear fixtures down after each
  run; candidate GOTCHA (and/or scope #19 to its own rows).
- Driver pattern: a refused role made the first UI click time out and abort the run, hiding checks 4–6. Wrap
  each action section (`act()` in verify-front-desk-role) so a red-proof reports every check it breaks.
- Driver: sidebar groups render NO links while collapsed — a sidebar assertion must open every
  `navgroup-*` first (or it passes vacuously on "no money page"). Candidate GOTCHA.
