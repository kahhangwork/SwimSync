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

## Rules

- **Explicit invocation only.** Run this workflow only when the user typed
  `/plan-review`. Do not apply it to other requests.
- **Product risk, not code style.** The lens is impact on users and the
  product, not tidiness. Rank by blast radius.
- **Mutate the plan.** The deliverable is an updated plan with mitigations
  baked in — not a standalone risk memo.
- Project-scoped (SwimSync). To use it in every repo, move this directory to
  `~/.claude/skills/plan-review/`.
