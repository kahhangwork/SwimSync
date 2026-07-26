# SwimSync — Working in parallel worktrees

_How to run two sessions at once without them destroying each other's work._

Git gives each worktree its own files. **Nothing else is separated.** One database, one set
of living documents, one `main`, one set of ports. Every clash that has actually happened
here came from two sessions writing the same shared thing without deciding who owned it.

> **Default to the root checkout on a short-lived branch.** A worktree is for when you
> deliberately want a *second Claude session running at the same time*. If you are working
> alone in one session, a worktree buys you nothing and costs you the whole protocol below.

---

## The model: one writer per shared resource

That is the entire idea. Everything in this guide follows from it.

| Shared resource | Who may write it | How everyone else gets it |
|---|---|---|
| **Database schema** (`supabase/migrations/`) | **Exactly one** worktree at a time — declared in its `WORKTREE.md` | `git merge main` to *consume* the schema; never carry a migration on a feature branch |
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

---

## Phase 0 — Before you create anything

**Ask whether the task needs a migration.** This is the single question that determines
whether parallel work is safe.

```bash
git worktree list                      # who already exists
cat .claude/worktrees/*/WORKTREE.md    # what do they own? (gitignored, so read them directly)
```

- **Your task needs a migration, and nobody owns `supabase/`** → you may take it. Say so in
  your `WORKTREE.md`.
- **Your task needs a migration, and someone already owns `supabase/`** → **stop.** Either
  wait, or do the schema change on `main` in the root checkout first, land it, and let both
  worktrees `git merge main` to pick it up. Do not write a second migration in parallel:
  locally they apply in **filename order**, on production in **merge order**, and most
  migrations here are `CREATE OR REPLACE` / `DROP POLICY; CREATE POLICY` — last writer wins,
  silently, differently in the two environments.
- **Your task needs no migration** → proceed, and say `owns: nothing in supabase/` so the
  next session knows the slot is free.

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

## If two worktrees finish at once

They serialise on `main`, and the second one simply rebases and re-reads. The documentation
pass is cheap to redo because `HANDOVER.md` is now an index: a session adds **one §8 entry
plus one ledger row**, not an edit buried in a 4,000-line file. If you do hit a conflict in
`HANDOVER.md`, take *both* sides — two sessions happened — and renumber the newer entry.

## The five rules, if you remember nothing else

1. **One worktree owns `supabase/`.** Everyone else merges `main` to consume the schema.
2. **Never `supabase db reset`** while a sibling is running.
3. **No worktree edits `HANDOVER.md` / `PRD.md` / `BACKLOG.md`** — collect findings, write
   them from `main` at close.
4. **Push per change, fast-forward only, `<branch>:main`.**
5. **Prefix your fixture rows and tear them down.**

See also: `docs/GOTCHAS.md` §7.55 (shared database), §7.56 (fresh-worktree setup, concurrent
`HEAD`), §7.60 (a push to `main` is a deploy); `01_SESSION_WORKFLOW.md` for the skill order.
