---
name: session-start
description: Get up to speed at the start of a SwimSync session by reading the four orientation documents in order — HANDOVER.md for the state you're inheriting, PRD.md for the product spec, BACKLOG.md for what's queued but unbuilt, and LOCAL_DEV_GUIDE.md for the exact run/test commands and seed logins. Use at the start of a working session, when picking the repo back up, or when the user says "get up to speed", "catch up", or "where were we".
---

# Starting a SwimSync session

SwimSync keeps its working knowledge in a handful of living documents. Before touching
code, read the four orientation documents **in this order** — each answers a different
question, and the order is the fastest path from cold to productive.

| # | Document | Answers |
|---|---|---|
| 1 | `HANDOVER.md` | What state am I inheriting? What was done last, what's next? |
| 2 | `PRD.md` | What is the product, and what does it currently do? |
| 3 | `BACKLOG.md` | What's queued but not built yet — and *why*? |
| 4 | `LOCAL_DEV_GUIDE.md` | How do I actually run and test it, and which logins do I use? |

This is the mirror of `/session-close`, which writes these documents back at the end of a
session. Read them the way it wrote them: each in its own lane.

---

## Step 1 — HANDOVER.md — read this first

Start here, always. It's written **for the session about to begin** — you — and it's the
one document allowed to be scrappy and dated.

- Note the `_Last updated:` date at the top so you know how fresh the state is.
- **§9 (Next steps)** is the payload: the 2–3 things to pick up next. That's usually
  where the session's work starts.
- **§8x (What changed last session)** tells you what just shipped and — crucially — what
  was **deliberately not done and why**. Don't undo those decisions.
- **§3 (what works)** and **§7 (Gotchas already hit)** are worth a scan before you write
  anything: §7 exists because those gotchas cost real time (some shipped billing bugs).

---

## Step 2 — PRD.md — what exists

The product spec. **It describes only what is actually built** — so read it as the source
of truth for current behaviour, not a roadmap.

- Watch for the **`*(implemented)*`** annotations: they mark where the build refined or
  departed from the original spec, and usually say why. That's where the real behaviour
  lives when it differs from the plan.
- The **build-status blockquote** near the top is the fastest summary of headline state.
- If anything in the PRD seems to describe something that isn't built, treat that as a
  bug in the doc, not a fact — flag it rather than trusting it.

---

## Step 3 — BACKLOG.md — what doesn't exist yet

Everything queued but unbuilt, split by theme. **Nothing here is built** — don't assume a
backlog item exists in the product.

- Each item carries a **`Why`** (who it helps, what breaks without it) and often a
  **`Notes`** field — the Notes hold hard-won constraints, gotchas, and rejected
  approaches. If the session's task touches a backlog area, read its Notes first; it may
  save you re-deriving something.
- Check **Deliberately not doing** at the bottom before proposing anything new — it
  records ideas already considered and rejected, so you don't re-litigate them.

---

## Step 4 — LOCAL_DEV_GUIDE.md — how to run and test it

The operational reference: the **exact** run/test commands and the **seed logins** for
each role (parent / coach / superadmin). Don't guess these — copy them from here.

- Note the prerequisites (Docker + local Supabase stack) before trying to run anything.
- Grab the seed credentials for whichever role the task needs.
- For driving the real UI, this pairs with `/run-ui-playwright`.

---

## Then: confirm you're oriented

Before starting work, tell the user in a few lines:

- **Where things stand** — the headline state from HANDOVER §3 + the last session's §8.
- **What §9 says to pick up next**, and which of those (if any) matches what they've
  asked for.
- **Anything stale or contradictory** you noticed across the four documents — a PRD line
  that describes something unbuilt, a HANDOVER "next step" that already shipped, a backlog
  item that now exists. Surfacing drift at the start is cheap; it's expensive later.

If the user already told you what they want to work on, go straight to that — the reading
above is to do it *well*, not to delay it.
