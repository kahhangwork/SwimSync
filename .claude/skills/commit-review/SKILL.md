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

## Step 4 — Commit

Only after Steps 1–3, create the commit.

- Stage the relevant files (or confirm what's already staged).
- Write a concise message describing the *what/why* of the change.
- On the default branch (`main`), branch first unless the user said otherwise.
- End the commit message with the required trailer:

  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

Then report: the findings you fixed, anything you deliberately left, and the
commit SHA.

## Notes

- If there are no changes to commit, stop and say so — nothing to review.
- This is project-scoped (SwimSync). To use it in every repo, move this
  directory to `~/.claude/skills/commit-review/`.
