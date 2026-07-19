# SwimSync — Available Skills

A reference to the **skills** available when working on SwimSync with Claude Code:
what each one does, how to invoke it, and when it's useful here.

_Last updated: 2026-07-16_

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

### Workflow skills — plan → build → commit → close

Four prompt-driven skills that enforce a disciplined workflow. All four are
**explicit-invocation only** (type the slash command); they don't auto-fire.
Chain them: `/plan-with-confidence` → `/plan-review` → build → `/commit-review`,
then `/session-close` when the session ends.

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

#### `commit-review` — Senior-Engineer review, then commit

Gates a commit behind a thorough self-review: finds errors / inconsistent
logic / inefficiencies / bug risks, lists them most-critical-first, fixes them,
then commits.

- **Invoke:** `/commit-review`, or ask to "review and commit".
- **Details:** [.claude/skills/commit-review/SKILL.md](.claude/skills/commit-review/SKILL.md)

### `session-start` — get up to speed before touching code

The mirror of `session-close`. Reads the four orientation documents **in order** —
`HANDOVER.md` (state you're inheriting) → `PRD.md` (what exists) → `BACKLOG.md`
(what doesn't yet, and why) → `LOCAL_DEV_GUIDE.md` (exact run/test commands + seed
logins) — then reports where things stand, what's next per HANDOVER §9, and any
drift it spotted across the docs. The order is the fastest path from cold to
productive.

- **Invoke:** `/session-start`, or say "get up to speed" / "catch up" / "where were
  we" at the start of a session.
- **Pairs with:** `/session-close` (writes these same documents back at session end)
  and `/run-ui-playwright` (uses the seed logins to drive the UI).
- **Details:** [.claude/skills/session-start/SKILL.md](.claude/skills/session-start/SKILL.md)

### `session-close` — update the three living documents, then commit

SwimSync splits its knowledge across three documents by how often each changes:
**PRD.md** (what exists), **BACKLOG.md** (what doesn't yet), **HANDOVER.md**
(the state the next session inherits) — see [README.md](README.md). This skill
walks all three at the end of a session and updates each **by its own rule**,
so the split doesn't quietly collapse back into three copies of the same thing.

It gates each document rather than writing to all of them: the PRD is touched
only if a **shipped** behaviour changed, the backlog only if an idea arrived or
shipped, and the handover every time. Most sessions won't pass all three gates —
that's the intended outcome.

- **Invoke:** `/session-close`, or say you're wrapping up / "update the docs".
- **Pairs with:** `/commit-review`, which it hands off to at the end.
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
# Workflow (project skills, explicit-invocation only)
/session-start            read HANDOVER→PRD→BACKLOG→LOCAL_DEV_GUIDE, get oriented
/plan-with-confidence     don't plan until >96% sure (asks questions first)
/plan-review              rank a plan's product risk + add mitigations
/commit-review            Senior-Engineer review, then commit
/session-close            update PRD/BACKLOG/HANDOVER by their own rules, then commit

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
