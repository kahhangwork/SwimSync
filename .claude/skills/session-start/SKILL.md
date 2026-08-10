---
name: session-start
description: Get up to speed at the start of a SwimSync session — read HANDOVER.md (the index) for the state you're inheriting, then fetch only the documents the task actually needs. Use at the start of a working session, when picking the repo back up, or when the user says "get up to speed", "catch up", or "where were we".
---

# Starting a SwimSync session

**Read `HANDOVER.md`. Then stop, and fetch only what the task needs.**

That is the whole method, and it is deliberately not "read the documentation". Until
2026-07-26 this skill told you to read four documents cover to cover — about **131,000
tokens** before any work began, half of it a session-by-session changelog. `HANDOVER.md` is
now an index: ~9,500 tokens, pointing at everything else. Fetching a reference document
when the task touches it is both cheaper *and* more accurate than carrying all of them —
recall degrades as context grows, and stale material sitting *near* the right answer
competes with it.

`CLAUDE.md` is already in your context automatically. You do not need to read it.

---

## Step 1 — `HANDOVER.md` — always, and usually the only thing you need

- Note `_Last updated:` so you know how fresh the state is.
- **§9 (Next steps)** is the payload: the 2–3 things to pick up next. That is usually where
  the session's work starts.
- **§3 (what works)** is the verified-state list — what actually runs end to end, as
  distinct from what the PRD *specifies*.
- **§8** holds the last two sessions in full and nothing else. Every older session is one
  row in **`docs/SESSIONS.md`** (moved 2026-08-10, numbers unchanged — `§8a` and `§8.n` are
  cited from `core.ts` and applied migrations and still resolve). Follow a row's pointer only
  if the task touches that area, and don't read the table top to bottom.
- The **"Where everything lives"** table at the top is the index. Use it in Step 2.

---

## Step 2 — Fetch what the task needs, and nothing else

Match the work to the document. Most sessions need one or two of these, not all.

| If the task involves… | Read |
|---|---|
| What the product does / a behaviour question | `PRD.md` — search it, don't read all 2,358 lines |
| Picking something to build, or an idea's history | `BACKLOG.md` — including **Deliberately not doing** |
| Running, testing, or seed logins | `LOCAL_DEV_GUIDE.md` |
| **Touching an unfamiliar subsystem** | **`docs/GOTCHAS.md`** — cheap insurance; these cost real time |
| Why something is built this way | `docs/ARCHITECTURE.md` (§6, §10, §12) |
| Adding or changing tests | `docs/TESTING.md` (§5) |
| Anything that will be deployed | `docs/DEPLOYMENT.md` (§11) |
| Billing a real month | `INVOICE_RUNBOOK.md` |
| A feature that already has a design or plan | `docs/design/`, `docs/plans/` |

**Section numbers are stable identifiers, not locations.** `§7.41` means gotcha 41 wherever
it lives. 781 references across the repo cite them by bare number — including from applied
migrations and Playwright drivers, which can never be corrected. So if you add a gotcha,
**append the next number and never renumber**.

**Read the gotchas before writing, not after debugging.** Several exist because something
shipped a real billing bug.

---

## Step 3 — Confirm you're oriented

Tell the user, in a few lines:

- **Where things stand** — the headline from §3 and the most recent §8 entry.
- **What §9 says to pick up next**, and which of those (if any) matches what they asked for.
- **Anything stale or contradictory** you noticed — a PRD line describing something unbuilt,
  a §9 "next step" that already shipped, a backlog item that now exists, a ledger pointer
  that leads nowhere. Surfacing drift at the start is cheap; it is expensive later.

If the user already said what they want to work on, go straight to it. The reading above
exists to do that work *well*, not to delay it.

---

## The mirror

`/update-docs` writes these documents back near the end of a session, under the rule that
makes this one cheap: **nothing durable may stay in the session log** — a gotcha goes to
`docs/GOTCHAS.md`, an accepted consequence to its plan, an unbuilt idea to `BACKLOG.md`, a
behaviour to `PRD.md`. If you ever need to read old §8 entries to understand something, that
rule was broken somewhere: say so, and promote the fact rather than leaving it buried.

For the full order of skills, see `01_SESSION_WORKFLOW.md`.
