# Worktree — Wave 6 apps lane (lane 2)

**Branch:** feat/pk001-message (Apps-1), then feat/package-draw-at-marking (Apps-2) · **Base:** main @ ad51148 · **Started:** 2026-10-06
**Plan:** docs/plans/WAVE6_PACKAGE_DRAW_AT_MARKING_PLAN.md (§1.2b, §1.4) · **Orchestrator:** lane1 (root checkout)

## I own
- `supabase/` — **NO** (lane1 owns ALL migrations, the engine and the DB)
- `SwimSyncApp/`, `SwimSyncAdmin/` — Wave 6 Apps-1 / Apps-2 only

## I must NOT touch
- `supabase/` (any of it), `HANDOVER.md`, `PRD.md`, `BACKLOG.md`, `docs/GOTCHAS.md`
- `drivers/lib.mjs`, `supabase/config.toml`
- `lib/lessonDates.ts`, the three copies of `attendanceCompleteness.ts`
- No `db reset`, `test db`, UI drivers, Deno suite until lane1 hands over the DB. Never dispatch the nightly.

## Database
Owned by **lane1**. Unit tests + typecheck only here.

## Ports
Admin 3100, app 8082 (if needed).

## Fixture prefix
`w6pd_` (plan §1.5).

## To graduate at session close (from the ROOT checkout, on main)
- Coach app maps every non-CN001/PK001 upsert error to "Please try again" — including the attendance
  window guard's P0001, whose text names the floor date. The admin surfaces that DB text; the coach app
  does not. Candidate BACKLOG/gotcha: should the coach mapper pass P0001 through too? (Not changed in Apps-1 — out of scope.)
- BACKLOG candidate: the D5 backlog question is asked ONCE, at activation. If the preview read fails
  (or the admin closes the tab), there is no later entry point to draw_package_backlog. A
  "Check marked lessons" action on a Held row would close it.
- Gotcha candidate (React): deciding "fetch or not" from a variable assigned INSIDE a setState updater
  is wrong — React may run the updater later than the next line. Read a ref (usePackageUsage.ts).
- Billing months had NO per-month unmarked derivation (only the Generate panel's one-month
  pre-flight); Wave 6 put it server-side in package_month_funding.unmarked_lessons (lane1).
- UX / gotcha candidate: the PK001 sentence formats its date with Postgres `to_char(…,'FMDD Mon')` →
  "Mark 27 Sep first" while every app label is en-SG "27 Sept" (§7.302's split, now in a DB message shown
  verbatim). Only differs in September. Driver matches the day number only.
- docs/TESTING.md nightly driver table needs a row for verify-package-draw-at-marking (not edited from
  the worktree — shared doc).
- Driver-writing lesson (gotcha candidate): a "nothing bad shown" check read AFTER a transient toast fades
  passes vacuously; poll for EITHER outcome and judge the one that appeared. And a "came back to X" check
  passes vacuously when it never left X — gate it on the earlier change. Both found by the red-proof.
- HANDOVER note: `next dev` (admin, :3100) crashed once mid --only batch after hours of hot reloads — a
  V8 heap dump with no explicit error line (an OOM, most likely). Restarted with
  `NODE_OPTIONS=--max-old-space-size=8192`; every driver then passed. Long sessions may want that flag.
- Admin's PK001 call-site path was already correct before Apps-1 (adminAttendanceSave.ts falls through to
  `upsertError.message` for every non-CN001 code) — only the shared mapper needed the change there.
