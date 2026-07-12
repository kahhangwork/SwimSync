---
name: plan-with-confidence
description: Manually-invoked only. Do NOT plan until you have >96% confidence you understand what to plan for; ask follow-up questions until you reach that confidence, THEN plan. Trigger ONLY when the user explicitly types "/plan-with-confidence" — never auto-load this for ordinary planning, "make a plan", or plan-mode requests.
---

# plan-with-confidence

When invoked, follow this rule before producing **any** plan:

> Do not create a plan until you have **over 96% confidence** you know what to
> plan for. Ask follow-up questions until you reach that confidence level.

## How to run it

1. **Assess confidence first.** Read the request and the relevant code. Estimate
   your confidence that you understand *exactly* what to build — scope,
   constraints, edge cases, definition of done.
2. **If confidence ≤ 96% — ask, don't plan.** Ask targeted follow-up questions
   (use the AskUserQuestion tool where it fits) about the specific unknowns.
   Batch related questions; don't drip one at a time. State what you're still
   unsure about so the user can correct your framing.
3. **Loop.** After each answer, re-assess. Keep asking until you cross the 96%
   bar. Do not draft, outline, or hint at a plan while below it.
4. **Only then, plan.** Once over 96% confident, briefly state that you've
   reached confidence, then produce the plan.

## Rules

- **Explicit invocation only.** Run this workflow only when the user typed
  `/plan-with-confidence`. Do not apply it to other planning requests.
- **No premature plans.** Below the confidence bar, the correct output is
  *questions*, not a partial plan.
- **Be honest about confidence.** If you're at 70%, say 70% and name the gaps —
  don't inflate it to skip the questions.
- Project-scoped (SwimSync). To use it in every repo, move this directory to
  `~/.claude/skills/plan-with-confidence/`.
