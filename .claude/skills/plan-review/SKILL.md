---
name: plan-review
description: Manually-invoked only. Review the CURRENT plan for product risk — list the riskiest areas most-to-least risky, then add risk-reduction steps to the plan for each. Trigger ONLY when the user explicitly types "/plan-review" — never auto-load this for ordinary planning or plan-mode requests.
---

# plan-review

When invoked, review the plan you (or the user) currently have and harden it
against risk. Do this verbatim to intent:

> Review your plan and identify the areas that introduce the most amount of
> product risk. List them from **most to least risky**. Then add to your plan
> steps to reduce the implementation risk for each item.

## How to run it

1. **Locate the plan.** Use the plan currently in play — the plan file, the
   plan you just proposed, or the approach under discussion. If there is no
   plan yet, say so and stop (nothing to review).
2. **Identify product risk.** Go through the plan and find the areas that carry
   the most **product risk** — the parts most likely to break behavior users
   depend on, cause data loss, regress a flow, hit RLS/permission gaps, or
   otherwise deliver the wrong outcome. Think about blast radius, not just
   difficulty.
3. **Rank most → least risky.** Output a numbered list, riskiest first. Each
   item: the risky area + one line on *why* it's risky (what could go wrong and
   who it affects).
4. **Add risk-reduction steps.** For **each** ranked item, add concrete steps
   to the plan that lower implementation risk — e.g. narrower scope, a
   feature flag, a migration dry-run, extra verification, a rollback path,
   staging behind a check. Fold these into the plan, don't just list them
   separately.

---

## How to fold them in — this is the part that decides whether any of it survives

Findings from this review are **routinely ignored during implementation**. Not
through carelessness — through structure. Three causes, each with a fix that is
mandatory, not advisory:

**(a) They end up in the wrong artifact.** The review lives in the conversation;
the *plan file* is what gets re-read while implementing. When context compacts,
review prose is the first thing dropped, because it isn't the deliverable.
→ **Write mitigations INTO the plan file, next to the step they govern.**

**(b) A trailing "Risks" section is where findings go to die.** It is read once,
at planning time, and never again — while the risk is needed forty tool calls
later.
→ **Never append a Risks section. Inline each mitigation under the step it
applies to**, marked so it is impossible to skim past (e.g. `⚠ RISK n
MITIGATION`). The ranked list in your *response* is fine; the plan file gets
them distributed.

**(c) Warnings are not executable.** "Watch out for X" is a fact. Facts get
skimmed; steps get executed.
→ **Convert every finding into exactly one of three forms:**

| Form | Looks like |
|---|---|
| **A step** | "Run the driver against current code first and record the numbers" |
| **An assertion with a pass/fail value** | "41 tests before, 41 after — a changed count means a test was lost" |
| **A named prohibition, attached to its step** | "Do NOT add a `force` bypass here" |

### Prefer structural mitigations over vigilance ones

**A mitigation that depends on someone remembering is not a mitigation.** Where
you can, make the failure *impossible* rather than *discouraged* — the test
helper throws on a vacuous fixture instead of a note saying "check for vacuity";
the fallback branch fails safe so every future case inherits it. Reach for
vigilance only when nothing structural is available, and say so when you do.

### Close with a gate

End the plan with a short **pre-commit gate**: the mitigation checkboxes to walk
before committing, with the highest-value few called out separately. A box that
cannot be ticked is a blocker, not a caveat.

### Let the durable ones graduate

A mitigation that outlives this task belongs in `HANDOVER.md` §7 (*Gotchas
already hit*), not only in a plan file that is discarded when the work lands.
§7 governs precisely because `/session-start` mandates reading it every session.

## Rules

- **Explicit invocation only.** Run this workflow only when the user typed
  `/plan-review`. Do not apply it to other requests.
- **Product risk, not code style.** The lens is impact on users and the
  product, not tidiness. Rank by blast radius.
- **Mutate the plan.** The deliverable is an updated plan with mitigations
  baked in — not a standalone risk memo. If the plan file is unchanged when you
  finish, the review did not happen.
- Project-scoped (SwimSync). To use it in every repo, move this directory to
  `~/.claude/skills/plan-review/`.
