---
name: update-docs
description: Reconcile SwimSync's three living documents with everything that happened this session — PRD.md for shipped behaviour changes, BACKLOG.md for ideas raised or shipped, HANDOVER.md for the state the next session inherits. Run once, near the end of a session, after the code has shipped. Use when the user says "update the docs", is wrapping up, or asks to reconcile the documentation. This does NOT shut the session down — that is /session-close.
---

# Reconciling SwimSync's living documents

> **This skill was called `/session-close` until 2026-07-26.** It was renamed because the
> name promised a lifecycle step and delivered a documentation pass, so it got deferred by
> anyone who "wasn't closing anything yet" — which is how a shipped feature spent hours
> live while `BACKLOG.md` still advertised it as unbuilt.
>
> **Where it sits in the session:** per-change documentation is a *shipping* gate and
> belongs to `/commit-review` — if a change alters what a user can do, `PRD.md` and
> `BACKLOG.md` move in the *same push* as the code. This skill is the once-per-session
> **reconciliation** that follows: the session log, next steps, test counts, and drift
> between documents. When you are done here, run **`/session-close`** to shut down.
> See `01_SESSION_WORKFLOW.md`.

SwimSync keeps three living documents, split by **how often they change** (see
`README.md`). This skill walks all three at the end of a session and updates each by
its own rule.

| Document | Rule | Trigger to update |
|---|---|---|
| `PRD.md` | Describes **only what exists** | A shipped behaviour changed |
| `BACKLOG.md` | Describes **only what doesn't exist yet** | An idea arrived, or an item shipped |
| `HANDOVER.md` | An **index** + the state you're inheriting | Every session |

Since 2026-07-26 the reference material lives in `docs/`, so there is a fourth rule that
governs all of them — **Step 4, graduation**:

| Reference document | Holds | Numbering |
|---|---|---|
| `docs/GOTCHAS.md` | §7 — traps that already cost time | **Append only. Never renumber.** |
| `docs/ARCHITECTURE.md` | §6 decisions, §10 file map, §12 removed UI | stable |
| `docs/TESTING.md` | §5 — what each suite and driver covers | stable |
| `docs/DEPLOYMENT.md` | §11 — what's live and its config traps | stable |
| `CLAUDE.md` | Always-loaded: commands, boundaries, the few rules that bite | **keep under 200 lines** |

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

## Step 4 — GRADUATE first — this is the step that keeps the docs small

**Do this BEFORE writing anything into `HANDOVER.md` §8.** It is the whole discipline;
the rest of Step 5 is bookkeeping once this is done.

Every durable thing the session produced gets a permanent home **outside** the session
log. Walk the list and place each one:

| What you found | Where it goes |
|---|---|
| A trap that cost real time / could bite again | **`docs/GOTCHAS.md`** — append as the next §7.N |
| A decision a future session could accidentally undo | **`docs/ARCHITECTURE.md`** (§6) |
| A consequence you accepted deliberately | the feature's plan in **`docs/plans/`**, its "known consequences" section |
| Something you chose *not* to build | **`BACKLOG.md`** — item, or *Deliberately not doing* |
| A behaviour a user can now see | **`PRD.md`** (Step 2) |
| A new significant file | **`docs/ARCHITECTURE.md`** (§10 file map) |
| A suite/driver added or changed | **`docs/TESTING.md`** (§5) |
| Something that changed what's live | **`docs/DEPLOYMENT.md`** (§11) |

**Rules for `docs/GOTCHAS.md`:** append as the next number, **never renumber and never
reuse a number** — 781 references cite these by bare number, including from **applied
migrations** that can never be corrected. Retire an item by striking it in place. The bar
is "cost real time or shipped a bug", not "was mildly surprising".

**Test 1 — nothing LOST.** After this step, the session log entry you are about to write
should contain **nothing that would be lost if you deleted it.** If it would, you haven't
graduated everything — go back. An audit of all 29 historical entries found exactly four
facts that had never graduated, and every one of them was a *prohibition* ("do not turn
this into a trigger") — the highest-value, easiest-to-lose kind.

**Test 2 — nothing DUPLICATED. This is the one that was missing, and it is why the file
doubled in nine days.** Test 1 only detects *under*-graduation. A session entry that
faithfully **re-tells** the gotcha it just filed passes Test 1 perfectly — nothing would be
lost, because it is all safely in `docs/` — while duplicating every word of it. That is
exactly what the 1,400-character ledger rows are.

So, for each sentence you are about to write into §8: **is this fact now in `docs/`, the
PRD, or `BACKLOG.md`?** If yes, delete the sentence and keep the pointer. The graduated
copy is the one that gets maintained; the copy in §8 is the one that goes stale and then
competes with it. **Graduating a fact means MOVING it, not copying it.**

---

## Step 5 — HANDOVER.md — every session

`HANDOVER.md` is an **index plus the current state**. It is not a changelog.

> **Measure the file BEFORE you write, not after** — `wc -c HANDOVER.md`. **The budget is
> 45,000 bytes.** Write the number down; if you are near it, your first job this session is
> to cut, not to append.
>
> **Nothing enforces this but you, and that has failed twice.** The rule used to be "keep
> it under ~700 lines", asked as a question in the Final check — i.e. *after* everything is
> written, when the only remedy left is a restructure. The file crossed 700 on 2026-08-06
> and reached **1,001 lines / 91 KB** by 2026-08-10, through five `/update-docs` runs that
> each asked that question and waived it. Before that, the same route had taken it to
> 3,972 lines / 290 KB. **Measuring at the start is the entire difference** — it is the one
> point where cutting is cheap.

**Every rule below is a SIZE, not a shape, and every one is countable in a single command.**
That distinction is the whole reason this section exists: the old rules ("one ledger
*line*", "a *one-line* summary", "prefer deleting a stale line") were obeyed to the letter
all the way from 38 KB to 91 KB, because a markdown row and a dateline have no length
limit. **Shapes do not bound anything, and neither does judgement.** "Delete what's stale"
asks the person who just wrote the material to rule it stale, which is why §3 grew from 410
to 469 lines while carrying a note at its own top saying it was the next thing to cut.

Run these three. They take ten seconds together and they are the whole of the discipline:

```bash
wc -c HANDOVER.md                                              # budget 45000
grep -c '^_Previously,' HANDOVER.md                            # must be ≤ 1
awk '/^\| \*\*8/ && length($0)>200 {print length($0), $0}' HANDOVER.md | sort -rn | head
                                                               # must print NOTHING
```

1. **`_Last updated:`** → today's date, and a summary of **at most 3 lines**.
   - **Keep at most ONE `_Previously,_` dateline below it, then delete the rest.** They had
     stacked **five sessions deep, 138 lines**, by 2026-08-10. A
     `_Previously,_` block is a *third* copy of a session that §8 already holds as a full
     entry and again as a ledger row — nobody reads three copies, and they disagree first.
2. **Write the new session entry** at the top of §8, numbered as the next `§8.N`.
   - **The two most recent entries stay in full. Everything older becomes one row in
     `docs/SESSIONS.md`** — number, date, what shipped, and **where its reasoning now
     lives**. So each session you demote the third-newest entry out of this file entirely.
   - Lead with the headline in bold, then what was found, what was fixed, and **what was
     deliberately not done and why**. Keep it to what a reader needs *before* the pointers
     take over; the reasoning itself is already in `docs/` by Step 4.
   - **A ledger row has a HARD CAP of 200 characters** — number, date, what shipped in one
     clause, and the pointers. It is a *pointer*, not a summary. Measure it; do not eyeball
     it. The July rows cost ~130 chars, which is the ~25 tokens this rule always claimed.
     The rows written across August average **1,050 chars and peak at 1,446** — ten times
     the stated budget, every one of them still technically "one row". A row that needs
     more than 200 chars is a row whose reasoning has **not** been graduated: go back to
     Step 4 and give it a home, then point at that home.
   - **Never delete a ledger row.** They are cited by number from source files and applied
     migrations (`core.ts` says `§8a`), so a missing row is a dangling reference.
   - **Verify each pointer resolves before you write it.** `grep` the target for the number.
     §8.38's row cited `§7.108` for a `SECURITY DEFINER` audit-trigger lesson; §7.108 is about
     a Playwright cold-compile timeout, and **no gotcha covered the lesson at all** — so the
     row carried the full narrative *because* the delegation it claimed was never checked.
     Found and fixed 2026-08-10 (the missing gotcha is now §7.120). A wrong pointer is what
     turns a ledger back into a changelog.
   - **The ledger lives in `docs/SESSIONS.md`** (moved 2026-08-10 at 21.5 KB / 51 rows).
     Its old move-out trigger was "~100 rows", which at August's row sizes would have meant
     a **100 KB** ledger — the table would have become the entire file long before a
     row-count trigger fired. Keep it there; §8 holds the two full entries and a pointer.
3. **Rewrite §9 (Next steps).** This is the section that rots fastest.
   - **The 2–3 things to actually pick up next**, no more. For the wider queue, **point at
     `BACKLOG.md`** rather than restating it — restating is how the two drift.
   - Move anything finished this session out of the "open" list, and delete DONE tails:
     git history is the record of what shipped.
4. **Keep §3 ("what works") honest — and pay for a new bullet by removing one.**
   §3 is **469 lines, 42% of the file**, and it is append-only by construction: every
   session adds what it verified and nothing prunes, because "prefer editing a line to
   adding one" is advice with no counter. Since 2026-07-26 exactly **one** bullet has ever
   been graduated out.
   - A bullet earns its place in §3 only if it carries a **prohibition** ("don't re-add a
     count", "no rate is the finished state") or a **verified-vs-specified** distinction —
     something `PRD.md` cannot tell you. If the PRD already specifies the behaviour in full
     and there is no prohibition, **the PRD is the home**: cite it and delete the bullet.
   - So: adding a bullet is fine. Adding a bullet **without deleting one** needs a reason
     you can say out loud.
5. **Check the index table** at the top ("Where everything lives") if a document was added,
   moved or retired.

**The failure mode this shape exists to prevent:** §8 was once 49% of a 3,972-line file —
29 narratives, of which 25 were fully redundant with `docs/` and the PRD. Stale content
that is *topically adjacent* to the truth is worse than no content, because it competes
with the right answer. Graduating first and demoting on schedule is what stops it
re-accumulating.

---

## Step 6 — Check the other docs

Quick pass, only if relevant:

- **`CLAUDE.md`** — only if a *command*, a *boundary*, or one of the few always-on rules
  changed. This file is loaded on **every** session, so it is the most expensive place to
  add a line and the cheapest place to mislead. **Under 200 lines.** A new gotcha goes in
  `docs/GOTCHAS.md`, not here — promote one up only if a session could plausibly break
  something expensive *without* having read the gotchas file.
- **`README.md`** — only if the document split itself changed, or the stack did.
- **`LOCAL_DEV_GUIDE.md`** — if run/test commands or seed data changed.
- **`INVOICE_RUNBOOK.md`** — if anything about invoice generation changed. This one is
  operational: the superadmin follows it on the 1st with real money at stake.
- **`AVAIL_SKILLS.md`** — if a skill was added or changed.

---

## Step 7 — Commit

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

`/commit-review` carries the change through to `main` (fetch → rebase → re-run the suites
→ fast-forward-only push). **Ship this doc commit the same way you shipped the code**, and
**confirm the merge with the user** rather than assuming — another session may own the
branch. Don't re-derive the git steps here; they live in `/commit-review` Step 5.

Then run **`/session-close`** — fixtures torn down, servers stopped, nothing unpushed,
worktree disposition.

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
- **Would your §8 entry lose anything if it were deleted tomorrow?** If yes, Step 4 isn't
  finished — the durable part still needs a home in `docs/`, the PRD, or `BACKLOG.md`.
- **Did you demote the third-newest §8 entry to a ledger row, and is that row ≤200 chars?**
  Two full entries, no more. Demotion is a **compression**, not a rename — a 4 KB entry that
  becomes a 1.4 KB row has been renamed, and the file still grows every session forever.
- **Re-run the three commands from Step 5.** `wc -c HANDOVER.md` under 45,000; at most one
  `_Previously,_`; no ledger row over 200 chars. **Nothing in CI checks these** — a
  deliberate choice on 2026-08-10, taken with the evidence that instruction alone has
  already failed twice. If a third regrowth happens anyway, the answer is not a fourth
  wording of this paragraph: it is `scripts/check-doc-budget.sh`, which was written, proven
  to fail correctly, and reverted in commit `cb70808`. Restore it from there.

Then tell the user plainly which documents you changed and which you deliberately
didn't, and why. "PRD untouched — nothing shipped a behaviour change" is a useful
sentence, not a missing step.
