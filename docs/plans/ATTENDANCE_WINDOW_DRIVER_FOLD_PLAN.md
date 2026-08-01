# Fold `verify-attendance-window.mjs` into `verify-attendance-guard.mjs`

_Written 2026-08-01. Planned with `/plan-with-confidence`, hardened with `/plan-review` —
the ⚠ blocks below are the review's output and are part of the steps, not commentary._

## Why

`verify-attendance-window.mjs` scores **3/5**. It is the older of two drivers over the
attendance window, so the directory implies that area is covered twice when it is covered
once, and a permanently-red driver trains everyone to ignore its output.

**Diagnosis (high confidence, still to be confirmed by Step 1).** Its fixture pins
"Newkid Win" into *Sunday Newbies* on a hardcoded **2026-07-16** and the scenario needs
*no Sunday to have fallen due since* — true for three days in July 2026. The two failing
checks are exactly the two Newkid checks; the three Ana/Saturday checks pass. All five
asserted strings still exist in `roster.tsx` / `attendance/index.tsx`, so this is **not**
stale copy — it is stale state.

**Decision (user, 2026-08-01):** fold the two unique checks into `verify-attendance-guard.mjs`
and delete this driver. If Step 2 shows a genuine product bug instead, **fix it this session**.

## What is unique to the old driver, and must survive

| # | Old check | Behaviour it guards |
|---|---|---|
| 3 | coach roster placeholder when nothing has fallen due | `roster.tsx` — "No lessons to mark yet" + "first lesson hasn't taken place yet" |
| 4 | parent: due-but-unmarked reads "No lessons marked yet" | `attendance/index.tsx` — the coach is behind |
| 5 | parent: just-joined reads "No lessons have taken place yet" | `attendance/index.tsx` — PRD §5.1, nothing has happened yet |

Checks 1 and 2 (button targets a past Saturday; the "how far back" note) are already
covered by `verify-attendance-guard.mjs`'s window assertions and are **not** carried over.

---

## Step 1 — Measure before touching anything

The backlog entry being acted on is itself a **corrected wrong diagnosis** (§7.62). Do not
repeat it: measure, do not deduce.

1. Stack up, load `fixtures-attendance-window.sql`, Expo web on :8081.
2. Run `verify-attendance-window.mjs`. Keep output + the four screenshots.
3. Run `verify-attendance-guard.mjs` **unchanged** and record its score.

> ### ⚠ RISK 4 MITIGATION — record the before-number, or you cannot attribute a regression
> **MEASURED 2026-08-01: `verify-attendance-guard.mjs` = 14/14. Target after the fold: 17/17.**
> **Assertion:** write `verify-attendance-guard.mjs` = `N/M` into this file before editing
> anything. Step 3 re-runs it and the number must be **identical**. Without a before-number,
> a red check after the fold is unattributable between fixture, driver and product.

**Gate:** the failures must be exactly checks 3 and 5. If anything else fails, or a
screenshot shows the *right* state under a failing assertion, **stop and re-diagnose** — that
is a product bug, not clock rot.

## Step 2 — Isolate the cause by moving only the clock

Change **one** thing: enrol Newkid relative to `now()` instead of `2026-07-16`. Re-run.

- **5/5 → clock rot confirmed.** Product is correct. Proceed.
- **Still 3/5 → genuine product bug.** Diagnose `roster.tsx` / `attendance/index.tsx` and fix
  it (user chose fix-now), then return here.

> ### ⚠ RISK 2 MITIGATION — a green here can be vacuous, and that would delete a real bug
> A parent-screen check can pass on text belonging to the **previous** child, because a prior
> screen stays mounted and overlays the current one (§7.10, §7.58) — and the old driver's own
> header warns of exactly this.
> **Step:** before asserting any empty state, assert the **selected child's name** is on
> screen, so a mis-tapped chip fails loudly instead of silently reading the wrong panel.
> **Assertion (structural, applies to every empty-state check from here on):** assert the
> expected string is present **AND its sibling string is absent** —
> `"No lessons have taken place yet"` present ⇒ `"No lessons marked yet"` absent, and vice
> versa. Mutual exclusion makes a vacuous pass impossible rather than merely unlikely.
> **Prohibition:** do NOT change more than the enrolment date in this step. A second edit
> destroys the isolation that makes the result mean anything.

## Step 3 — Grow `fixtures-attendance-guard.sql`, then re-run the UNCHANGED driver

It already has the anchor pattern, `parent-guard@swimsync.test`, and two children, so this is
additive:

1. Derive the new class's weekday from the anchor and insert the class (needs `category_id`,
   NOT NULL; `class_rates` is created by trigger — confirmed by the round-trip footprint).
2. Add a third child, **"New Joiner Guard"**, enrolled **today** into it, linked to the
   existing parent. Enrolled today + first lesson still ahead ⇒ nothing has fallen due.
3. Extend the closing `SELECT` with the new class id **and its weekday**.
4. Update `fixtures-attendance-guard-teardown.sql` for every new row.

> ### ⚠ RISK 3 MITIGATION — a naive `today + 1` reintroduces the exact bug being fixed
> If tomorrow is a **Saturday** the new class shares a weekday with `Saturday Beginners`: the
> coach gets two Saturday classes, "most recent expected lesson" gains a second candidate, and
> a Saturday may already have fallen due — the premise collapses. It would pass today
> (2026-08-01 is a Saturday, so tomorrow is Sunday) and break the following Friday. That is
> the same class of date rot this whole task exists to remove.
> **Step:** guard the derivation the way the fixture already guards `d_wrongday` / `d_extra`:
> `CASE WHEN EXTRACT(DOW FROM today + 1) = 6 THEN today + 2 ELSE today + 1 END`.
> **Assertion:** the fixture's closing `SELECT` prints the new weekday; the driver asserts it
> is **not** `saturday`. A collision fails the run instead of producing a confusing roster.

> ### ⚠ RISK 4 MITIGATION — split fixture-caused breakage from driver-caused breakage
> **Step:** after growing the fixture but **before editing the driver**, re-run
> `verify-attendance-guard.mjs` unchanged. Its score must equal Step 1's number exactly.
> A drop here is the fixture's fault and is diagnosable in isolation; discovering it after the
> driver edit means two suspects and no way to separate them.
> **Prohibition:** do NOT retitle `Saturday Beginners`, and give the new class a title that no
> existing `getByText(...)` in the driver matches loosely (e.g. **"Guard Newbies"**, never
> anything containing "Beginners").

## Step 4 — Fold the three checks into `verify-attendance-guard.mjs`

- Coach roster on the new class → `No lessons to mark yet` **and** `first lesson hasn't taken
  place yet`.
- A **parent browser context** (new — the driver is coach + admin today) → `Ana Guard` reads
  `No lessons marked yet`; `New Joiner Guard` reads `No lessons have taken place yet`.

All three carry Risk 2's mutual-exclusion form.

> ### ⚠ RISK 1 MITIGATION — prove each folded check fails without the fix, before deleting anything
> Deleting the old driver while the replacements are subtly weaker drops this coverage to zero
> while the file count still says "covered". The behaviour at stake is parent-facing: a family
> told *"No lessons marked yet"* when nothing has happened is being told their coach is behind
> when they are not (PRD §5.1).
> **Step (§7.25, non-negotiable):** flip the fixture state and observe each new check go RED —
> re-enrol "New Joiner Guard" a month ago and re-run: the placeholder check and the
> "taken place" check must both **fail**. Restore, re-run, both **pass**. A check never
> observed failing is not coverage.
> **Assertion:** `verify-attendance-guard.mjs` goes from Step 1's `N` checks to exactly
> `N + 3`. A different count means a check was lost or duplicated in the fold.
> **Prohibition:** do NOT delete `verify-attendance-window.mjs`, its fixture or its teardown
> until the RED-then-GREEN observation above is recorded in the commit message.

## Step 5 — Delete the old driver and verify the whole surface

1. Delete `verify-attendance-window.mjs`, `fixtures-attendance-window.sql`, its teardown.
2. `check-teardowns.sh` — pairing intact at 13 fixtures.
3. `check-fixture-roundtrip.sh` — must be green.
4. `supabase test db`, and the Deno suite **twice** (§7.15).

> ### ⚠ RISK 5 MITIGATION — already structural, keep it that way
> The grown fixture writes to shared tables, so residue would poison a sibling. This needs no
> vigilance: `check-fixture-roundtrip.sh` (shipped 2026-08-01) loads the fixture with
> `ON_ERROR_STOP=1`, asserts the teardown restores every row count, and compares its footprint
> stacked vs isolated — so an unscoped write or a missed teardown row **fails the build**.
> **Assertion:** it reports `all 13 fixtures load, own only their own rows, and tear down
> clean`. Do NOT hand-verify this instead; run it.

## Step 6 — Documents

- **`BACKLOG.md`** — delete `### verify-attendance-window.mjs guards half of what it claims`;
  it shipped.
- **`docs/TESTING.md` §5** — one driver over the window now, not two. State what folded in.
- **`docs/GOTCHAS.md`** — graduate anything durable. Current candidate: *an empty-state
  assertion must claim its sibling state is absent, because the previous screen stays mounted*
  — a §7.10/§7.58 corollary that this plan had to invent a mitigation for.
- `/commit-review`, then `/update-docs`.

---

## Pre-commit gate — ALL WALKED 2026-08-01

Every box is a blocker, not a caveat. Outcome recorded against each.

**Result: no product bug. Every failure was clock rot, the product rendered the correct
state in all three cases, and the driver had rotted further than recorded — 2/5, not 3/5.**

Two deviations from the plan as written, both upward:
- The guard driver went **15/15**, not 14/14, before the fold: fixing a `.first()` bug the
  new fixture exposed (§7.75) required an anti-vacuity assertion. No check was lost.
- The fold added **4** checks, not 3 — the extra is Risk 3's weekday-collision assertion.
  Final count **19/19**.

- [x] Step 1's before-score for `verify-attendance-guard.mjs` is written into this file
- [x] **Step 2 isolated the cause by changing ONE thing** — clock rot confirmed, or a product bug found and fixed
- [x] **Each of the 3 folded checks was observed RED, then GREEN** (§7.25)
- [x] Guard driver count is exactly before + 3
- [x] Every empty-state check asserts the sibling string is ABSENT
- [x] New class weekday asserted ≠ `saturday`
- [x] Fixture re-run gave the identical score BEFORE the driver was edited
- [x] `check-fixture-roundtrip.sh` green at 13 fixtures; `check-teardowns.sh` green
- [x] pgTAP green; Deno green **twice**

**The two that matter most:** *observed RED then GREEN* and *isolated by changing one thing*.
Without the first, the fold is a coverage deletion wearing a green tick. Without the second,
"it was the clock" is a guess that deleted a driver reporting a real bug.
