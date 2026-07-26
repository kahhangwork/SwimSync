# SwimSync — Session Workflow

**What to type, and when.** This is a cheat sheet for the *skills*, nothing else — it is
deliberately the shortest document in the repo. What each skill does in detail lives in
`AVAIL_SKILLS.md`; how the product works lives in `PRD.md`.

_Last updated: 2026-07-26_

---

## The loop

```
  /session-start                      ← once, at the start
        │
        ▼
  pick what to build
        │
        ▼
  /plan-with-confidence               ← optional; for anything non-trivial
        │
        ▼
  /plan-review                        ← optional; for anything risky
        │
        ▼
  ┌── build it ───────────────────────────────────────┐
  │                                                   │
  │   /run-ui-playwright   ← if it touches a screen   │
  │         │                                         │
  │         ▼                                         │
  │   /commit-review       ← reviews, commits,        │   ⟲ repeat this block
  │                          AND pushes to main          once per change
  │                                                   │
  └───────────────────────────────────────────────────┘
        │
        ▼
  /update-docs                        ← once, near the end
        │
        ▼
  /session-close                      ← last thing. Then close the terminal.
```

---

## When to use each

| Skill | When | Runs |
|---|---|---|
| **`/session-start`** | Beginning of a session, or picking the repo back up | Once |
| **`/plan-with-confidence`** | Before building anything non-trivial. It asks questions until it understands the task, *then* plans | Per change |
| **`/plan-review`** | After a plan exists, before building. Ranks the plan's risks and folds mitigations into it | Per plan |
| **`/run-ui-playwright`** | To see a change working in the real UI, not just in tests | As needed |
| **`/commit-review`** | Every time a change is finished. Reviews it, commits it, **and pushes it to `main`** | **Per change** |
| **`/update-docs`** | Near the end, after the code has shipped | Once |
| **`/session-close`** | Last thing before you close the terminal | Once |

---

## Three things that are easy to get wrong

**① Shipping is per change, not per session.** `/commit-review` carries each change all the
way to `main`. Do not save up three changes and push them together — `main` moves under you
when other worktrees are running, and a big rebase is far worse than three small ones.

**② `/update-docs` is not the same as documenting a feature.** If a change alters *what a
user can do*, its `PRD.md` and `BACKLOG.md` updates go out **in the same push as the code**
— `/commit-review` asks you about this. `/update-docs` at the end is the *reconciliation*:
the session log, next steps, test counts, drift between documents.

> This is the one that has actually bitten. A feature once went live while `BACKLOG.md`
> still listed it as unbuilt, because its docs were deferred to "later" and later never
> came.

**③ `/session-close` does not write documentation.** It shuts things down: fixtures torn
out of the shared database, dev servers stopped, nothing left unpushed, worktree settled.
Run `/update-docs` *before* it.

---

## Skipping steps

`/plan-with-confidence` and `/plan-review` are optional and you should skip them for small,
obvious changes — running them on a one-line fix is theatre.

`/commit-review` is **not** optional: it is the only gate between a change and production,
because a push to `main` deploys both web apps.

`/update-docs` and `/session-close` are not optional either, and they are the two most
often skipped. Both are quick when the session was small.

---

## If you are working in a worktree

**Read [docs/WORKTREES.md](docs/WORKTREES.md) first — the whole sequence is there.** It
exists because git separates your *files* and nothing else: one database, one set of living
documents, one `main`, one set of ports.

The five rules it comes down to:

1. **One worktree owns `supabase/`.** Everyone else `git merge main` to consume the schema.
2. **Never `supabase db reset`** while a sibling is running.
3. **No worktree edits `HANDOVER.md` / `PRD.md` / `BACKLOG.md`** — collect findings in
   `WORKTREE.md`, write them from `main` at close.
4. **Push per change, fast-forward only, `<branch>:main`.**
5. **Prefix your fixture rows and tear them down.**

Default to working in the **root checkout** on a short-lived branch. Use a worktree only
when you deliberately want a second Claude session running at the same time.

---

## The documents, and who they are for

| Document | For | Rule |
|---|---|---|
| `01_SESSION_WORKFLOW.md` | **You** | What to type, and when. This file |
| `AVAIL_SKILLS.md` | You + Claude | What each skill does in detail |
| `CLAUDE.md` | Claude | Loaded **automatically** every session — commands, boundaries, the rules that bite. Under 200 lines |
| `HANDOVER.md` | Claude | The state the next session inherits — **and the index to everything below** |
| `PRD.md` | Claude | What the product **does** — only what is built |
| `BACKLOG.md` | Claude | What it **doesn't do yet** — nothing here exists |
| `docs/GOTCHAS.md` | Claude | §7 — traps that already cost real time. Read before touching an unfamiliar area |
| `docs/ARCHITECTURE.md` · `docs/TESTING.md` · `docs/DEPLOYMENT.md` | Claude | §6/§10/§12, §5, §11 — reference, read on demand |
| `docs/design/` · `docs/plans/` | Claude | Designs of record, and per-feature plans. Read the one for the area you're changing |
| `LOCAL_DEV_GUIDE.md` | Both | How to run and test it; seed logins |

> **Read on demand, not up front.** `/session-start` reads `HANDOVER.md` and stops; it
> fetches the rest only when the task needs them. Before 2026-07-26 it read four documents
> cover to cover — ~131,000 tokens before any work began. It is now ~12,000.
