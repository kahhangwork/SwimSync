# Plan — Editing a student's PARENT contact details

**Branch:** `feat/parent-contact-details` · **Base:** `main` @ `48d9d49`
**Backlog item:** `BACKLOG.md` → *Coach workflow* → *Editing a student's PARENT contact
details* (**S**) · **Scoping doc:** `WORKTREE.md`

> Risk mitigations from `/plan-review` are inlined below as **⚠ RISK n MITIGATION**,
> attached to the step they govern. Do not move them into a trailing section.

---

## The shape

One per-row **Contact details** modal on the admin Students page, dual-mode:

| Child | Modal shows | Source |
|---|---|---|
| **Unclaimed** (`parent_id === null`) | Editable name / phone / email | `students.provisional_contact_*` |
| **Claimed** | Read-only name / email / phone + "the parent maintains this in their app" | `profiles` via `parent_students` |

**Settled with the user, 2026-07-26:**

- A claimed child shows **only** the live `profiles` contact. The provisional values are
  hidden entirely — they are a stale second copy of exactly the kind `students.age` and
  `classes.price_per_lesson` were removed for.
- The admin never edits a claimed parent's details. **The database already enforces
  this**: parents are global, so `profiles.tenant_id` is NULL (`20260718000700:47`), and
  `is_tenant_admin(NULL)` is hard-false (`20260718000900:61`). The parent edits their own
  details at `SwimSyncApp/app/(parent)/profile/contact.tsx`.
- `provisional_contact_name` is editable **here only**. It is *not* added to the two
  create forms: it is not a match signal, and `/accept-invite` requires the parent's real
  name and overwrites it (`accept-invite.tsx:71,106,156`). Its durable worth is
  operational — *who* the number belongs to.
- **It must never be rendered in the Students table's Parent column.** "Has this family
  onboarded?" stays sourced purely from `parent_students` (`isUnclaimed`, `page.tsx:40`).

**No migration.** `students_update` already grants `is_tenant_admin(tenant_id)`
(`20260718000900:299-305`), and `setLevel()` (`page.tsx:223`) is the precedent for a
direct `.from("students").update()` from this page.

---

## Step 1 — `SwimSyncAdmin/lib/sgPhone.ts` (new, pure, zero imports)

Singapore numbers are 8 digits: first digit **6** (PSTN), **8/9** (mobile), **3**
(VoIP), optionally `+65`-prefixed.

- `normalizeSgPhone(input)` — strip spaces/hyphens/parens/`+`; drop a leading `65` when
  8 digits remain.
- `checkSgPhone(input)` → `{ level: "ok" | "note" | "warn", message?: string }`
  - empty → `ok`, no message (clearing is a legitimate correction)
  - `^[89]\d{7}$` → `ok` (mobile)
  - `^[36]\d{7}$` → `note` — a landline/VoIP number; a mobile reaches a family better
  - fewer than 8 digits → `warn`, naming the consequence: **this can never match a
    parent's account** (this is the `964` already on production)
  - otherwise → `warn` — doesn't look like a Singapore number (8 digits starting 6, 8 or 9)
- `checkEmail(input)` — warn-only on an obviously malformed address.
- `blankToNull(input)` — `trim()`, then `"" → null`.

> **⚠ RISK 5 MITIGATION — named prohibition.** `checkSgPhone` and `checkEmail` are
> **advisory only and MUST NOT be able to block a save anywhere**. They return a
> message; no caller may branch to an early `return` on them. Do NOT wire either into
> an existing required-field guard.

> **⚠ RISK 5 MITIGATION — structural.** `blankToNull()` is the single conversion used
> for all three fields, so an empty input becomes `NULL` exactly as
> `add_unclaimed_student` does (`NULLIF(trim(...), '')`, `20260725000200:130-132`).
> Writing `''` instead of `NULL` diverges from every row the creation path made.

## Step 2 — `SwimSyncAdmin/lib/sgPhone.test.ts` (new, vitest)

Cases: `964` (the production value) · `+65 9123 4567` · `9123 4567` · `91234567` ·
`61234567` · `31234567` · `12345678` (8 digits, not an SG prefix) · `""` · `"   "`.

> **⚠ RISK 3 MITIGATION — assertion.** Record `npm test` count **before** touching
> anything (expected **122**, per HANDOVER §5 — the runner is the fact). After this step
> it must be `122 + <new cases>`. A total that did not grow by exactly the number added
> means a suite was lost.

## Step 3 — the modal on `SwimSyncAdmin/app/(admin)/students/page.tsx`

A per-row **Contact details** action opening a `Modal`, written inline alongside the
four already there (Add / Invite / Inactive / Merge) to match the surrounding code.

> **⚠ RISK 3 MITIGATION — structural, and this is the important one.** **Do NOT widen
> the Students `load()` select.** That one query feeds the entire 1075-line page; an RLS
> or join-shape mistake there returns `null` and renders the admin's primary screen
> **empty**, not merely missing a field. Instead the modal **fetches its own data when it
> opens**, keyed by student id. Blast radius drops from "whole page" to "one modal".
> This also gives Risk 7 its fix for free — see below.

On open, one query for the student's `provisional_contact_*` plus, when claimed, the
parent's `profiles(full_name, email, phone)`.

> **⚠ RISK 2 MITIGATION — step.** The claimed branch reads through
> `parent_students → parents → profiles`, which is `any`-typed: a wrong nesting level
> **typechecks and silently renders blank** (§7.28), and RLS read paths are where the
> last two sessions' invisible bugs lived (§7.48). Verified in advance that
> `tenant_serves_parent()` keys off `students.tenant_id`, **not** enrolment
> (`20260718000900:86-92`), so a claimed-but-unassigned child is readable — but this is
> confirmed in the real UI in Step 6, not trusted from the policy text.

> **⚠ RISK 7 MITIGATION — structural.** Mode (`editable` vs `read-only`) is derived from
> **that fresh on-open read**, never from the possibly-stale table row. A child claimed
> while the list was on screen therefore opens read-only, and the save path is not
> rendered at all.

## Step 4 — the pending-claim guard (highest risk in this plan)

**Before rendering an editable phone/email, the modal counts `student_claims` with
`status = 'pending'` for this student. If any exist, the fields render disabled with a
banner naming the count and linking to the Claims queue.**

> **⚠ RISK 1 MITIGATION — structural, not vigilance.** `student_claims.match_reason` is
> **snapshotted at claim time by design** (`20260726000100:53-56` — same rule as
> `invoice_items.student_name`). Editing the phone under a pending claim leaves the
> admin's queue asserting *"Their registered phone matches the contact number on this
> child"* (`claims/page.tsx:55-56`) when it no longer does — and the admin then approves
> a parent–child link on a justification that is silently false. Linking the wrong
> family to a child is the largest wrong outcome this feature can produce, and §7.47
> notes nothing else in the product can unlink them. Refusing the edit until the claim is
> resolved makes it **impossible** rather than discouraged.

> **⚠ RISK 1 MITIGATION — named prohibition.** Do **NOT** "fix" this by recomputing or
> rewriting `student_claims.match_reason` when contact details change. It is a record of
> why the candidate was offered, not a live lookup (§6). Do NOT add a bypass to the
> guard.

> **⚠ RISK 1 MITIGATION — assertion.** The driver seeds a child **with** a pending claim
> and asserts the Save control is absent and the banner names the queue.

## Step 5 — `handleSaveContact()` and the create-form warnings

Save: `.from("students").update({...}).eq("id", id)`.

> **⚠ RISK 5 MITIGATION — named prohibition.** The update payload is an **explicit
> three-key object literal** — `provisional_contact_name`, `provisional_contact_phone`,
> `provisional_contact_email` — each through `blankToNull()`. **Never spread a row object
> into `.update()`.** A stray `full_name` or `date_of_birth` silently rewrites a child's
> identity or trips `students_identity_uniq` with an error the admin cannot act on;
> `tenant_id` is caught by `pin_student_tenant()` but the others are not.

Then add the advisory warning under the phone field of **Students → Add a student**
(`page.tsx:770`) and **Trials → Book a trial** (`trials/page.tsx:512`).

> **⚠ RISK 4 MITIGATION — structural + named prohibition.** These are live paths that
> currently work. The warning is **render-only** and structurally separate from the
> existing required-phone guard (`trials/page.tsx:200`) — **do NOT modify that guard, and
> do NOT make the SG check a precondition of submit.** The phone stays required; its
> *shape* never is.

> **⚠ RETRACTED — I claimed the Students create form did not enforce the phone. It
> does.** `handleAddStudent` guards only `name` and `addClassId`, but the *Add student*
> button carries `disabled={... || !addPhone.trim()}` (`page.tsx:805-807`), 550 lines
> below the handler. Both create forms require a phone; they differ only in how they say
> so — Trials shows a sentence, Students silently disables the button. **No guard was
> added**, and nothing here needed fixing. Left in the plan rather than deleted so the
> next reader doesn't re-derive the same false alarm from the handler alone.

> **⚠ RISK 4 MITIGATION — assertion.** The driver books a trial with `964` and asserts
> the child **is created** with the warning visible. A creation that fails is a
> regression, not a success.

## Step 6 — `verify-contact-details.mjs` + `fixtures-contact-details.sql`

`.claude/skills/run-ui-playwright/drivers/`. Fixture seeds **four** children:
an unclaimed one; a claimed + assigned one; a **claimed but unassigned** one; and an
unclaimed one **with a pending claim**.

Checks:
1. Unclaimed → edit all three → save → reopen → values persisted.
2. A cleared field is `NULL` in the DB, **not** `''` (Risk 5).
3. `964` → warning renders **and the save still succeeds** (Risk 5's advisory rule).
4. Claimed → no inputs; the **exact seeded** name/email/phone strings are on screen.
5. Claimed **but unassigned** → same, non-blank (Risk 2's RLS case).
6. Pending claim → editable fields disabled, banner present, no Save (Risk 1).

> **⚠ RISK 2 MITIGATION — assertion.** Checks 4 and 5 assert the **seeded strings**, not
> that a modal opened. A blank field is a **fail**. This is the check that would have
> caught both of the last two sessions' invisible read-path bugs.

> **⚠ RISK 3 MITIGATION — step.** Run the existing `smoke-admin-screens.mjs` **before**
> starting and record the Students row count; run it again after Step 5. **The count must
> be identical.** A page that renders zero rows is the failure mode the lazy-fetch
> decision exists to prevent — this proves it.

---

## Known gap, accepted — no structural fix available here

**The edit writes no `audit_log` row.** `setLevel()` has the same gap, so this is
consistent rather than novel — but these fields decide *which parent can claim a child*,
which is a larger consequence than a level. Auditing needs a trigger or an RPC, i.e. a
**migration**, which `WORKTREE.md` forbids in this worktree (the
`../SwimSync-attendance-window` worktree owns `supabase/`).

**This is a vigilance-only gap and is stated as such.** Action: raise
*"audit contact-detail edits"* as a `BACKLOG.md` item at `/session-close`, which is when
that file is written from `main`.

**Also for `/session-close`:** Risk 1 is durable and belongs in `HANDOVER.md` §7 —
*editing a student's contact details under a pending claim strands the admin's queue on a
snapshotted `match_reason`*. Do not add it here; `WORKTREE.md` forbids touching
`HANDOVER.md` from this worktree.

---

## Pre-commit gate — walked 2026-07-26, all green

**The three that matter most:**

- [x] **Risk 1** — a child with a pending claim offers **no Save**, and the banner links
      to the Claims queue. `match_reason` is untouched anywhere in the diff.
      *(driver checks 13–16)*
- [x] **Risk 3** — `load()` proved **byte-identical to HEAD** by extracting the function
      from `git show HEAD:` and diffing (a grep was too coarse — it matched
      `openContact()`'s own query). The driver asserts the table lists every active child
      (10 rows vs 10 in the DB) rather than a hard-coded number.
- [x] **Risk 2** — exact seeded strings asserted for both the claimed child and the
      claimed-but-**unassigned** child, whose parent has no other children so nothing
      else could make them readable. *(checks 9, 12)*

**The rest:**

- [x] **Risk 4** — both create-form guards byte-unchanged in the diff; `964` warns, the
      button stays enabled, and the child **is created**. *(checks 17–19)*
- [x] **Risk 5** — payload is a three-key literal; a cleared field is `NULL` in the DB
      (`IS NULL` → `t`); `checkSgPhone`/`checkEmail` appear only as `<ContactHint check=>`
      props — no caller branches on them.
- [x] **Risk 7** — mode comes from `openContact()`'s fresh read, not the table row.
- [x] `npm test` **122 → 134** (+12, exactly the cases added; 8 → 9 files) ·
      `npm run typecheck` clean.
- [x] `provisional_contact_name` appears nowhere in the Students table's Parent column.
- [x] No file under `supabase/` modified (`git status` → 0).
- [x] `verify-contact-details.mjs` — **21/21**, and passing **twice in a row**: the driver
      resets the fields it edits, so a second run cannot fail in a way that looks like a
      regression.

## What the pre-commit review changed

Seven findings, all fixed. The three that mattered:

- **The pending-claim guard failed OPEN.** `const { count } = …` discarded the error, so
  any failure of that query read as "no claims" and **unlocked** the fields — the exact
  situation the lock exists for. Now fails closed: no count, no editing.
- **A failed load rendered a blank editable form.** State is cleared before the fetch, so
  an error left three empty inputs and a live Save button; one click would have **erased**
  a child's real contact details. A `contactLoadFailed` state now renders the error and
  nothing else.
- **Only the first linked parent was shown.** `parent_students` is many-to-many because a
  child has two parents — and *"show the mother's number rather than the father's"* is
  the motivating case for this whole screen. All parents now render, pinned by a driver
  check on a two-parent fixture.

Also: a stale-response guard (open A, close, open B — A's response could land last under
B's name), `contactClaimed` reset on open, `next/link` instead of a plain anchor (the
admin app had zero plain internal anchors before this), and a comment explaining why
`handleSaveContact` deliberately does **not** call `load()`.

**Shipped slightly differently from the plan:** `ContactHint` lives in
`components/ContactHint.tsx` rather than inline, because the Trials page needs it too and
there is no cross-project boundary here to justify duplicating it.
