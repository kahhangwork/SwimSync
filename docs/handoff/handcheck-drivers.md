# Worktree — handcheck-drivers

**Branch:** worktree-handcheck-drivers · **Base:** main @ 41f962e · **Started:** 2026-09-24
**Plan:** none (backlog item is self-describing; source scripts are `docs/refactor/app-fgh-handchecks-{F,G,H,fence}.mjs`)
**Backlog:** BACKLOG.md → *Promote the App L-F/G/H hand-check scripts to real drivers* (M)

## Shared database
**RELEASED 2026-09-24** — handed back to the root session after the verification below. My fixtures are
torn down (0 `ac*` rows left, seed `paynow_qr_url` NULL). Stack left running; my servers (expo, admin 3100,
`functions serve`) stopped.

## Ports
None held now. Used: admin 3100 · expo **8081** (NOT 8082 — see the auth-link finding below).

## I own
- `supabase/` — **NO**
- `.claude/skills/run-ui-playwright/drivers/verify-app-*.mjs` — the new drivers promoted from the hand-checks
- `.claude/skills/run-ui-playwright/drivers/fixtures-app-*.sql` + their `-teardown.sql`
- `docs/refactor/app-fgh-handchecks-*.mjs` — may delete/annotate once promoted

## I must NOT touch
- `HANDOVER.md`, `PRD.md`, `BACKLOG.md` — written from the root checkout at close
- `drivers/lib.mjs`, `drivers/run-all-drivers.sh`, `supabase/config.toml` — shared with every worktree
  (run-all discovers `verify-*.mjs` by glob, so no registration edit is needed)
- `lib/lessonDates.ts`, the three copies of `attendanceCompleteness.ts` (`docs/ARCHITECTURE.md` §6)
- existing drivers/fixtures (read and copy from them; don't edit)

## Fixture prefix
UUID `ac{1,2,3}00000-…`, emails `app-{auth,home,money}-*@swimsync.test`.

## Landed
`3ff558a` on `main` (fast-forward from `41f962e`, no rebase needed). Push CI `36002073328` green
(admin, app, backend, repo-invariants). The UI drivers first run unattended in the next NIGHTLY.

## Status (2026-09-24) — verified
| driver | fixture | checks |
|---|---|---|
| `verify-app-auth` | `fixtures-app-auth` (`ac100000`) | 25/25 |
| `verify-app-home-writes` | `fixtures-app-home-writes` (`ac200000`) | 10/10 |
| `verify-app-money` | `fixtures-app-money` (`ac300000`, its OWN tenant) | 19/19 |
| `verify-app-coach-settings` | none (restores seed PayNow QR in `finally`) | 6/6 |

- Round-trip: each fixture isolated ✓; full isolated+stacked ✓ twice. The FIRST full run said "✗ 1 failure"
  and its detail was lost (only `tail` kept) — not reproduced in 2 further runs. Unexplained; watch the CI job.
- Each driver green via `run-all-drivers.sh --only`, then TWICE more with fixture reload only (no reset) — 8/8.
- §7.25 mutation proofs (app file broken, driver run, file restored byte-for-byte):
  - skip `clearSignupJoinCode` → home 8/10 (signup_join_code + no-re-toast red)
  - `x-client-info` on the public-package GET → money 17/19 (both header checks red)
  - QR `<Image>` source → wrong URL → coach-settings 5/6 (image check red)
  - NOT mutation-proven: auth "old password no longer works" (needs a GoTrue change).

## To graduate at session close (from the ROOT checkout, on main)
- BACKLOG: strike *Promote the App L-F/G/H hand-check scripts to real drivers*.
- `docs/refactor/app-fgh-handchecks-*.mjs` are superseded — delete from main (HANDOVER/BACKLOG cite them; update citations in the same commit).
- GOTCHA: **auth links cannot be driven from a worktree Expo on a non-default port.** `additional_redirect_urls`
  lists only `localhost:8081`; GoTrue silently swaps an unlisted `redirect_to` for `site_url` (§7.41), so the
  recovery/invite link lands on `127.0.0.1:3000` → ERR_CONNECTION_REFUSED. `verify-app-auth` now fails with a
  message naming this. WORKTREES.md / worktree-start "claim 8082" advice needs a caveat for auth-link drivers.
- GOTCHA / doc correction: the `publicPackage.api.ts` header comment says any added header fails CORS and renders
  "Package not found". Locally, with `x-client-info` added, the page STILL rendered — the function (as served
  locally) accepts it. The driver's header-name check is the only guard; the render checks would not catch it.
  Worth checking against the deployed function's CORS before trusting the comment.
- GOTCHA candidate: the hand-check's Mailpit `DELETE /api/v1/messages` wipes every sibling's mail on the shared
  stack; the driver filters by recipient + `Created` instead.
- BACKLOG candidate: the package page's own "I've paid" POST (`postPublicPackageClaim`) is still pressed by no driver.
- TESTING §5: add the four drivers (`verify-app-auth` 25, `-home-writes` 10, `-money` 19, `-coach-settings` 6)
  and their fixtures; note `verify-app-auth` needs Expo on exactly :8081.
- HANDOVER: session entry for this work (`3ff558a`); watch the first nightly with the four new drivers.
- Commit-trailer note: `3ff558a` carries `Claude Opus 5.5 (1M context)` (the session's system attribution),
  not commit-review's `Claude Opus 4.8` line — that skill's trailer may want updating.
