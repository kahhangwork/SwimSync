---
name: worktree-start
description: Start a SwimSync worktree safely — check what siblings own, settle the migration question (and land the migration on main FIRST if there is one), create the worktree, copy the env files it does not have, claim a port, and write its WORKTREE.md ownership brief. Use when the user asks to start a worktree, work in a worktree, or run a second session in parallel.
---

# Starting a worktree

**Read `docs/WORKTREES.md` if you have not.** This skill runs its Phases 0–3; that document
carries the reasoning and two full worked examples.

> **First, check a worktree is even the right tool.** It is for when the user deliberately
> wants a **second Claude session running at the same time**. One person working in one
> session should use the root checkout on a short-lived branch — a worktree buys nothing and
> costs the whole protocol below. **Say so and stop** if that is the situation.

**Plan first.** `/plan-with-confidence` and `/plan-review` belong *before* this skill, not
after. Their output answers the one hard question here — does this task need a migration —
and supplies the file list for the ownership brief. §8.15 is the cautionary case: a backlog
item sized **S** with no schema implied turned out, on planning, to need two DB triggers.

---

## 1. What else is running?

```bash
cd <repo-root>
git worktree list
cat .claude/worktrees/*/WORKTREE.md 2>/dev/null     # gitignored — read them directly
```

Report what you find to the user before doing anything. If a sibling exists, its
`WORKTREE.md` tells you which paths are already claimed; you must not take those.

---

## 2. Settle the migration question — this decides everything else

Ask it explicitly, from the plan: **does this task change the schema?**

### If NO

Proceed to step 3. Record `supabase/` — **NO** in the brief anyway, so the next session can
see the slot is free.

### If YES — do the migration in the ROOT checkout, and land it BEFORE creating the worktree

**A worktree never authors a migration.** Not a preference. Every worktree's `config.toml`
says `project_id = "SwimSync"`, so N checkouts address **one** `supabase_db_SwimSync`. A
migration living only on a feature branch does not exist in that database the moment anyone
runs `db reset` — the file is still there, the code still looks right, the schema is gone.
That is how the shared DB came to hold 75 applied migrations while `main` had 74 files
(`docs/GOTCHAS.md` §7.55).

First check nothing else is mid-flight:

```bash
grep -l 'supabase/. — \*\*YES\*\*' .claude/worktrees/*/WORKTREE.md 2>/dev/null
```

If that finds anything, **stop and wait** — one schema change in flight at a time. Parallel
migrations apply in **filename order** locally and **merge order** on production, and most
here are `CREATE OR REPLACE` / `DROP POLICY; CREATE POLICY`: last writer wins, silently, and
differently in the two environments.

Otherwise, in the root checkout:

```bash
git checkout -b db/<short-name>
# name the file YYYYMMDD + a 6-digit sequence, matching the existing ones,
# and give it the HIGHEST timestamp in the batch (§7.49)
$EDITOR supabase/migrations/<YYYYMMDD><NNNNNN>_<description>.sql
```

**Announce before `supabase db reset`** — it rebuilds the one database every worktree
shares, from whichever branch runs it, and a sibling mid-flight loses their state with no
clue why. Then:

```bash
supabase db reset
supabase test db                      # green before it leaves your machine
git add supabase/migrations/<file> supabase/tests/
git commit -m "feat(db): <what the schema now guarantees>"
git fetch origin && git rebase origin/main
supabase test db                      # re-run: the merged tree is not your tree
git push origin db/<short-name>:main
git branch -d db/<short-name>
```

Only now create the worktree. It will branch from `origin/main` and already have the schema.

---

## 3. Create it

Prefer the built-in tool — it puts the worktree exactly where this repo expects
(`.claude/worktrees/`, already gitignored) and branches from **`origin/main`** rather than
local HEAD, which is what you want:

- **`EnterWorktree`** with a `name` — creates it and moves this session into it.

The plain-git equivalent, if the session should stay where it is:

```bash
git worktree add .claude/worktrees/<name> -b <branch> origin/main
```

---

## 4. Set it up — it has no `.env` and no `node_modules`

This is the failure that wastes the most time (`docs/GOTCHAS.md` §7.56): the admin fails
loudly, but **the Expo app starts fine and serves a 200** while unable to reach Supabase, so
a driver dies on a missing login field and it reads exactly like "my change broke the app."

```bash
WT=.claude/worktrees/<name>
cp SwimSyncAdmin/.env.local $WT/SwimSyncAdmin/
cp SwimSyncApp/.env         $WT/SwimSyncApp/
grep -c '127.0.0.1:54321' $WT/SwimSyncApp/.env    # MUST be ≥1
```

**Check that grep.** Copying a cloud-pointed env into a worktree aims your drivers at
**production**.

```bash
cd $WT/SwimSyncAdmin && npm install
cd $WT/SwimSyncApp   && npm install
```

**Claim a non-default port** if a sibling may hold 3000 / 8081:

```bash
npm run dev -- -p 3100          # admin
npx expo start --port 8082      # app
```

`drivers/lib.mjs` already reads `ADMIN_URL` / `EXPO_URL`, so **no driver needs editing** —
and do not edit it; it is shared with every worktree.

**Do NOT give the worktree its own database** by editing `project_id` or the ports.
`config.toml` is **tracked**: per-folder values are one `git add -A` from being committed and
one `git checkout` from being clobbered.

**If a plan doc exists**, copy it in so the worktree can commit it with the work:
`cp docs/plans/<PLAN>.md $WT/docs/plans/`.

---

## 5. Write `WORKTREE.md` — the ownership brief

At the worktree root. **Gitignored on purpose**: two worktrees cannot own one tracked path,
and committing it makes every sibling's `git merge main` fail with *"untracked working tree
files would be overwritten"*.

Fill the **I own** list from the plan, and **I must NOT touch** from the siblings' briefs
plus the always-shared files.

```markdown
# Worktree — <short task name>

**Branch:** <branch> · **Base:** main @ <sha> · **Started:** <date>
**Plan:** docs/plans/<PLAN>.md · **Backlog:** <section> → <item>

## I own
- `supabase/` — **NO** / **YES**    ← YES only if a migration is genuinely in flight here
- <paths only this worktree may edit>

## I must NOT touch
- `HANDOVER.md`, `PRD.md`, `BACKLOG.md` — written from the root checkout at close
- `drivers/lib.mjs`, `supabase/config.toml` — shared with every worktree
- `lib/lessonDates.ts`, the three copies of `attendanceCompleteness.ts` — duplicated
  byte-identical across projects (`docs/ARCHITECTURE.md` §6)
- <anything a sibling's WORKTREE.md claims>

## Fixture prefix
`wt-<name>-` — every row I insert uses it; the teardown deletes by it.

## To graduate at session close (from the ROOT checkout, on main)
- (add findings here as you hit them — gotcha → §7, consequence → the plan,
   unbuilt idea → BACKLOG, behaviour → PRD)
```

That last section is why a worktree can safely be forbidden from editing the living
documents: findings are **collected here and written later, from `main`**. `/worktree-close`
extracts it before the worktree is removed.

---

## 6. Tell the user where they stand

- Which worktree, which branch, which base.
- **Whether a migration was landed first**, and its filename if so.
- Which ports are theirs.
- What the brief says they own, and what a sibling already owns.
- The reminder that follows: build, then **`/commit-review` per change, not batched** —
  `main` moves under you when siblings run, and three small rebases beat one large one.

---

## While the worktree is running

Not this skill's job, but say it once at the end so it is not discovered late:

- **Never `supabase db reset`** while a sibling is running. Announce first if truly needed.
- **`git status` BEFORE `git commit`** — a sibling can move `HEAD` between your checkout and
  your commit (§7.56).
- **Stage explicitly, never `git add -A`** — sibling worktrees and the user's editor leave
  changes that are not yours.
- **New fixture? Write its teardown in the same commit.** CI enforces it
  (`drivers/check-teardowns.sh`).

Close with **`/worktree-close`**, which must run *before* `/update-docs`.
