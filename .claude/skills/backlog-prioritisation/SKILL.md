---
name: backlog-prioritisation
description: Re-sequence BACKLOG.md's Build order to minimise REWORK — put each item where finishing it never sends you back into something already built. Ranks by blast radius (how many other items a decision changes), not by value or size. Use when the user asks to prioritise the backlog, re-order the build order, work out what to build first, or says the queue has drifted.
---

# Ordering a backlog so you never build the same thing twice

**The question this answers is not "what is most valuable?" — it is "what, if built
later, would force me to reopen what I already built?"** Those give different orders, and
the second one is the one that decides how much work the queue actually costs.

Value-ranking (WSJF, RICE, MoSCoW) sorts by payoff and assumes the items are independent.
They are not. On a real codebase, item B built after item A routinely means editing A
again — a schema that has to change, a policy gate that has to be threaded through every
screen, a snapshot that has stopped matching. That second edit is invisible to every
value-ranking method, because it isn't attached to either item; it is attached to the
**order**.

## What this technique is called

There is no single tidy name, and you'll meet it under several:

| Name | Where it comes from | What it says |
|---|---|---|
| **Topological sort** | Graph theory | If A must precede B, A comes first. The exact algorithm — but only defined when the graph has no cycles. |
| **Design Structure Matrix (DSM) sequencing / partitioning** | Engineering management | The formal, general version. Build a matrix of "task X needs a decision from task Y", then re-order to push feedback loops below the diagonal. **Feedback marks are literally rework.** This is the closest real name for the question as usually asked. |
| **Dependency-first / foundation-first ordering** | Everyday engineering | The informal name most teams use. |
| **Enablers before features** | SAFe | Same instinct, product framing. |

The one-line version worth keeping: **it is a topological sort, tie-broken by blast
radius.** Two items with no dependency between them are ordered by how many *other* items
each one would change.

**Do not confuse it with these**, which answer different questions:
WSJF / Cost of Delay (economic value), RICE (value ÷ effort), MoSCoW (importance),
Critical Path Method (schedule duration — CPM finds the *longest* chain, this finds the
*cheapest* order). Last Responsible Moment is the direct opposite and is still sometimes
right; see *When to override* below.

## The method

### 1. Read the item bodies, never the titles

Dependencies almost never appear in a heading. In `BACKLOG.md` they live in **Notes** —
"do this one first", "decide X before any code", "blocked on", "depends on", "the future
deactivation path must count BOTH tables". Grep for the phrasing, then read the item:

```bash
grep -n -i "before any code\|do this .* first\|blocks \|blocked on\|depends on\|decide .* first\|prerequisite\|supersedes\|must .* first" BACKLOG.md
```

Read `Deliberately not doing` too. A rejected idea is often a *decision* another item
silently assumes — and a decision that gets reversed is the most expensive rework there is.

### 2. Separate the four kinds of edge

Not every "these are related" is a sequencing constraint. Only two of these are:

- **Hard prerequisite** — B cannot be built until A exists. *(A real edge. Absolute.)*
- **Rework edge** — B can be built first, but then A forces you to reopen it. *(A real
  edge. This is the one the whole method exists for, and it is the one people miss.)*
- **Shared surface** — A and B edit the same file or screen. *(Not an edge. A batching
  hint — ship them in one pass, in either order.)*
- **Thematic** — both are "billing". *(Not an edge at all. Ignore it.)*

### 3. Pull the decisions out as their own nodes

The highest-leverage items are usually **not code**. A question like "is revenue accrual
or cash?", "will admin permissions be split?", "is a coach assigned per class or per
lesson?" costs an hour to answer and changes the shape of five items. Answered late, every
one of those five gets reopened.

Give each such decision its own line at the top of the order. Costing them at zero is
what makes the sequence honest.

### 4. Rank by blast radius, not by size

Count, for each item, **how many other backlog items its outcome changes**. Order
descending. An **S** with four dependents outranks an **M** with none — and this is the
part that feels wrong and is right, because the S is the one whose lateness is paid for
four times.

### 5. Identify the retrofit-tax items explicitly

Some items get monotonically more expensive with every screen shipped in between:
internationalisation, an audit trigger, an authorisation model, a capability gate,
generated types, a test harness that protects a surface being redesigned.

For each: either **schedule it now** or **write down that you are choosing never** —
in `Deliberately not doing`, with the reasoning. The failure mode is neither of those:
leaving it in the queue, unranked, accruing tax silently.

Their mirror images are the items that get **cheaper** by waiting, and those go last on
purpose — anything that snapshots a schema (generated types), or that pins a surface
scheduled for redesign (component-render tests).

### 6. Write it as waves, not a numbered list of 50

Items with no edge between them do not need an order, and inventing one is false
precision that goes stale within a week. Group into waves; inside a wave say
"pick by value". State the *reason* each wave precedes the next — the reason is what
survives when an item is added or drops out.

### 7. Sanity-check the order backwards

Walk the sequence in reverse and ask of each item: *"if I had built this last instead,
what would I have had to reopen?"* Anything with an answer is in the wrong place. This
catches the edges step 2 missed, and it is quick.

## Writing it back

The order lives in **`BACKLOG.md` → `## Build order`, and only there** — that section is
the single source of truth by design. Do not put a rank number on each item heading; two
copies of an ordering always drift, and the headings are the copy nobody updates.

Keep the existing wave shape (`The near-term plan` / `Later — clusters with a fixed
internal order` / `Unordered — no dependencies, pick by value` / `Later — big features`)
if it still fits, and note the date the ranking was set plus what forced the re-rank.
Shipped items are **removed** from the ranking, not struck through — the item body carries
the history.

Sizes are `S` = an afternoon, `M` = a few days, `L` = a genuine project.

**A worktree must not write `BACKLOG.md`** (`CLAUDE.md`, `docs/WORKTREES.md`). If this
skill runs in one, produce the ranking and hand back the replacement block — the write
happens from the root checkout.

## When to override the order

Dependency order is not the only input, and three things legitimately beat it:

1. **An operational risk that is live right now.** A recovery path that does not exist
   (an owner account lost, a business frozen) outranks a tidy sequence.
2. **Something already half-built in the working tree.** Finishing it is cheaper than the
   context it costs to abandon — check `git status` before ranking anything.
3. **The user's own call.** They know which customer is asking. Record a deprioritisation
   in the item body with the date and the reason, the way *Revenue reporting* records
   2026-08-08 — otherwise it gets re-raised every session.

And note the honest limit of this method: it minimises **rework**, which is only one cost.
An item with a huge blast radius that nobody will ever want is not worth building first —
it is worth **refusing** first, which moves it to `Deliberately not doing` and removes the
edge entirely. Deciding *not* to do something is a valid output of this skill, and often
the highest-value one.

## Output

Give the user, in this order:

1. The **decisions to settle before any code** — each with the items it unblocks.
2. The **waves**, with one line on why each precedes the next.
3. The **retrofit-tax list** — items that get more expensive the longer they wait, with a
   now-or-never call on each.
4. Anything you found that should move to **`Deliberately not doing`** instead of being
   ranked.

Then offer to write it into `BACKLOG.md → ## Build order`. Do not write it unasked — a
re-ranked backlog the user hasn't agreed with is worse than a stale one, because it reads
as settled.
