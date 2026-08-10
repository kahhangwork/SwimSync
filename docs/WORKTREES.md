# SwimSync — Working in parallel worktrees

_How to run two sessions at once without them destroying each other's work._

Git gives each worktree its own files. **Nothing else is separated.** One database, one set
of living documents, one `main`, one set of ports. Every clash that has actually happened
here came from two sessions writing the same shared thing without deciding who owned it.

> **Default to the root checkout on a short-lived branch.** A worktree is for when you
> deliberately want a *second Claude session running at the same time*. If you are working
> alone in one session, a worktree buys you nothing and costs you the whole protocol below.

> **Two skills run this for you:** **`/worktree-start`** (Phases 0–3) and
> **`/worktree-close`** (Phase 6). This document is the reasoning behind them and the two
> worked examples; the skills are the steps. Between them, ship with `/commit-review` as
> normal — there is no separate worktree-commit step, its push is already the worktree-safe
> form. And run planning **before** `/worktree-start`: the plan is what answers the migration
> question.

---

## The model: one writer per shared resource

That is the entire idea. Everything in this guide follows from it.

| Shared resource | Who may write it | How everyone else gets it |
|---|---|---|
| **Database schema** (`supabase/migrations/`) | **The root checkout, on a short `db/…` branch — not a worktree at all.** One in flight at a time | `git merge main` to *consume* the schema; a worktree never authors a migration |
| **Database rows** (fixtures) | Anyone, under a **unique prefix**, with a teardown script | Not shared — you clean up your own |
| **Living documents** (`HANDOVER.md`, `PRD.md`, `BACKLOG.md`) | **No worktree.** Written from the **root checkout on `main`**, after the code lands | The worktree collects findings and *graduates* them at close |
| **`main`** | Everyone, **one small change at a time**, fast-forward only | `git fetch && git rebase origin/main`, then re-run the suites |
| **Ports** (54321-4, 3000, 8081) | First to claim them | Run on a non-default port |

**Why the schema rule is absolute:** every worktree's `supabase/config.toml` says
`project_id = "SwimSync"`, and the CLI names its containers from that — so N checkouts
address **one** `supabase_db_SwimSync`. A migration that lives only on a feature branch
ceases to exist in the running database the moment anyone else runs `db reset`. Observed
live on 2026-07-26: the shared DB held **75** applied migrations while `main` had **74
files**. Full reasoning in `docs/GOTCHAS.md` **§7.55**.

**Why no worktree writes the living documents:** they are single files that every session
wants to append to, so two sessions writing them means a merge conflict in the one place a
conflict is most expensive to resolve — you cannot tell which half is true without re-reading
both sessions. Serialising them on `main` costs nothing, because the documentation pass
happens *after* the code has landed anyway.

> ### ⚠ THE CASE THIS GUIDE DOES NOT COVER: TWO SESSIONS IN THE **ROOT** CHECKOUT
>
> Everything above assumes the second session took a worktree. On **2026-08-10** two ran in
> the root checkout at once (§8.42), and every protection here was silently absent — there is
> no `WORKTREE.md` declaring ownership, no port claim, and nothing to read before writing.
> What actually happened, none of it caught by tooling:
> - One session ran **`supabase db reset` three times** while the other was setting up. No
>   damage, and only by luck — the other had loaded no fixtures yet.
> - `HEAD` moved **four times** under an in-progress session, twice mid-`/update-docs`,
>   including a branch switch that made an edited file look reverted on disk.
> - Both sessions wrote `HANDOVER.md` §9 within minutes of each other, and one committed
>   while the other's edits sat uncommitted in the same file.
>
> **The tells, since nothing announces this:** `git worktree list` shows a sibling; `git log
> --oneline -1` differs from what you last saw; `git status` lists files you did not touch.
> Check all three **before** `supabase db reset`, before `git checkout`, and before writing a
> living document. If you find a sibling in the root checkout, say so and agree who writes
> what — `docs/SESSIONS.md` and `HANDOVER.md` §8 both serialise badly.
>
> **A worktree is strictly safer than sharing the root**, which is the argument for
> `/worktree-start` even when the task looks small enough not to need one.

---

## Phase 0 — Before you create anything

**Ask whether the task needs a migration.** This is the single question that determines
whether parallel work is safe.

```bash
git worktree list                      # who already exists
cat .claude/worktrees/*/WORKTREE.md    # what do they own? (gitignored, so read them directly)
```

- **Your task needs a migration, and no `db/…` branch is in flight** → **write it in the
  root checkout first and land it on `main`**, *then* create the worktree, which will branch
  from `origin/main` and already have the schema. Worked example B below. Declare
  `supabase/` — **NO** in your `WORKTREE.md` anyway, so the next session can see the slot is
  free again.
- **Your task needs a migration, and one is already in flight** → **stop and wait.** Do not
  write a second in parallel: locally they apply in **filename order**, on production in
  **merge order**, and most migrations here are `CREATE OR REPLACE` / `DROP POLICY; CREATE
  POLICY` — last writer wins, silently, and *differently in the two environments*.
- **Your task needs no migration** → proceed. Worked example A below.

> **A worktree never authors a migration.** Not "preferably not" — a migration on a feature
> branch does not exist in the shared database, so the moment anyone runs `db reset` the file
> is still there, the code still looks right, and the schema it needs is gone. That is how
> the shared DB came to hold **75** applied migrations while `main` had **74 files**
> (`docs/GOTCHAS.md` §7.55).

---

## Phase 1 — Create it

Claude Code has this built in, and it puts worktrees exactly where this repo expects them
(`.claude/worktrees/`, already gitignored):

- **`EnterWorktree`** — creates a worktree on a new branch and moves this session into it.
  With no `worktree.baseRef` configured it defaults to **`fresh`**, i.e. it branches from
  **`origin/main`**, not from your local HEAD. That is the behaviour you want: a worktree
  should never start from someone's uncommitted local state.
- **`ExitWorktree`** — leaves it, with `keep` or `remove`. It refuses to `remove` a worktree
  holding uncommitted or unmerged work unless you explicitly discard. It only touches
  worktrees *this session* created.
- **Subagents** can take `isolation: "worktree"` to get their own copy — useful when several
  agents would otherwise fight over the same files. The same database caveat applies: they
  are isolated on disk, not in Postgres.

If the session ends while still inside a worktree, you are prompted to keep or remove it.

Plain `git worktree add .claude/worktrees/<name> -b <branch> origin/main` works too and is
equivalent; use it if you want the worktree without moving this session into it.

---

## Phase 2 — Set it up (three things, all of which have bitten)

**A fresh worktree has no `.env` files and no `node_modules`.** The admin fails loudly; the
Expo app **starts fine and serves a 200** while being unable to reach Supabase, so a driver
dies on a missing login field and it reads exactly like "my change broke the app"
(`docs/GOTCHAS.md` **§7.56**).

```bash
cp SwimSyncAdmin/.env.local .claude/worktrees/<name>/SwimSyncAdmin/
cp SwimSyncApp/.env        .claude/worktrees/<name>/SwimSyncApp/
# CHECK the copied file points at 127.0.0.1:54321 — copying a cloud-pointed env
# aims your drivers at PRODUCTION
cd .claude/worktrees/<name>/SwimSyncAdmin && npm install
cd ../SwimSyncApp && npm install
```

**Take a non-default port** if a sibling may hold 3000:

```bash
npm run dev -- -p 3100        # admin
ADMIN_URL=http://localhost:3100 node <driver>.mjs
```

`drivers/lib.mjs` already reads `ADMIN_URL` / `EXPO_URL`, so **no driver needs editing** —
and do not edit it, because it is shared with every worktree.

**Do NOT give each worktree its own database** by editing `project_id` or the ports in
`config.toml`. That file is **tracked**: per-folder values are one `git add -A` from being
committed and one `git checkout` from being clobbered.

---

## Phase 3 — Write `WORKTREE.md` before you write code

This file is the coordination mechanism. It is **gitignored on purpose** — two worktrees
cannot own one tracked path, and committing it makes every sibling's `git merge main` fail
with *"untracked working tree files would be overwritten."*

Create it at the root of your worktree:

```markdown
# Worktree — <short task name>

**Branch:** <branch> · **Base:** main @ <sha> · **Started:** <date>
**Plan:** docs/plans/<PLAN>.md · **Backlog item:** <section> → <item>

## I own
- `supabase/` — YES / NO   ← only one worktree may say YES
- <paths only this worktree may edit, e.g. SwimSyncAdmin/app/(admin)/students/>

## I must NOT touch
- `HANDOVER.md`, `PRD.md`, `BACKLOG.md` — written from the root checkout at session close
- `drivers/lib.mjs`, `supabase/config.toml` — shared with every worktree
- `lib/lessonDates.ts` and the three copies of `attendanceCompleteness.ts` — duplicated
  byte-identical across projects (`docs/ARCHITECTURE.md` §6); a sibling may own them
- <anything a sibling's WORKTREE.md claims>

## Fixture prefix
`wt-<name>-` — every row I insert uses it, and my teardown deletes by it.

## To graduate at session close (from the ROOT checkout, on main)
- <gotcha worth a §7 entry>
- <backlog item raised>
- <consequence for the plan's §10>
```

That last section is the important one, and it is why a worktree can safely be forbidden
from editing the living documents: findings are **collected here and written later**, from
`main`. Anything durable left in `WORKTREE.md` when the worktree is retired is lost.

---

## Phase 4 — While you work

**Never run `supabase db reset`.** It rebuilds the one database every worktree shares, from
whichever branch happens to be running it — a sibling mid-flight loses their state and will
not know why. If you genuinely need one, **announce it first**, and expect to re-seed
afterwards.

> ### ⚠ THIS RULE IS AIMED AT THE ROOT CHECKOUT TOO, AND THAT IS WHERE IT WAS BROKEN
>
> **Observed 2026-07-26, ~18:45:** `supabase db reset` ran **twice** from the root checkout
> while a live worktree was driving the UI. The worktree caught it mid-flight — `public` had
> 0 tables for a moment. It cost nothing that time, only because that worktree's fixture was
> already torn down and its tests do not touch the database.
>
> **The root checkout is the one participant with no `WORKTREE.md`**, so it has no brief
> telling it what a sibling owns, and `git worktree list` is the only thing that would have
> said one existed. The session that did it *had* checked — early, before the worktree was
> created — and never checked again.
>
> **So: `git worktree list` immediately before `db reset`, every time, from any checkout.**
> Not once at session start. A worktree can appear while you work, and the root checkout is
> exactly the participant least likely to notice.
>
> If a sibling IS live, the alternative is a scoped teardown of your own fixture by prefix.
> A reset is never the cheapest way to clean up — see Phase 6.

**Prefix every fixture row**, and have a teardown that deletes by that prefix. Without a
prefix, two worktrees seeding "Test Parent" produce a passing test that should have failed.

**Every fixture has a teardown, and CI keeps it that way.** All 13 are paired as of
2026-07-26, and `drivers/check-teardowns.sh` fails the build if a new fixture arrives
without one. Run it locally any time:

```bash
.claude/skills/run-ui-playwright/drivers/check-teardowns.sh
```

**If you write a new fixture**, prove its teardown round-trips rather than eyeballing it:
snapshot every table's row count, apply the fixture, apply the teardown, and assert the
counts are byte-identical. That harness is what caught two real defects in the first pass —
a teardown that left a `parent_tenants` row behind, and one that could not reach a session
the fixture deliberately left unmarked. Both looked correct by reading.

**`git status` before `git commit`, not after.** A sibling merging to `main` can move `HEAD`
between your checkout and your commit — it has put a commit on `main` that was meant for a
branch, and that commit had no CI run of its own (`docs/GOTCHAS.md` §7.56).

**Stage explicitly. Never `git add -A`.** Sibling worktrees and the user's editor leave
changes that are not yours.

---

## Phase 5 — Ship each change, one at a time

**Per change, not batched at session end.** `main` moved twice during a single session on
2026-07-26; three small rebases beat one large one.

```bash
git fetch origin
git rebase origin/main        # then RE-RUN the suites — the merged tree is not your tree
git push origin <branch>:main # fast-forward only: REJECTS if a sibling pushed first
```

**Push branch-to-branch (`<branch>:main`), never by checking out `main`** — `main` is
checked out in the root repo, so a worktree cannot check it out. The fast-forward-only push
is the safety property: it fails loudly instead of silently merging work you have not read.

Then fast-forward the root checkout so it does not go stale:

```bash
git -C <repo-root> merge --ff-only origin/main
```

Remember `git push … :main` **is the app deploy** — Vercel builds both sites from `main`
(`docs/GOTCHAS.md` §7.60). For a backend-first change: migrations → engine → apps, so land
on `main` **last**.

---

## Phase 6 — Close it down, in this order

The order matters: documentation is written from `main` *after* the code has landed, so the
worktree has to be finished with before `/update-docs` runs.

1. **Land all your code** (Phase 5). Nothing may still be sitting on the branch.
2. **Tear down your fixtures** — by prefix, from the shared database. **Not `db reset`.**
   ```bash
   docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
     < .claude/skills/run-ui-playwright/drivers/fixtures-<name>-teardown.sql
   ```
   Verify: `SELECT count(*) … WHERE full_name LIKE 'wt-<name>-%'` → expect 0.
3. **Release the ports** — `pkill -f "next dev"`, `pkill -f "expo start"`.
4. **Copy your `WORKTREE.md` "graduate" list somewhere you can still read it** — it is
   about to become unreachable.
5. **`ExitWorktree`** with `keep` (more work queued here — then
   `git fetch && git merge --ff-only origin/main` so it does not start stale) or `remove`
   (merged and done; confirm with
   `git merge-base --is-ancestor <branch> origin/main` first).
6. **Now, from the root checkout on `main`, run `/update-docs`** — and write the graduate
   list into `docs/GOTCHAS.md`, `BACKLOG.md`, the plan's §10 and the PRD, then the session
   entry. This is the only place the living documents are written.
7. **`/session-close`** to shut the shared environment down.

A merged worktree left lying around is the one that quietly rots: it drifts behind `main`,
and its next occupant branches from a stale base.

---

## Worked example A — a task with NO migration

Task: **Upcoming lessons view for parents** (`BACKLOG.md` → *Parent experience*, **S**).
Frontend only — it points the existing `lib/lessonDates.ts` derivation at the future instead
of the past. No schema change, so this is the easy shape.

**1. Check what else is running** *(Phase 0)*

```bash
cd /Users/kahhang/Documents/Code/SwimSync
git worktree list
cat .claude/worktrees/*/WORKTREE.md 2>/dev/null   # may be empty — that's fine
```

Nothing to negotiate: this task needs no migration, so the `supabase/` slot is irrelevant.

**2. Create the worktree**

Ask Claude to *"start a worktree called upcoming-lessons"* — it calls `EnterWorktree`, which
branches from `origin/main` and moves the session into
`.claude/worktrees/upcoming-lessons/`. The plain-git equivalent:

```bash
git worktree add .claude/worktrees/upcoming-lessons -b feat/upcoming-lessons origin/main
```

**3. Set it up — it has no `.env` and no `node_modules`** *(Phase 2)*

```bash
WT=.claude/worktrees/upcoming-lessons
cp SwimSyncApp/.env        $WT/SwimSyncApp/
cp SwimSyncAdmin/.env.local $WT/SwimSyncAdmin/
grep -c '127.0.0.1:54321' $WT/SwimSyncApp/.env   # MUST be ≥1 — a cloud-pointed env
                                                 # aims your drivers at production
cd $WT/SwimSyncApp && npm install
```

**4. Write `WORKTREE.md`** at `.claude/worktrees/upcoming-lessons/WORKTREE.md`

```markdown
# Worktree — upcoming lessons for parents

**Branch:** feat/upcoming-lessons · **Base:** main @ 229b984 · **Started:** 2026-07-27
**Backlog:** Parent experience → Upcoming lessons view for parents (S)

## I own
- `supabase/` — **NO** (slot is free for someone else)
- `SwimSyncApp/app/(parent)/`, `SwimSyncApp/lib/upcomingLessons.ts`

## I must NOT touch
- `HANDOVER.md`, `PRD.md`, `BACKLOG.md` — written from the root at close
- `SwimSyncApp/lib/lessonDates.ts` — duplicated byte-identical in both apps
  (`docs/ARCHITECTURE.md` §6). READ it, extend alongside it, do not edit it.
- `drivers/lib.mjs`, `supabase/config.toml` — shared with every worktree

## Fixture prefix
`wt-upcoming-` — every row I insert uses it; teardown deletes by it.

## To graduate at session close (from the ROOT checkout, on main)
- (findings go here as I hit them)
```

**5. Build, on a non-default port**

```bash
cd $WT/SwimSyncApp && npx expo start --port 8082
# if you need the admin too:
cd $WT/SwimSyncAdmin && npm run dev -- -p 3100
EXPO_URL=http://localhost:8082 node .claude/skills/run-ui-playwright/drivers/<driver>.mjs
```

If you add a fixture, write its teardown **in the same commit** — CI enforces it
(`drivers/check-teardowns.sh`).

**6. Ship it — per change, not at the end** *(Phase 5)*

```bash
cd $WT
git status                              # BEFORE committing: a sibling may have moved HEAD
git add <explicit paths>                # never -A
git fetch origin && git rebase origin/main
npm test && npm run typecheck           # the merged tree is not your tree — re-run
git push origin feat/upcoming-lessons:main
git -C /Users/kahhang/Documents/Code/SwimSync merge --ff-only origin/main
```

**7. Close down, in order** *(Phase 6)*

```bash
docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
  < .claude/skills/run-ui-playwright/drivers/fixtures-<name>-teardown.sql
pkill -f "expo start"; pkill -f "next dev"
cat $WT/WORKTREE.md          # ← copy the "graduate" list somewhere you can still read it
```

Then `ExitWorktree` (`remove`, since it merged), and **only now**, from the root checkout on
`main`, run `/update-docs` and write the graduate list into `docs/GOTCHAS.md`, `BACKLOG.md`
and `PRD.md`. Finish with `/session-close`.

---

## Worked example B — a task that NEEDS a migration

Task: **A business cannot read its own audit trail** (`BACKLOG.md` → *Foundations*, **S**).
13 of the 19 `audit_log` writers never set `tenant_id`, so a business cannot read its own
rows. Needs a migration **and** changes across those writers.

> **The migration does NOT go in the worktree.** This is the one thing worth getting right,
> and it is not obvious. Write it in the **root checkout** on a short `db/…` branch, land it
> on `main`, *then* create the worktree — which, because `EnterWorktree` branches from
> `origin/main`, already has the schema. `docs/GOTCHAS.md` **§7.55** is the reasoning: a
> migration living only on a feature branch ceases to exist in the shared database the
> moment anyone runs `db reset`, and parallel migrations apply in **filename order** locally
> but **merge order** on production.

**1. Claim the slot before writing anything** *(Phase 0)*

```bash
git worktree list
grep -l 'supabase/. — \*\*YES\*\*' .claude/worktrees/*/WORKTREE.md 2>/dev/null
```

If that finds a worktree, **stop and wait** — one schema change in flight at a time. If it
finds nothing, the slot is yours.

**2. Do the migration FIRST, in the root checkout**

```bash
cd /Users/kahhang/Documents/Code/SwimSync
git checkout -b db/audit-log-tenant-id

# Name it YYYYMMDD + a 6-digit sequence, matching the existing files, and give it
# the HIGHEST timestamp in the batch (§7.49).
$EDITOR supabase/migrations/20260728000100_audit_log_tenant_id.sql
```

Apply it. **Announce before `db reset`** — it rebuilds the one database every worktree
shares, and a sibling mid-flight loses their state:

```bash
supabase db reset          # ← tell anyone else running a session FIRST
supabase test db           # pgTAP must be green before this leaves your machine
```

Land it on `main` before anything depends on it:

```bash
git add supabase/migrations/20260728000100_audit_log_tenant_id.sql supabase/tests/
git commit -m "feat(db): audit_log rows carry their tenant"
git fetch origin && git rebase origin/main
supabase test db                        # re-run: the merged tree is not your tree
git push origin db/audit-log-tenant-id:main
git branch -d db/audit-log-tenant-id
```

**3. NOW create the worktree for the code half**

```bash
git worktree add .claude/worktrees/audit-trail -b feat/audit-trail origin/main
```

It branches from `origin/main`, so it already contains the migration you just landed. It
never carries one of its own.

**4. Set up + `WORKTREE.md`** — as in example A, but the ownership line differs:

```markdown
## I own
- `supabase/` — **NO.** The migration (20260728000100) already landed on `main`
  before this worktree existed. If this task turns out to need a SECOND schema
  change, STOP: go back to the root checkout and repeat step 2 there. Do not
  write a migration here.
- the 13 writers listed in the backlog item
```

**5. Build the code half**, ship per change exactly as in example A steps 5–6.

**6. If you discover mid-flight that you need another migration**

This happens, and the answer is always the same:

```bash
# in the worktree — park what you have
git add -u && git commit -m "wip: writers 1-6"
# in the ROOT checkout — do the schema change there, land it on main
cd /Users/kahhang/Documents/Code/SwimSync
git checkout -b db/audit-log-followup
# ...write, supabase db reset (ANNOUNCE), supabase test db, push to main...
# back in the worktree — CONSUME it
cd .claude/worktrees/audit-trail
git fetch origin && git merge origin/main
```

The worktree **merges** the schema in; it never authors it.

**7. Close down** exactly as in example A step 7. Note one extra thing for a schema change:
deploying it is **migrations → engine → apps**, and `git push … :main` *is* the app deploy
(§7.60), so land on `main` last when the backend has to move first.

---

## If two worktrees finish at once

They serialise on `main`, and the second one simply rebases and re-reads. The documentation
pass is cheap to redo because `HANDOVER.md` is now an index: a session adds **one §8 entry
plus one ledger row**, not an edit buried in a 4,000-line file. If you do hit a conflict in
`HANDOVER.md`, take *both* sides — two sessions happened — and renumber the newer entry.

## The five rules, if you remember nothing else

1. **A worktree never authors a migration.** Write it in the root checkout on a `db/…`
   branch, land it on `main`, then merge `main` to consume it. One in flight at a time.
2. **Never `supabase db reset`** while a sibling is running.
3. **No worktree edits `HANDOVER.md` / `PRD.md` / `BACKLOG.md`** — collect findings, write
   them from `main` at close.
4. **Push per change, fast-forward only, `<branch>:main`.**
5. **Prefix your fixture rows and tear them down.**

See also: `docs/GOTCHAS.md` §7.55 (shared database), §7.56 (fresh-worktree setup, concurrent
`HEAD`), §7.60 (a push to `main` is a deploy); `01_SESSION_WORKFLOW.md` for the skill order.
