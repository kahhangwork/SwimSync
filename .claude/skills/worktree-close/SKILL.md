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
/worktree-close  →  /update-docs (ONE pass, from the root on main)  →  /session-close
```

Settle the worktree after the documentation pass and the list is already gone.

**With two sessions live, `/update-docs` has ONE writer.** `HANDOVER.md` is one file; two
sessions editing it at once conflict on the push. What actually happened on 2026-09-12: the
worktree pushed 14 commits to `main` one at a time; the ROOT session's `/update-docs` then
wrote §8.100 for that work *from the commits alone*; the worktree session, back in the root
afterwards, ran a **scoped** pass that wrote only the graduate-list items §8.100 had not
carried (two gotchas, a backlog item, a corrected TESTING entry). So:

1. Hand the graduate list (step 4) to the user in full — it is the artefact.
2. If the root session is still live, **it runs `/update-docs`** and this list goes into that
   pass. Do not race it.
3. If you run it yourself, do so only after `ExitWorktree`, from the root, on `main`, with
   `git status` clean and `git pull --ff-only` done — the root may be sitting on the
   sibling's branch (it was: `fix/nightly-driver-date-drift`). Then write ONLY what the
   earlier pass missed: grep each destination for each item first.

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
checkout. **Two things the sandbox refuses from inside a worktree session**, both seen
2026-09-12: the push to `main` itself (the auto-mode classifier calls it a production deploy —
Vercel builds from `main`), and any `git -C <root> …`. Hand both to the user as one line each:

```
! git -C /Users/kahhang/Documents/Code/SwimSync/.claude/worktrees/<name> push origin <branch>:main
! git -C /Users/kahhang/Documents/Code/SwimSync merge --ff-only origin/main
```

A push per change is still the rule — batch three or four commits into one push only when
the user is away, and say so. Do not "just remove the worktree" — `ExitWorktree` will refuse anyway, which is the
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

**If your session owned the shared DB for driver runs**, say so explicitly when you hand it
back — the sibling is waiting on that sentence. `run-all-drivers.sh` resets the database per
driver, so what you leave behind is the LAST driver's fixture: run that one's teardown
(`fixtures-<last>-teardown.sql`) and read its zeros.

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

**Write it to a TRACKED file and push it to `main` — a chat message is not a hand-off.**
Before 2026-09-12 this step said "copy it into your reply"; the root session cannot read
your reply, so the list reached it only if the user pasted it. Now:

```bash
mkdir -p docs/handoff
cp <worktree>/WORKTREE.md docs/handoff/<worktree-name>.md       # the whole brief; the graduate section is what matters
# add anything the session turned up that never reached WORKTREE.md, then:
git add docs/handoff/<worktree-name>.md
git commit -m "handoff(<worktree-name>): graduate list for /update-docs"
git push origin <branch>:main        # the user runs this if the sandbox refuses it
```

That file is the artefact. **`/update-docs` (Step 0) consumes it and `git rm`s it in the
same commit** — so a file still in `docs/handoff/` on `main` means an ungraduated list, and
`/session-start` and `/session-close` both flag one. Nothing depends on anyone remembering.

Also copy the *"To graduate at session close"* section into your reply to the user, and
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

  **Except for this false positive, seen 2026-09-12:** the tool compares the branch against the
  LOCAL `main` the worktree was created from, not `origin/main`. If the root checkout has not
  been fast-forwarded (or is on a sibling's branch), every commit you pushed shows as "N
  commits … removing will discard this work". They are not lost. The check is the line above:
  `git merge-base --is-ancestor <branch> origin/main && echo merged`. If that prints `merged`
  and `git log origin/main..HEAD` is empty, tell the user exactly that, get a yes, and
  re-invoke with `discard_changes: true`. The root catches up on its next `git pull --ff-only`.

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

Then the documentation pass — **one of**:

- the root session is live → it runs `/update-docs`; give it the graduate list and stop here;
- you are the only session left → `git status` clean, `git checkout main && git pull --ff-only`,
  then `/update-docs`, writing only what is not already in each document.

Finish with **`/session-close`**.
