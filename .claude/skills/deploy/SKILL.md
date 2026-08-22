---
name: deploy
description: Verify the SwimSync deploy SEQUENCE before shipping, then ship in order. Use whenever you are about to deploy a change to production — a migration, the billing engine / an edge function, the web apps, or any mix. It classifies what is changing, derives the correct order (migrations → engine/functions → apps, apps to main LAST), and HARD-GATES the app push behind "the backend it depends on is already live on prod". Built to prevent the recurring mistake of pushing apps to main before their migration is on prod (§7.60, §11.9).
---

# deploy — check the sequence, then ship

**One rule, and it is the whole point of this skill:**

> **Backend goes to prod FIRST (migrations → engine → edge functions), the web
> apps go to `main` LAST.** `git push … :main` **IS** the app deploy — Vercel
> builds both sites from `main` the moment you push. So if the new UI reads a
> column, RPC, or table the production database does not have yet, pushing apps
> first breaks production for every user until the migration catches up.

This has gone wrong **more than once** (§11.9 — two worktrees shipped apps ahead
of their migration; and again when the parent Billing page shipped reading
`cancel_extension_days` before that column was on prod). The mistake is invisible
from inside the app deploy — a push succeeds, the bundle greps clean — and only
`supabase migration list --linked` reveals it. This skill runs that check as a
**gate**, not an afterthought.

**Do not skip to `git push`. Walk the steps. The gate before the app push is the
skill.**

---

## Step 0 — Preflight

```bash
git -C . fetch origin
git status --short                 # working tree state
git rev-parse --abbrev-ref HEAD    # which branch
git log --oneline origin/main..HEAD   # commits NOT yet on main (the app deploy set)
git log --oneline -5 origin/main      # what is already on main = live for web apps
```

- **`git log origin/main` is the honest answer to "what's live for the web apps"** —
  never a SHA written in prose (§7.60). Trust the command.
- If the working tree is dirty with changes that belong in this deploy, commit
  them first (`/commit-review`). This skill deploys **committed** work.
- **Worktree?** A worktree never authors a migration, and splitting one change
  across worktrees splits its deploy so no worktree sees the whole of it (§11.9).
  If a migration is part of this change, deploy it from the **root checkout** and
  land it on prod **before** the first app branch reaches `main`.

---

## Step 1 — Classify what is changing

Look at the change set you are about to ship (default range: `origin/main..HEAD`;
if those are already pushed, use the feature commits since the last deploy):

```bash
git diff --stat origin/main..HEAD
```

Sort the changed paths into the four surfaces — each has its **own** deploy
mechanism, and a `git push` carries only the last one:

| Surface | Paths | How it deploys | Verify it landed |
|---|---|---|---|
| **Migrations** | `supabase/migrations/*` | `supabase db push` (manual) | `supabase migration list --linked` → `remote` filled, **0 pending** |
| **Billing engine** | `supabase/functions/generate-invoices/core.ts` (behaviour) | `supabase functions deploy generate-invoices` (manual) | grep the served bundle for a new string (§7.31/§7.51) |
| **Other edge functions** | `supabase/functions/<name>/` | `supabase functions deploy <name>`, **one at a time** | `supabase functions list`, then bundle grep |
| **Web apps** | `SwimSyncApp/`, `SwimSyncAdmin/` | **`git push origin <branch>:main`** (Vercel) | served-bundle grep on the live URL |

Notes that decide whether a surface is really in play:
- **A comment-only `core.ts` change needs NO engine deploy** — the transpiled
  bundle is identical. Confirm the change is behavioural before planning an engine
  step. (Same logic for any function: no behaviour change ⇒ no deploy.)
- **A migration that only ADDS** (a column, a table, a new function) is far safer
  to have land late than one that DROPS or narrows — but "safe late" is a property
  of that migration, never of the mistake (§11.9). Order it first anyway.
- **A dropped/renamed column is the sharp case**: the still-deployed bundle's
  `.select()` calls name it and 400 for the whole window. Keep the window short and
  check the client `.select()` lists as carefully as the RPC signatures (§7.145, §11.10).

---

## Step 2 — The cross-check that catches THE bug

**Before anything ships, answer this explicitly:** does the **app** diff read any
DB object (column, RPC, table, policy) that **only exists after** a migration in
this same change set?

```bash
# List the new/changed DB identifiers in the pending migration(s):
git diff origin/main..HEAD -- supabase/migrations | grep -iE '^\+.*(ADD COLUMN|CREATE (TABLE|FUNCTION|POLICY)|CREATE OR REPLACE FUNCTION)'
# ...then grep the app diff for each new name (column / rpc / table):
git diff origin/main..HEAD -- SwimSyncApp SwimSyncAdmin | grep -iE '\+.*(<name1>|<name2>|\.rpc\(|\.select\()'
```

If the answer is **yes** (e.g. the Billing page now selects a new column), then
the migration is a **hard predecessor**: it MUST be confirmed on prod before the
app push, no exceptions. This is the exact dependency the recurring mistake
ignores. Write it down as the first gate.

---

## Step 3 — Print the ordered plan, then execute top-down

State the plan back before running it — the order is the deliverable:

```
1. Migration(s) → prod        (if any)   [db push → migration list --linked]
2. Engine / edge functions → prod (if any) [functions deploy → bundle grep]
3. ── GATE: backend confirmed live on prod ──
4. Apps → main                (the git push that Vercel deploys)
5. Post-deploy verification   (served-bundle grep on the live URL)
```

Skip any step whose surface is not in the change set. If ONLY apps changed (no
migration, no engine, no function), there is no backend to wait on — steps 1–3
are empty and you go straight to the app push. Say that explicitly so "no gate
needed" is a decision, not an omission.

### 3a. Migrations → prod (if any)

Migrations do NOT ride a git push. Land the migration commit on `main` first
(it is the root checkout's to push — §7.55), then:

- **Rehearse the rollback FIRST** (§7.93): apply UP, apply the committed `DOWN`,
  diff every touched function with `pg_get_functiondef()` **byte-identical**, re-run
  the pre-migration test file under the rolled-back schema, re-apply UP. A committed
  DOWN that has never run has hidden bugs (§7.92). Budget ~10 min / 3 `db reset`.
- Then push to prod. **You may need to run this yourself** — the sandbox often
  blocks `supabase db push`; run it with a leading `!` in the prompt, or via a
  terminal, and paste the output back.

  ```
  supabase db push
  supabase migration list --linked      # THE FACT: remote column filled, 0 pending
  ```

- **The `pgdelta` certificate stack trace is NORMAL output**, printed alongside
  `Finished supabase db push` many times now — it is not an incident (§7.49). The
  proof is `migration list --linked`, never `db push`'s own output.
- **If the migration touched privileges (a new function/table/policy, a GRANT/REVOKE):
  take the remote grant dump** — the only honest check (§7.39, §11.7). Local and
  cloud disagree by construction (the cloud grants `anon` EXECUTE on new functions;
  local does not):

  ```
  supabase db dump --linked -f /tmp/remote_dump.sql
  # confirm no anon/PUBLIC EXECUTE on this change's new functions:
  grep -iE '<newfn>' /tmp/remote_dump.sql | grep -iE 'grant|revoke'
  ```

### 3b. Engine / edge functions → prod (if any)

```
supabase functions deploy generate-invoices    # or <name>, ONE at a time
supabase functions list                         # confirm the new version
```

- **A 200 proves nothing.** Grep the served bundle for a user-visible string only
  the new build has (§7.31/§7.51).
- A transient TLS / bundling error on the first deploy has happened — **retry once
  before diagnosing** (§11.37).

### 3c. ── THE GATE ── (do not cross until this is true)

Before pushing apps to `main`, assert **all** of:

- [ ] `supabase migration list --linked` shows **0 pending** — every migration this
      app change depends on is already on prod. *(This one check would have caught
      the recurring mistake.)*
- [ ] Any engine/function this app change depends on is deployed and bundle-grep
      confirmed.
- [ ] Grant dump clean (if privileges changed).

If any box is unchecked, **STOP** — deploying the apps now breaks prod. Finish the
backend steps first.

### 3d. Apps → main (LAST)

```bash
git push origin <branch>:main      # fast-forward only — REJECTS if a sibling pushed first
git -C <root> merge --ff-only origin/main
```

Push **branch-to-branch** (`<branch>:main`), never by checking out `main`. The
fast-forward-only push is the safety property — it fails loudly instead of merging
work you have not seen.

---

## Step 4 — Post-deploy verification

- **Web apps:** wait for the Vercel build (~1–3 min), then load the live URL
  (`admin.swimsync.sg` / `swimsync.sg`) and confirm a user-visible string only the
  new build has is present — for a data-reading change, that the affected page
  actually loads. A green build is not proof the page works against prod data.
- **Migrations:** `supabase migration list --linked` remote filled, 0 pending (again,
  from the linked project, not memory).
- **Engine/functions:** served-bundle grep.

Report: what deployed, in what order, each verification that passed, and anything
left (a follow-up deploy, a manual step).

---

## The failure modes this skill exists to stop

- **Apps before migration** (§11.9, and the `cancel_extension_days` repeat): the app
  push succeeds, the bundle greps clean, and prod breaks silently on a missing
  column/RPC. Only `migration list --linked` shows it. → Step 3c gate.
- **"A git push deployed everything."** It deploys the web apps ONLY. Not the
  migration (`db push`), not the edge function (`functions deploy`). → Step 1 table.
- **"`db push` said Finished, so it applied."** The `pgdelta` stack trace prints next
  to `Finished` and means nothing. → `migration list --linked` is the fact.
- **"200 / green build, so it's live."** Grep the served bundle for a new string. → Step 4.
- **Privilege drift** local-vs-cloud: `anon` silently keeps EXECUTE on a new function
  on the cloud. → Step 3a grant dump.
- **Rollback that was never run:** a committed DOWN with valid-looking SQL that
  silently drops safety refusals (§7.92). → Step 3a rehearsal.

## Relationship to the other skills

`/commit-review` gets the change **onto `main`** (which, for an app-only change, is
already the deploy). `/deploy` is for anything with a **backend** piece that must
reach prod in a specific order — it wraps the git push in the migration/engine
sequencing and the gate. When both apply, commit first (`/commit-review` lands the
migration commit on `main`), then run `/deploy` to push the migration to prod and
sequence the rest. `docs/DEPLOYMENT.md` §11 holds the worked deploy records; this
skill is the checklist those records follow.
