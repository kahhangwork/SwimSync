---
name: worktree-close
description: Retire a SwimSync worktree cleanly — confirm its code actually landed on main, tear its fixtures out of the shared database, release its ports, EXTRACT the graduate list from WORKTREE.md before it is destroyed, and settle the worktree keep-or-remove. Run this BEFORE /update-docs, which is written from the root checkout. Use when the work in a worktree is finished.
---

# Retiring a worktree

**This runs BEFORE `/update-docs`, and the ordering is the whole point.**

`WORKTREE.md` is **gitignored**, so it disappears with the worktree. It holds the *graduate
list* — the findings that have to reach `docs/GOTCHAS.md`, `BACKLOG.md`, the plan and the
PRD. And the living documents are written from the **root checkout on `main`**, never from a
worktree. So the sequence is:

```
/worktree-close  →  /update-docs (from the root)  →  /session-close
```

Settle the worktree after the documentation pass and the list is already gone.

> **`/session-close` §5 also mentions settling a worktree.** That is the fallback for a
> session that never ran this skill. If you are here, this skill owns it — `/session-close`
> should find nothing left to do.

---

## 1. Did the code actually land?

A worktree whose branch still holds commits is not finished, and a `HANDOVER.md` that calls
that work "done" is a lie the next session will believe.

```bash
cd <worktree>
git status --porcelain                      # must be empty
git log --oneline origin/main..HEAD         # must be empty
```

**If either is non-empty, stop.** Ship it with `/commit-review` first — it carries the change
to `main` (`git push origin <branch>:main`, fast-forward only) and fast-forwards the root
checkout. Do not "just remove the worktree" — `ExitWorktree` will refuse anyway, which is the
behaviour working as intended.

**Anything in the working tree that is not yours** — the user's editor, a sibling — say whose
you think it is and leave it. Never `git add -A` to tidy up.

---

## 2. Give the shared database back

One Postgres serves every worktree (`docs/GOTCHAS.md` §7.55). Fixture rows left behind are
not clutter: **a sibling's test can pass because of them.**

```bash
docker exec -i supabase_db_SwimSync psql -U postgres -d postgres \
  < .claude/skills/run-ui-playwright/drivers/fixtures-<name>-teardown.sql
```

Every fixture has one — CI enforces it (`drivers/check-teardowns.sh`). Each teardown ends
with a SELECT that prints **0** for what it removed and **1** for each seed identity that had
to survive. **Read that output**; a non-zero means the teardown is incomplete, not that the
check is wrong.

Then confirm your own prefix is gone:

```bash
docker exec -i supabase_db_SwimSync psql -U postgres -d postgres -tAc \
  "SELECT count(*) FROM students WHERE full_name LIKE 'wt-<name>-%'"   # expect 0
```

**Never `supabase db reset` to clean up.** It rebuilds the one database from whichever branch
happens to be running it; a sibling mid-flight loses their state and will not know why.

---

## 3. Release the ports

```bash
pkill -f "next dev"      # admin (3000 / 3100)
pkill -f "expo start"    # mobile (8081 / 8082)
lsof -ti:3000,3100,8081,8082 || echo "clear"
```

A dev server left running blocks the next worktree, and the failure it produces there looks
like a broken app rather than a busy port. Mention any long-running job you are deliberately
leaving up.

---

## 4. EXTRACT THE GRADUATE LIST — before anything is destroyed

**This is the step that only exists here, and the one that is irreversible if skipped.**

```bash
cat <worktree>/WORKTREE.md
```

Copy its *"To graduate at session close"* section into your reply to the user, verbatim, and
add anything the session turned up that never made it into the file. Then check the list is
actually complete — walk the session and ask:

- A trap that cost real time, or could bite again → **`docs/GOTCHAS.md`**, next §7.N
- A consequence accepted deliberately → the feature's plan in **`docs/plans/`**
- Something decided against → **`BACKLOG.md`**, item or *Deliberately not doing*
- A behaviour a user can now see → **`PRD.md`**
- A new significant file → **`docs/ARCHITECTURE.md`** §10
- A suite or driver added → **`docs/TESTING.md`** §5

**Do not write any of them yet.** They are written by `/update-docs`, from the root checkout,
in step 6. Carrying the list out of the worktree is all that happens here.

---

## 5. Settle the worktree — ask, do not assume

- **Keep** — more work is queued here. Fast-forward it so the next session does not start
  stale:
  ```bash
  git -C <worktree> fetch && git -C <worktree> merge --ff-only origin/main
  ```
  Use `ExitWorktree` with `action: "keep"` to return the session to the root.
- **Remove** — merged and done. Confirm it truly merged first:
  ```bash
  git merge-base --is-ancestor <branch> origin/main && echo "merged"
  ```
  Then `ExitWorktree` with `action: "remove"`. It **refuses** if the worktree holds
  uncommitted or unmerged work — that refusal is a safety property. If it fires, go back to
  step 1 rather than reaching for `discard_changes`.

A merged worktree left lying around is the one that quietly rots: it drifts behind `main`,
and its next occupant branches from a stale base.

> `ExitWorktree` only touches worktrees **this session** created with `EnterWorktree`. One
> made by hand with `git worktree add`, or inherited from an earlier session, needs
> `git worktree remove <path>` and `git branch -d <branch>`.

---

## 6. Hand off

Tell the user, plainly:

- What landed on `main`, and that CI is green (or that it is still running).
- **The graduate list**, in full — it is now only in this conversation.
- What you left in the shared database, if anything, and under what prefix.
- The worktree's disposition: kept (and fast-forwarded) or removed.

Then run **`/update-docs` from the root checkout on `main`** and write the graduate list into
its destinations. Finish with **`/session-close`**.
