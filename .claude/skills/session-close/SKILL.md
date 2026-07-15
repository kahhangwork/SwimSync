---
name: session-close
description: Close out a SwimSync working session by updating the three living documents by their own rules — PRD.md for shipped behaviour changes, BACKLOG.md for ideas raised or shipped, HANDOVER.md for the state the next session inherits. Use when the user says they're done, wrapping up, closing the session, "update the docs", or before a final commit at the end of a working session.
---

# Closing a SwimSync session

SwimSync keeps three living documents, split by **how often they change** (see
`README.md`). This skill walks all three at the end of a session and updates each by
its own rule.

| Document | Rule | Trigger to update |
|---|---|---|
| `PRD.md` | Describes **only what exists** | A shipped behaviour changed |
| `BACKLOG.md` | Describes **only what doesn't exist yet** | An idea arrived, or an item shipped |
| `HANDOVER.md` | Written **for the next session** | Every session |

## The failure mode to avoid

The way this goes wrong is **writing too much**. An update that dumps the session into
all three documents destroys the split that makes them useful — the PRD stops being a
spec, the backlog fills with noise, and the handover becomes a changelog nobody reads.

So: **each document has a gate below. Most sessions won't pass all three.** A session
that only fixed a test touches nothing but `HANDOVER.md`. That's the correct outcome,
not a skipped step. Prefer deleting a stale line to adding a new one.

---

## Step 1 — Establish what actually happened

Don't work from memory of the conversation alone; it over-weights whatever happened
most recently.

```bash
git log --oneline -15
git status
git diff --stat main...HEAD    # if on a feature branch
```

Read the `_Last updated:` date at the top of `HANDOVER.md` and treat everything since
as this session's work. Then write yourself a short list — **behaviour changes**
(a user can now do something they couldn't, or something behaves differently), **ideas
raised but not built**, and **everything else** (refactors, tests, docs). The third
bucket usually only reaches `HANDOVER.md`.

**Watch for changes you didn't make.** The user edits in their IDE while you work, and
other Claude sessions may be running against the same repo. If `git status` shows a file
you don't recognise, **check its mtime** (`ls -l <file>`) against your own edits before
assuming it's yours — then **ask**. Don't document it, don't commit it, don't "tidy" it.
Also check whether the branch is actually merged (`git branch --contains <sha>`,
`git log --oneline -1 main`): a `HANDOVER.md` that calls unmerged work "done" is a lie
the next session will believe.

Ask the user about anything ambiguous **before** writing. A wrong entry in the PRD is
worse than a missing one, because the PRD is what the next session trusts.

---

## Step 2 — PRD.md — only if shipped behaviour changed

**Gate — update only if a user-facing behaviour is now different from what the PRD
describes.** Not if you planned it, started it, or put it on the backlog. If it isn't
merged and working, it doesn't go here.

Does **not** belong in the PRD: refactors, test additions, CI, tooling, docs, anything
under `.claude/`, or anything about how the work was done. Those are `HANDOVER.md`.

When it does pass the gate:

1. **Find the section that's now wrong** and fix it in place. Don't append a note
   somewhere else saying it changed — a PRD with a correction bolted on at the bottom
   is a PRD that lies in the middle.
2. **Use the `*(implemented)*` convention** for anything where the build refined or
   departed from the original spec. This annotation is load-bearing: it separates "what
   we specified in March 2026" from "what the code does now." Follow the existing
   pattern — §5.1, §7.5, §9.15–9.17 are good examples. Where the departure was
   deliberate, **say why**, and say what was considered and rejected. §7.5 (lazy
   sessions, derived expectation) is the model to imitate.
3. **Update the build-status blockquote** near the top (under the title table) if the
   headline state of the product changed. Keep it a summary — it is already long, so
   prefer replacing a clause to adding a sentence.
4. **Leave §3.2 (Out of Scope for MVP) alone.** It's the historical record of the MVP
   scope decision. Those items are mirrored in `BACKLOG.md` as live options; §3.2 stays
   as-written.
5. **Check §18** (Final MVP Decisions Summary) — a behaviour change often makes a row
   there stale.

---

## Step 3 — BACKLOG.md — if ideas arrived or shipped

**Gate — update if either happened:**

### (a) An idea was raised but not built

Add it under the right theme heading. **Every item needs a `Why`** — that's the rule
that keeps the backlog from becoming a wishlist. If you can't say who it helps and what
breaks without it, don't add the item; ask the user for the reasoning, or leave it out.

Match the existing item shape:

```markdown
### Item name — **S/M/L** `[provenance tag]`
One-line description of what it is.

**Why:** who it helps, what breaks without it. Concrete, not aspirational.

**Notes:** prior decisions, constraints, schema facts, what to avoid. This is the part
that's worth more than the item itself — it's where hard-won reasoning survives.
```

Sizes: **S** = an afternoon, **M** = a few days, **L** = a genuine project.

The **Notes** field is the highest-value part of an entry. If the session discovered a
constraint, a gotcha, or a rejected approach, that belongs here — it's what stops the
next person re-deriving it. Link related items by name.

### (b) An item shipped

**Remove it from the backlog entirely** and make sure `PRD.md` now describes it
(Step 2). Do **not** leave it in place marked "done" — a backlog of completed items is
how it stops being a queue. The record of what shipped lives in git history, the PRD,
and the `HANDOVER.md` session log.

### (c) An idea was raised and rejected

If a decision was made *not* to do something, and the reasoning is worth keeping, add a
row to **Deliberately not doing** at the bottom. This is what stops the same idea being
re-litigated in three months. Be specific about *why not* — "adds a job, a schedule,
and edge cases for no gain" beats "not needed."

Also **prune**: if an item's reasoning has expired (its constraint is gone, or it was
overtaken), delete it or update its `Why`. A stale backlog item is worse than no item.

Update the `_Last updated:` date if you changed anything.

---

## Step 4 — HANDOVER.md — every session

This one always runs. It's the only document allowed to be scrappy and dated, and it's
written **for the next session**, not for posterity.

1. **`_Last updated:`** → today's date.
2. **Add a new "What changed this session" section** as the new §8, and **renumber the
   previous one down** (§8 → §8b, §8b → §8c, …). Follow the existing style: lead with
   the headline in bold, then what was found, what was fixed, and — crucially — **what
   was deliberately not done and why**. Those "Not done (deliberate)" notes have
   repeatedly stopped later sessions from undoing good decisions.
3. **Rewrite §9 (Next steps).** This is the section that rots fastest.
   - It should hold **the 2–3 things to actually pick up next**, no more. For the wider
     queue, **point at `BACKLOG.md`** rather than restating it — restating is how the
     two drift.
   - Move anything finished this session out of the "open" list.
   - §9 has a "record of already-DONE work" tail. It's growing and it competes with git
     history. **Prune it** — drop entries whose reasoning is now in the PRD or captured
     in a §8x session log.
4. **§6 (Architecture & key decisions)** — add an entry if a decision was made that a
   future session could accidentally undo. This is for *why*, not *what*.
5. **§7 (Gotchas already hit)** — add an entry if the session hit something non-obvious
   that cost real time. Several entries there exist because something shipped a real
   billing bug; that bar is about right. Include the audit command if there is one.
6. **§10 (File map)** — add a row for any significant new file.
7. **§5 (Running the tests)** — update the counts if suites changed.

Keep §3 ("what works") and §11 (deployment) honest — if the session changed what's
live, they're the first things a new session reads.

---

## Step 5 — Check the other docs

Quick pass, only if relevant:

- **`README.md`** — only if the document split itself changed, or the stack did.
- **`LOCAL_DEV_GUIDE.md`** — if run/test commands or seed data changed.
- **`INVOICE_RUNBOOK.md`** — if anything about invoice generation changed. This one is
  operational: the superadmin follows it on the 1st with real money at stake.
- **`AVAIL_SKILLS.md`** — if a skill was added or changed.

---

## Step 6 — Commit

**Stage explicitly — never `git add -A` or `git add .`.** List the paths you actually
touched. If Step 1 turned up work in progress that isn't yours, `git add -A` sweeps it
into your commit, which is how someone's half-finished screen ships without review.
Verify before committing:

```bash
git add <the paths you touched>
git diff --cached --name-only   # must contain only your files
git diff --name-only            # what you're leaving behind — check it's intentional
```

Then commit. **Use `/commit-review`** so the doc changes get the same read as code —
**unless the working tree holds changes that aren't yours**, in which case commit the
staged set directly: `/commit-review` reads the whole working diff and will review, and
possibly "fix", someone else's unfinished work.

The repo's workflow (HANDOVER §2): feature branch → merge to `main` → push → delete the
branch. No PRs unless the user asks. **Confirm the merge with the user** rather than
assuming — another session may own the branch.

---

## Final check

Before declaring done, re-read what you wrote and ask:

- **Could the next session act on §9 without reading the whole conversation?** That's
  the actual test of a handover.
- **Does anything in `PRD.md` now describe something that isn't built?** If so, it
  belongs in `BACKLOG.md`.
- **Does anything in `BACKLOG.md` describe something that now exists?** If so, remove
  it — it belongs in `PRD.md`.
- **Did you write the same thing in two documents?** Pick one and link from the other.
  Duplication between these files is the thing that eventually makes them disagree.

Then tell the user plainly which documents you changed and which you deliberately
didn't, and why. "PRD untouched — nothing shipped a behaviour change" is a useful
sentence, not a missing step.
