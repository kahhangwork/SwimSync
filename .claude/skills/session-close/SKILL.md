---
name: session-close
description: Shut a SwimSync session down cleanly — release the shared local database and ports, confirm nothing is uncommitted or unpushed, and settle the worktree. Use when the user says they are done, closing the terminal, finishing for the day, or "close the session". This does NOT update documentation; that is /update-docs, which should already have run.
---

# Shutting a SwimSync session down

The last thing you do. **This skill writes no documentation** — `/update-docs` does that,
and it should already have run (step 1 below checks).

## Why this exists at all

Because the local environment is **shared**, and a session that walks away without
clearing up damages someone else's:

- **One database serves every worktree** (§7.55). Fixture rows left behind become another
  session's confusing test data — or another session's *passing test that should fail*.
- **Ports are singletons.** A dev server left on 3000 or 8081 blocks the next worktree,
  and the failure it produces there looks like a broken app rather than a busy port.
- **Unpushed work is invisible work.** A `HANDOVER.md` that describes shipped behaviour
  while the commit sits on a local branch is a lie the next session will believe.

Every item below is something that actually went wrong or was caught by hand on
2026-07-26. Walk them in order; each one is a check, not a chore.

---

## 1. Did the documentation pass run?

```bash
git log --oneline -5
```

Is there a docs commit for this session's work? If the session shipped **anything** —
behaviour, a bug fix, a new gotcha — and `HANDOVER.md` has no entry for it, **stop and run
`/update-docs` first.** Coming back to it tomorrow does not happen.

If the session only read code and changed nothing, say so and skip to step 5.

## 2. Nothing uncommitted, nothing unpushed

```bash
git status --short                       # must be empty (or explained)
git fetch origin && git log --oneline -1 origin/main
git rev-list --count origin/main..HEAD   # must be 0
git status --short supabase/migrations/  # untracked migration = §7.55's 75-vs-74 bug
```

**Anything left in the working tree needs a decision, not a shrug.** If it is not yours —
the user's editor, a sibling worktree — say whose you think it is and leave it. Never
`git add -A` to "tidy up".

An **untracked migration file** is the specific case worth its own line: it is applied to
the shared database but exists in no branch, so it vanishes the moment anyone runs
`supabase db reset`, and nothing points at the cause.

## 3. Give the shared database back

```bash
docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
  < .claude/skills/run-ui-playwright/drivers/fixtures-<name>-teardown.sql
```

Run the teardown for **every** fixture this session applied. Then confirm:

```bash
docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc \
  "SELECT count(*) FROM students WHERE full_name LIKE '<your prefix>%'"   # expect 0
```

**Never `supabase db reset` to clean up.** It rebuilds the one database every worktree
shares, from whichever branch happens to be running it — a sibling mid-flight loses their
state and will not know why.

If a fixture has no teardown script, that is the bug: write one now, or say plainly in your
summary which rows you are leaving and under what prefix.

## 4. Release the ports

```bash
pkill -f "next dev"      # admin
pkill -f "expo start"    # mobile
```

Then confirm they are actually down — a backgrounded server can outlive the command that
started it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000  # 000 = free
```

Leave nothing listening. Mention any long-running job you are deliberately leaving up.

## 5. Settle the worktree — **normally already done by `/worktree-close`**

> **`/worktree-close` owns this, and it runs BEFORE `/update-docs`.** That ordering is
> load-bearing: `WORKTREE.md` is gitignored, so the *graduate list* — the findings that must
> reach `docs/GOTCHAS.md`, `BACKLOG.md`, the plan and the PRD — disappears with the worktree.
> Settling it after the documentation pass means writing the docs from a list that no longer
> exists. Full sequence: **`docs/WORKTREES.md`**.
>
> **If you are reading this and a worktree is still live, that skill did not run.** Stop, run
> `/worktree-close`, then `/update-docs`, then come back here. The steps below are the
> fallback for a session that skipped it.

If the session ran in a worktree, it needs an explicit disposition — **ask, don't assume**:

- **Keep** — more work is queued here. Fast-forward it so the next session does not start
  stale: `git fetch && git merge --ff-only origin/main`.
- **Remove** — the work merged and is done. Confirm it is truly merged
  (`git merge-base --is-ancestor <branch> origin/main`), then remove the worktree and
  delete the branch.

A merged worktree left lying around is the one that quietly rots: it drifts behind `main`,
and its next occupant branches from a stale base.

## 6. Hand back what only the user can do

Close with a short list of anything **outstanding on them**, not on you:

- Production spot-checks you could not perform without their login
- Decisions you deliberately left open
- Anything a sibling worktree left undocumented that is now theirs to chase

Then state plainly: what shipped, what is on `main`, what is still local, and what you
deliberately did not do.

---

## Rules

- **Never `supabase db reset`** as cleanup. See step 3.
- **Never `git stash`** — the stash stack is shared across every worktree, so a bare
  `git stash pop` can take a sibling's work. Use a WIP commit.
- **Never `git add -A`** at close. Stage explicitly or leave it.
- This skill does not write documentation. If you find yourself editing `PRD.md`,
  `BACKLOG.md` or `HANDOVER.md`, you are in the wrong skill — that is `/update-docs`.
- Project-scoped (SwimSync). To use it everywhere, move this directory to
  `~/.claude/skills/session-close/`.
