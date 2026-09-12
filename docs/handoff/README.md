# docs/handoff/ — graduate lists in transit

**Normally empty.** A file here is a closed worktree's `WORKTREE.md`, pushed to `main` by
`/worktree-close` so its findings reach the root session without anyone pasting a chat message.

- **Written by** `/worktree-close` step 4, as the worktree's last commit.
- **Consumed by** `/update-docs` Step 0, which places every item in its permanent home
  (`docs/GOTCHAS.md`, `BACKLOG.md`, `PRD.md`, the plan, `docs/TESTING.md`, `HANDOVER.md`) and
  `git rm`s the file **in the same commit**.
- **Flagged by** `/session-start` and `/session-close` if one is still here.

A file that survives a documentation pass is a list nobody graduated. Do not delete it by hand;
run `/update-docs`. (Introduced 2026-09-12 after the Students-refactor worktree's list existed
only in its own chat window.)
