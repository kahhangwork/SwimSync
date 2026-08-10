# SwimSync

Attendance and billing for part-time private swimming coaches in Singapore.

Parents self-register and add their children; a superadmin assigns each child to a
class; the coach marks attendance week to week; invoices are generated from the
attendance that actually happened, and parents pay by PayNow. Corrections made after
an invoice goes out are handled with credit notes rather than by editing history.

**Live:** app at [swimsync.sg](https://swimsync.sg) · admin at
[admin.swimsync.sg](https://admin.swimsync.sg)

| Piece | Path | Stack |
|---|---|---|
| Mobile app (parent + coach) | `SwimSyncApp/` | Expo / React Native — also exported as a static web app |
| Admin panel (superadmin) | `SwimSyncAdmin/` | Next.js |
| Backend | `supabase/` | Supabase — Postgres, Auth, Storage, Edge Functions, RLS |

---

## The documents, and which one to write in

Four documents carry the project's knowledge. They're split by **how often they
change**, which is also the rule for deciding where something belongs. Putting a
fact in the wrong one is how it goes stale without anyone noticing.

| Document | Answers | Changes when | Lifetime |
|---|---|---|---|
| **[PRD.md](PRD.md)** | How does SwimSync behave? | A **shipped** behaviour changes | Long — it's the spec |
| **[BACKLOG.md](BACKLOG.md)** | What could we build, and why does it matter? | An idea arrives, or ships | Medium — items enter and leave |
| **[HANDOVER.md](HANDOVER.md)** | What's the state right now, what's next, **and where everything else lives** | Every working session | Short — rewritten constantly |
| **[LOCAL_DEV_GUIDE.md](LOCAL_DEV_GUIDE.md)** | How do I run and test it? | Setup changes | Long |

Beneath those sit the **reference** documents — read on demand, when a task touches them,
rather than up front. They were split out of `HANDOVER.md` on 2026-07-26, **keeping their
section numbers**, because that file had grown to 3,972 lines and half of it was a session
log:

| Document | Answers | Section |
|---|---|---|
| **[docs/GOTCHAS.md](docs/GOTCHAS.md)** | What trap is waiting for me here? | §7 |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Why is it built this way? Where do files live? | §6, §10, §12 |
| **[docs/TESTING.md](docs/TESTING.md)** | What does each suite and UI driver cover? | §5 |
| **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** | What's live, and what config traps bit us? | §11 |
| **[docs/WORKTREES.md](docs/WORKTREES.md)** | How do I run two sessions at once without clashing? | — |
| **[docs/SESSIONS.md](docs/SESSIONS.md)** | What shipped in an older session? | §8 ledger |

And **[CLAUDE.md](CLAUDE.md)** — loaded automatically into every Claude Code session, so
it holds only the commands, the boundaries, and the handful of rules whose violation is
expensive. Keep it under 200 lines; a new gotcha belongs in `docs/GOTCHAS.md`.

The distinction that does the real work:

- **PRD.md only describes what exists.** If it isn't built, it doesn't go in the PRD
  — that's what the backlog is for. Sections marked *(implemented)* record where the
  build refined or deliberately departed from the original spec; that annotation is
  load-bearing, because it separates "what we said in March" from "what the code
  does now."
- **BACKLOG.md only describes what doesn't exist yet.** Every item carries a **Why**.
  An item without one is a wishlist entry, and a wishlist is where ideas go to be
  ignored. When something ships, it leaves the backlog and lands in the PRD.
- **HANDOVER.md is written for the next session, not for posterity.** It's the only
  document allowed to be scrappy and dated. It points at the other two rather than
  restating them.

Two more, narrower: **[INVOICE_RUNBOOK.md](INVOICE_RUNBOOK.md)** is the monthly
invoice-generation procedure for the superadmin, and
**[AVAIL_SKILLS.md](AVAIL_SKILLS.md)** lists the Claude Code skills set up for this
repo. **[brand/](brand/)** holds the logo — `mark.svg` is the source of truth, and
every icon under `SwimSyncApp/assets/` and `SwimSyncAdmin/public/` is rasterised from
it; `brand/README.md` covers regeneration and the places the mark deliberately does
*not* go.

### Where everything lives

The root holds only what you read **regularly**. Everything else is one directory down,
categorised by what it *is*:

| Path | What |
|---|---|
| `01_SESSION_WORKFLOW.md` | **Start here** — which skill to run when |
| `CLAUDE.md` | Auto-loaded every session: commands, boundaries, the rules that bite |
| `README.md` `PRD.md` `BACKLOG.md` `HANDOVER.md` `LOCAL_DEV_GUIDE.md` | The living documents |
| `AVAIL_SKILLS.md` `INVOICE_RUNBOOK.md` | Reference and procedure |
| **`docs/`** | `GOTCHAS.md` (§7), `ARCHITECTURE.md` (§6/§10/§12), `TESTING.md` (§5), `DEPLOYMENT.md` (§11), `SESSIONS.md` (§8 ledger, moved 2026-08-10) — split out of `HANDOVER.md`, section numbers preserved |
| **`docs/design/`** | Designs of record — the settled decisions for a subsystem. `TENANCY_DESIGN.md`, `PACKAGES_DESIGN.md` |
| **`docs/plans/`** | Per-feature plans, with their ranked risks and pre-commit gates. Read the one for the area you're changing |
| **`docs/database/`** | `Database_AccessRuleSummary.md` — a historical artefact of the original build |

> **Filenames did not change, only directories.** A reference anywhere in the codebase to
> `TENANCY_DESIGN.md` or `PARENT_CLAIM_PLAN.md` still names the right file — it is now
> under `docs/`. That was deliberate: **34 of those references live inside applied
> migrations in `supabase/migrations/`**, which are the schema's history and are not
> edited after the fact. Renaming the files would have stranded every one of them.
>
> **The same trick, applied again on 2026-07-26 to *section numbers*.** When §5–§7 and
> §10–§12 left `HANDOVER.md` for `docs/`, they kept their numbers: `§7.41` still means
> gotcha 41. **781 references cite them by bare number**, including from applied migrations
> and Playwright drivers. Change the container, never the identifier — and never renumber a
> gotcha.
>
> **Numeric prefixes were considered and rejected** for everything except
> `01_SESSION_WORKFLOW.md`. Encoding a category into a filename makes recategorising a
> rename, and a rename breaks references — the cost recurs forever. Directories carry the
> category; the number survives on the one file whose whole job is to sort first. This
> mirrors the ADR convention, where the number is an immutable *sequence*, never a
> category.

The `Database_*` artefacts from the original build are historical — **the migrations in
`supabase/migrations/` are the schema's source of truth**, and `Database_*` should not be
edited.

### Keeping them honest

Two skills keep them honest. **`/commit-review`** ships each change and asks, at that
moment, whether `PRD.md` and `BACKLOG.md` move with it — per-change documentation is a
shipping gate, not an end-of-session chore. **`/update-docs`** then walks all three near
the end of a session and reconciles each by its own rule.

**Which skill to run when: [01_SESSION_WORKFLOW.md](01_SESSION_WORKFLOW.md)** — one page.
Full detail in [AVAIL_SKILLS.md](AVAIL_SKILLS.md).

> `/update-docs` was called `/session-close` until 2026-07-26. That name now belongs to a
> different skill — shutting the session down (fixtures, ports, unpushed work, worktree).

---

## Running it locally

Full instructions, seed logins, and the test commands are in
**[LOCAL_DEV_GUIDE.md](LOCAL_DEV_GUIDE.md)**. The short version — Docker Desktop must
be running:

```bash
supabase start                 # local stack: Studio :54323, Mailpit :54324
supabase db reset              # apply migrations + seed (wipes local data)

# Edge function (needed for invoice generation)
supabase functions serve generate-invoices --env-file supabase/functions/.env --no-verify-jwt

cd SwimSyncAdmin && npm run dev     # admin  → localhost:3000
cd SwimSyncApp   && npx expo start  # app    → press w for web
```

Tests:

```bash
supabase test db                                  # pgTAP: triggers, RLS, constraints
supabase/functions/generate-invoices/test.sh      # Deno: billing engine + credit ledger
cd SwimSyncAdmin && npm test                      # vitest
cd SwimSyncApp   && npm test                      # jest-expo
```

All four run in CI on every push to `main`.

---

## New here?

Read **HANDOVER.md** first — it is the index, and it points at everything else. Then
**PRD.md** for the product spec. The two that save the most time are
**`docs/GOTCHAS.md`** (§7 — traps that already cost real time; several exist because
something shipped a real billing bug) and **`docs/ARCHITECTURE.md`** (§6 — why the system
is shaped this way).

Don't read all of it up front. `HANDOVER.md` tells you which document the task needs.
