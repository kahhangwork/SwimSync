---
name: commit-review
description: Do a Senior-Engineer code review of the current work BEFORE committing, then commit. Use whenever the user asks to commit, "commit-review", "review and commit", or wants their changes reviewed for bugs/errors/inefficiencies prior to a commit. Always runs the review; the commit only happens after findings are triaged and fixed.
---

# commit-review — review, then commit

This skill gates every commit behind a thorough self-review. When invoked, run
the review below **first**, fix what it turns up, and only then create the
commit. Do not skip straight to `git commit`.

## Step 1 — Review (always run this, verbatim intent)

Act as a **Senior Engineer** and do a thorough code review of your work.
Identify **all** errors, inconsistent logic, inefficiencies, and anything that
can create bugs. Prioritize your findings in a list from **most critical to
least critical** before you fix them.

Scope the review to what is about to be committed:

```bash
git status --short            # what's changed
git diff                      # unstaged changes
git diff --staged             # already-staged changes
```

Review the **full diff** of those changes (not just a summary). Consider:

- **Correctness** — off-by-one, null/undefined, wrong operators, bad conditionals, error paths.
- **Inconsistent logic** — code that contradicts itself or the surrounding patterns.
- **Bug risk** — race conditions, unhandled rejections, resource leaks, missing `await`, RLS/permission gaps.
- **Inefficiencies** — needless loops, N+1 queries, redundant work, re-renders.

## Step 2 — Present prioritized findings

Output a single numbered list, **most critical first**, before changing
anything. Each item: `severity — file:line — one-line issue`. If the review
finds nothing substantive, say so explicitly.

## Step 3 — Fix

Fix the findings, hardest/most-critical first. Keep fixes minimal and in the
style of the surrounding code. If a finding is out of scope or intentional,
note why instead of changing it.

## Step 4 — The documentation gate

**Ask, before staging: does this change what a user can do?**

If yes, `PRD.md` and `BACKLOG.md` are part of **this** push, not a later one:

- **`PRD.md`** — fix the section that is now wrong, in place. Use the
  `*(implemented)*` convention where the build departed from the spec.
- **`BACKLOG.md`** — if this shipped a backlog item, **delete it**. A backlog
  that advertises a feature which exists is worse than no backlog.

**Why this is a gate here rather than a step at session end.** On 2026-07-26 a
branch merged its code and deferred its docs; for several hours the feature was
live while `BACKLOG.md` still listed it as unbuilt and `PRD.md` said nothing.
The session that noticed it correctly refused to write the PRD entry on its
behalf — documenting behaviour you have not driven is how a spec starts lying —
so it sat undocumented until its own session came back. **Shipping and
documenting are one act.**

If the change is a refactor, a test, tooling, CI, or anything under `.claude/`,
this gate does not apply. Those reach `HANDOVER.md` only, at `/update-docs`.

## Step 5 — Commit, then ship it

Only after Steps 1–4, create the commit.

- Stage the relevant files **explicitly** — never `git add -A`. Sibling
  worktrees and the user's own editor leave changes that are not yours;
  `git diff --cached --name-only` must show only your files.
- Write a concise message describing the *what/why* of the change.
- On the default branch (`main`), branch first unless the user said otherwise.
- End the commit message with the required trailer:

  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

Then take it to `main` — **per change, not batched at session end.** Small
pushes mean small rebases, which matters because `main` moves under you when
sibling worktrees are running (it moved twice in one session on 2026-07-26):

```bash
git fetch origin
git rebase origin/main          # then RE-RUN the suites — the merged tree is not your tree
git push origin <branch>:main   # fast-forward only: REJECTS if a sibling pushed first
```

**Push branch-to-branch (`<branch>:main`), not by checking out `main`.** `main`
is checked out in the root repo, so a worktree cannot check it out — and the
fast-forward-only push is the safety property: it fails loudly instead of
silently merging work you have not looked at.

Afterwards: fast-forward the root checkout
(`git -C <root> merge --ff-only origin/main`), confirm CI is green, and — if
the change touches a deployed surface — confirm the deploy actually carries it.

Then report: the findings you fixed, anything you deliberately left, the commit
SHA, and whether it is on `main`.

## Notes

- If there are no changes to commit, stop and say so — nothing to review.
- **Migrations do not follow this flow.** They land on `main` alone, one at a
  time — see `HANDOVER.md` §7.55. Worktrees share one database.
- The end-of-session documentation sweep is **`/update-docs`**, and shutting the
  session down is **`/session-close`**. See `01_SESSION_WORKFLOW.md`.
- This is project-scoped (SwimSync). To use it in every repo, move this
  directory to `~/.claude/skills/commit-review/`.
