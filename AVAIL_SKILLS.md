# SwimSync — Available Skills

A reference to the **skills** available when working on SwimSync with Claude Code:
what each one does, how to invoke it, and when it's useful here.

_Last updated: 2026-07-26_

> **New here? Read [01_SESSION_WORKFLOW.md](01_SESSION_WORKFLOW.md) first** — one page,
> what to type and when. This file is the detail behind it.

## What a skill is & how to run it

A **skill** is a packaged capability Claude can invoke. Two ways they fire:

- **You invoke it** by typing a slash command: `/<skill-name>` (optionally with
  args, e.g. `/code-review high`). Or just ask in plain English ("run the app",
  "review my changes") — Claude picks the matching skill.
- **Claude invokes it automatically** when the task matches (e.g. it loads the
  chart-design skill before drawing any chart).

Skills come from two places:

| Source | Location | Scope |
|--------|----------|-------|
| **Project skills** | `.claude/skills/<name>/SKILL.md` (in this repo) | Just SwimSync; committed, shared with anyone who clones |
| **Built-in skills** | Ship with Claude Code | Every project |

To add a project skill, create `.claude/skills/<name>/SKILL.md` with `name:` and
`description:` frontmatter — see [run-ui-playwright](.claude/skills/run-ui-playwright/SKILL.md)
as a worked example.

---

## Project skills (SwimSync-specific)

### `run-ui-playwright` — drive the apps end-to-end in a browser

Launches and drives **both** UIs with Playwright against your installed Chrome
(no Chromium download): the Expo mobile app (web mode, `:8081`) and the Next.js
admin (`:3000`). Use it to run/screenshot the apps or confirm a change works in
the **real UI** across parent / coach / superadmin roles — not just tests.

- **Invoke:** `/run-ui-playwright`, or ask "drive the app UI / screenshot the
  parent billing screen". (The generic `/run` skill will also discover it.)
- **Prereqs:** Docker + `supabase start`; for billing, also
  `supabase functions serve generate-invoices …`. First-time:
  `cd .claude/skills/run-ui-playwright/drivers && npm install`.
- **Gives you:** reusable driver helpers (`drivers/lib.mjs`) and a worked
  credit-note-flow template, plus the Expo/RN-web quirks baked in (login
  selectors, session rehydration, force-click, etc.).
- **Details:** [.claude/skills/run-ui-playwright/SKILL.md](.claude/skills/run-ui-playwright/SKILL.md)

### Workflow skills — plan → build → ship → reconcile → close

Prompt-driven skills that enforce a disciplined workflow.
`/plan-with-confidence` and `/plan-review` are **explicit-invocation only** (type the
slash command); the rest also respond to plain requests.

> **The order, and where each one runs:** see **[01_SESSION_WORKFLOW.md](01_SESSION_WORKFLOW.md)**
> — the one-page cheat sheet for what to type and when. The short version:
> `/session-start` once → then, **per change**, `/plan-with-confidence` →
> `/plan-review` → build → `/commit-review` (which also pushes to `main`) → then
> once at the end, `/update-docs` → `/session-close`.

> ⚠ **`/session-close` was renamed on 2026-07-26.** What used to be called
> `/session-close` — the documentation pass — is now **`/update-docs`**. The name
> `/session-close` now belongs to a genuinely different skill: shutting the session
> down. The old name promised a lifecycle step and delivered a docs pass, so it got
> deferred by anyone who "wasn't closing anything yet".

#### `plan-with-confidence` — don't plan until you're sure

Holds off on any plan until confidence is **>96%**, asking batched follow-up
questions until it clears that bar — then plans.

- **Invoke:** `/plan-with-confidence` (only fires when typed explicitly).
- **Details:** [.claude/skills/plan-with-confidence/SKILL.md](.claude/skills/plan-with-confidence/SKILL.md)

#### `plan-review` — harden a plan against product risk

Ranks the current plan's areas by **product risk** (most → least, each with a
why), then folds concrete risk-reduction steps into the plan for each item.
**Folds them into the step they govern, never into a trailing "Risks" section** —
each as a step, an assertion with a pass/fail value, or a named prohibition — and
prefers a *structural* mitigation (make the failure impossible) over a *vigilance*
one (ask someone to remember). That preference is why review findings were being
read at planning time and forgotten at implementation time.

- **Invoke:** `/plan-review` (only fires when typed explicitly).
- **Details:** [.claude/skills/plan-review/SKILL.md](.claude/skills/plan-review/SKILL.md)

#### `commit-review` — Senior-Engineer review, then commit **and ship**

Gates a commit behind a thorough self-review: finds errors / inconsistent
logic / inefficiencies / bug risks, lists them most-critical-first, fixes them,
then commits — **and carries the change through to `main`** (fetch → rebase →
re-run the suites → fast-forward-only push).

Two things it enforces that are easy to skip:

- **The documentation gate.** If the change alters *what a user can do*, its
  `PRD.md` and `BACKLOG.md` updates ship **in the same push as the code**, not
  at session end. A feature once went live while the backlog still advertised it
  as unbuilt, because its docs were deferred to a "later" that never came.
- **Per change, not batched.** `main` moves under you when sibling worktrees are
  running — it moved twice in one session on 2026-07-26 — and three small
  rebases beat one large one.

- **Invoke:** `/commit-review`, or ask to "review and commit".
- **Details:** [.claude/skills/commit-review/SKILL.md](.claude/skills/commit-review/SKILL.md)

### `session-start` — get up to speed before touching code

The mirror of `update-docs`. **Reads `HANDOVER.md` — the index — and then stops**,
fetching `PRD.md`, `BACKLOG.md`, `LOCAL_DEV_GUIDE.md` or a `docs/` reference only when
the task actually touches it. Reports where things stand, what's next per HANDOVER §9,
and any drift it spotted.

> **Changed 2026-07-26.** It used to read four documents cover to cover — about
> **131,000 tokens** before any work began, half of it a session-by-session changelog.
> `HANDOVER.md` is now ~11,000 tokens and points at everything else. Reading on demand is
> both cheaper and more accurate: recall degrades as context grows, and stale material
> sitting *near* the right answer competes with it.

- **Invoke:** `/session-start`, or say "get up to speed" / "catch up" / "where were
  we" at the start of a session.
- **Pairs with:** `/update-docs` (writes these same documents back near session end)
  and `/run-ui-playwright` (uses the seed logins to drive the UI).
- **Details:** [.claude/skills/session-start/SKILL.md](.claude/skills/session-start/SKILL.md)

### `worktree-start` — begin a parallel worktree without clashing

Only for when you deliberately want a **second Claude session running at the same time**;
a solo session should use the root checkout on a short branch. Checks what siblings already
own, settles **the migration question** (and if the answer is yes, walks the migration in the
**root checkout** and lands it on `main` *before* the worktree exists — a worktree never
authors one), creates it under `.claude/worktrees/`, copies the `.env` files it does not
have, claims a non-default port, and writes the `WORKTREE.md` ownership brief.

**Run it AFTER `/plan-with-confidence` and `/plan-review`.** The plan is what answers the
migration question and supplies the file list for the brief. §8.15 is the cautionary case: a
backlog item sized **S** with no schema implied turned out, on planning, to need two DB
triggers — discovering that inside a worktree means backing out to the root.

- **Invoke:** `/worktree-start`, or ask to "start a worktree".
- **Pairs with:** `/worktree-close`. Reasoning + two worked examples: `docs/WORKTREES.md`.
- **Details:** [.claude/skills/worktree-start/SKILL.md](.claude/skills/worktree-start/SKILL.md)

### `worktree-close` — retire it, and rescue the graduate list

Confirms the code actually landed on `main`, tears the fixtures out of the shared database
(never `db reset`), releases the ports, **extracts the graduate list from `WORKTREE.md`
before the worktree is destroyed**, and settles it keep-or-remove.

**It runs BEFORE `/update-docs`, and that ordering is the reason it exists.** `WORKTREE.md`
is gitignored, so it dies with the worktree — and it holds the findings that still have to
reach `docs/GOTCHAS.md`, `BACKLOG.md`, the plan and the PRD. The living documents are then
written from the **root checkout on `main`**, because no worktree edits them.

- **Invoke:** `/worktree-close`, or say the worktree's work is done.
- **Pairs with:** `/update-docs` (next), `/session-close` (last).
- **Details:** [.claude/skills/worktree-close/SKILL.md](.claude/skills/worktree-close/SKILL.md)

### `update-docs` — reconcile the three living documents

_Called `/session-close` before 2026-07-26._

SwimSync splits its knowledge across three documents by how often each changes:
**PRD.md** (what exists), **BACKLOG.md** (what doesn't yet), **HANDOVER.md**
(the state the next session inherits) — see [README.md](README.md). This skill
walks all three near the end of a session and updates each **by its own rule**,
so the split doesn't quietly collapse back into three copies of the same thing.

It gates each document rather than writing to all of them: the PRD is touched
only if a **shipped** behaviour changed, the backlog only if an idea arrived or
shipped, and the handover every time. Most sessions won't pass all three gates —
that's the intended outcome.

**This is the *reconciliation* pass, not the only time documentation is written.**
Per-change documentation is a shipping gate and belongs to `/commit-review`.
What lands here is the session log, next steps, test counts, and drift *between*
documents.

- **Invoke:** `/update-docs`, or say you're wrapping up / "update the docs".
- **Then run:** `/session-close`.
- **Details:** [.claude/skills/update-docs/SKILL.md](.claude/skills/update-docs/SKILL.md)

### `session-close` — shut the session down cleanly

**Writes no documentation.** It releases what the session was holding, which matters
because the local environment is shared between every worktree: fixture rows torn out
of the one database, dev servers stopped and ports released, nothing left uncommitted
or unpushed (including an untracked migration — see `docs/GOTCHAS.md` §7.55), and the worktree
given an explicit keep-or-remove decision.

Ends by handing back anything only *you* can do — production spot-checks needing your
login, decisions deliberately left open.

- **Invoke:** `/session-close`, or say you're done / closing the terminal.
- **Run `/update-docs` first** — step 1 checks that you did.
- **Details:** [.claude/skills/session-close/SKILL.md](.claude/skills/session-close/SKILL.md)

---

## Built-in skills

### Running & verifying your work

| Skill | What it does | Invoke when… |
|-------|--------------|--------------|
| `/run` | Launches and drives *any* app; finds a project skill first (so here it defers to `run-ui-playwright`), else falls back to built-in patterns. | "run the app", "start the server", "screenshot X" |
| `/verify` | Exercises a change end-to-end and observes real behaviour (drives the flow, not just tests/typecheck). Bootstraps a project verify skill if none exists. | Before committing a nontrivial change — e.g. after touching the invoice engine |

### Code quality & review

| Skill | What it does | Invoke when… |
|-------|--------------|--------------|
| `/code-review` | Reviews your current diff for correctness bugs + cleanup at a chosen effort (`low`…`max`). `--fix` applies findings; `--comment` posts inline PR comments. `/code-review ultra` runs a deep multi-agent cloud review of the branch/PR. | After writing code, before a PR. The credit-note fix was a good candidate |
| `/simplify` | Reviews changed code for reuse / simplification / efficiency and applies fixes. **Quality only — no bug hunting.** | To tidy a diff after it works |
| `/review` | Reviews a **GitHub pull request** (not your local diff — use `/code-review` for that). | Reviewing a teammate's PR |
| `/security-review` | Security review of pending changes on the branch. | Before shipping anything touching auth, RLS, or billing |

> Note on "ultrareview": `/code-review ultra` (deprecated alias `/ultrareview`)
> is a billed, user-triggered cloud review. It needs a git repo; the no-arg form
> bundles your local branch.

### Project setup & configuration

| Skill | What it does | Invoke when… |
|-------|--------------|--------------|
| `/init` | Generates/updates a `CLAUDE.md` documenting the codebase for Claude. | Onboarding the repo, or after big structural changes |
| `/update-config` | Configures the Claude Code harness via `settings.json` — permissions, env vars, and **hooks** (automated "whenever X do Y" behaviours). | "always allow npm", "run lint after edits", permission tweaks |
| `/fewer-permission-prompts` | Scans your transcripts for common safe commands and adds an allowlist to `.claude/settings.json` to cut permission prompts. | If approving the same commands repeatedly |
| `/keybindings-help` | Customize keyboard shortcuts / chords (`~/.claude/keybindings.json`). | Rebinding keys |

### Automation & scheduling

| Skill | What it does | Invoke when… |
|-------|--------------|--------------|
| `/loop` | Runs a prompt or slash command on a recurring interval (e.g. `/loop 5m /code-review`), or self-paced. | Poll a deploy, keep re-running a task |
| `/schedule` | Create/manage scheduled **cloud agents** (cron routines), or a one-off future run. | "every morning check open PRs", "run this at 3pm" |

### Docs, visuals & reference

| Skill | What it does | Invoke when… |
|-------|--------------|--------------|
| `/dataviz` | Design system for **any** chart/graph/dashboard (loaded before writing chart code). | Building an admin dashboard chart or billing report |
| `/artifact-design` | Design guidance for **Artifacts** (shareable hosted HTML/MD pages on claude.ai). | Producing a polished visual page/report to share |
| `/claude-api` | Reference for the Claude API / Anthropic SDK — model IDs, pricing, params, tool use, caching. | Adding any LLM feature to SwimSync |

---

## Quick reference

```
# Workflow (project skills) — full order in 01_SESSION_WORKFLOW.md
/session-start            read HANDOVER (the index); fetch the rest on demand       [once]
/plan-with-confidence     don't plan until >96% sure (asks questions first)     [per change]
/plan-review              rank a plan's product risk + add mitigations           [per plan]
/worktree-start           start a parallel worktree safely (AFTER planning)  [per worktree]
/commit-review            review, commit, AND push to main                     [per change]
/worktree-close           retire it + carry the graduate list out (BEFORE      [per worktree]
                          /update-docs)
/update-docs              reconcile PRD/BACKLOG/HANDOVER  (was: /session-close)     [once]
/session-close            shut down: fixtures, ports, unpushed work, worktree      [last]

# Run & verify
/run-ui-playwright        drive both SwimSync UIs in Chrome (project skill)
/run                      launch/drive the app (defers to the project skill)
/verify                   exercise a change end-to-end

# Review
/code-review [low|high|max]   review the current diff (add --fix / --comment)
/code-review ultra            deep multi-agent cloud review
/simplify                     tidy the diff (quality only)
/security-review              security pass on the branch
/review <PR>                  review a GitHub PR

# Setup & config
/init                     (re)generate CLAUDE.md
/update-config            permissions / env vars / hooks
/fewer-permission-prompts trim repeated permission prompts
/keybindings-help         customize shortcuts

# Automation
/loop <interval> <cmd>    run something on a repeat
/schedule                 scheduled cloud agents (cron)

# Reference / visuals
/dataviz  /artifact-design  /claude-api
```

_Type `/` in Claude Code to see the live list with descriptions._
