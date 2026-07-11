# SwimSync — Available Skills

A reference to the **skills** available when working on SwimSync with Claude Code:
what each one does, how to invoke it, and when it's useful here.

_Last updated: 2026-07-11_

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
