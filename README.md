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
| **[HANDOVER.md](HANDOVER.md)** | What's the state right now, and what's next? | Every working session | Short — rewritten constantly |
| **[LOCAL_DEV_GUIDE.md](LOCAL_DEV_GUIDE.md)** | How do I run and test it? | Setup changes | Long |

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
*not* go. The `Database_*` files at the root are historical artefacts from the original
build — **the migrations in `supabase/migrations/` are the schema's source of truth**,
and the `Database_*` files should not be edited.

### Keeping them honest

The `/session-close` skill walks all three of the changing documents at the end of a
working session and updates each by its own rule. See
[AVAIL_SKILLS.md](AVAIL_SKILLS.md).

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

Read **HANDOVER.md** first for the current state, then **PRD.md** for the product
spec. HANDOVER §6 (architecture decisions) and §7 (gotchas already hit) will save you
the most time — several entries there exist because something shipped a real billing
bug.
