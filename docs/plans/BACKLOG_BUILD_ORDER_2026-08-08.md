# Replacement for `BACKLOG.md → ## Build order` — 2026-08-08

> **A HAND-OFF, not a second source of truth.** A worktree may not write `BACKLOG.md`
> (`CLAUDE.md`, `docs/WORKTREES.md`), so this block is staged here to be applied from the
> root checkout. **Delete this file once it is in `BACKLOG.md`** — the ranking lives only
> in `## Build order`, and two copies drift. Companion:
> `BACKLOG_NEW_ITEMS_2026-08-08.md`.

---

### The near-term plan — build roughly in this order

_(Re-ranked **2026-08-08** by rework cost rather than by value — method in
`.claude/skills/backlog-prioritisation/SKILL.md`. The previous ranking had been empty since
2026-07-19. Five shaping decisions were settled with the user the same day and are recorded
below, because an unrecorded decision is re-litigated. Items are ordered so that finishing
one never sends you back into an earlier one; where two have no edge between them they
share a wave and are picked by value.)_

#### The five decisions this ranking rests on (settled 2026-08-08)

| Decision | Answer | Consequence for the order |
|---|---|---|
| Split co-admin permissions? | **Yes eventually, not now** | *Split co-admin permissions* moves to Later. The first real need — an **owner-only accounting page** — needs no capability model, because `is_tenant_owner()` already exists |
| Coach per class or per lesson? | **Per lesson, on top of class assignment** | A permanent handover already works. A **temporary substitute** and **trainee/shadow coaches** are new lesson-level items; *Multiple coaches per class* is superseded |
| Trainee coach pay? | **Paid at their own rate** | A shadowed lesson produces two payout rows — the payroll half of the accounting page must come after it |
| Substitute pay? | **Whoever actually taught it** | The session override moves money, so it is a wages change, not just a roster label |
| Multiple classes per child? | **Yes, and soon** | Promoted to Wave 2. It drops `one_active_enrolment_per_student`, so every enrolment-shaped surface built after it inherits the new model — and everything built before it gets reworked |
| Native store builds ($99/yr)? | **Not yet — stay web-only** | *Push notifications* stays blocked. *Demote the static PayNow QR upload* must **hide** the upload, never delete it — the native fallback path stays alive |

#### Wave 1 — cheap, independent, and inherited by everything after (9 × **S**, ~2 weeks)

Nothing here is blocked by anything, and each one is paid for again by every screen shipped
before it lands. Two chains, run in either order.

**The PayNow / package chain — strict internal order, one screen:**

_(**Pay and claim from the parent's invoice LIST — SHIPPED 2026-08-08**, alongside the
Schedule tab. It headed this wave as "already half-built in the working tree"; it is now
built, with `verify-parent-pay-claim.mjs` covering it. Remove the item when applying this
block — and note its `BACKLOG.md` entry was **not** struck through by that session's
`/update-docs` pass, so the strike-through is part of applying this.)_

1. **Give package requests a reference number** — the stated blocker for #2.
2. **Demote the static PayNow QR upload** — needs #1. **Hide, do not delete**: the native
   fallback stays, per the decision above.
3. **The PayNow screen calls the business "Coach"** — copy-only, folds into #1 or #2.
4. **A link to the admin panel from coach Settings** — same `(coach)/settings` screen as
   #2; batch it.

**The foundations:**

6. **Direct writes to `students` are audited by nobody** — an `AFTER UPDATE` trigger is
   inherited free by every future writer. Every screen shipped first writes unaudited.
7. **An inactive CLASS is invisible to billing and to the block** — must precede any
   class-deactivation path, and *Disable a coach* forces class reassignment.
8. **Check column geometry on every admin table** — a UI redesign is planned; worth
   ~14 tables of protection during it and near zero after.
9. **`verify-levels.mjs` is not hermetic** — the nightly sweep is now the primary signal
   (§8.30, §8.33); one non-hermetic driver makes it lie.

#### Wave 2 — **Multiple classes per child** (M)

The single largest retrofit tax in the backlog, and the user's answer is *build it soon*.
It drops the `one_active_enrolment_per_student` constraint and reworks the enrolment UI,
`expectedStudentsOn()` and the attendance rosters. Billing needs less than expected —
the engine already sums per attendance record.

**It goes before Waves 3–5 because every one of them touches enrolment or the roster.**
*Convert a trial into an enrolled student* and *Book a make-up from the Attendance page*
both sit on this ground and are deliberately held until after it. Trials and make-ups
themselves are unaffected — a booking was never an enrolment.

#### Wave 3 — **The lesson-level coach roster** (M/L)

One schema change (`CLAUDE.md`: one in flight at a time), built once with a main/shadow
distinction rather than a substitute column later widened:

10. **A lesson can have a substitute coach, temporarily** — a per-session
    `taught_by_coach_id`; pay follows it. `session_pay_overrides` **cannot** express this.
11. **Trainee coaches shadow the main coach** — one main coach plus N trainees, each paid
    at their own rate, so a lesson produces more than one payout row.
12. Fold in **the attendance screen trusts a `sessionId` in the URL** (S) — same file, and
    its own note says "do it the next time that screen is opened".

⚠ **The blast radius is coach RLS, not the roster.** A coach reaches a class today via
`classes.coach_id`; a substitute or trainee must open a lesson of a class they do not own.
`current_coach_id()` feeds that policy set — pgTAP before any UI.

#### Wave 4 — **A lesson recorded into an already-BILLED month is reported, and settled**
(S/M)

Placed after Wave 2 because a **backdated enrolment** is its main trigger, and Wave 2
rewrites enrolment. Reuses the `unclaimed_billable` reporting shape and
`student_settlements`; adds no invoice concept and no override. Correct
`schedule_extra_lesson()`'s comment in the same pass — it claims the floor blocks this and
it does not.

#### Wave 5 — admin authority

13. **Owner transfer** (S/M) — a live gap: a lost owner freezes a business today and SQL is
    the only remedy.
14. **Disable a COACH account** (M) — needs Wave 1 #7 and the coach RLS model settled in
    Wave 3.

### Unordered — no dependencies, pick by value

Upcoming-lessons view for parents (S), Maps deep link (S), Moving a student between
businesses (S), The family-status search client-side scan (S), Better filtering/search (S),
Export to CSV (S), Tick off swimming skills per child (M), Email-confirmation
copy/templates (S).

**Three sit here but carry one edge each:**

- **Attendance edit history view** (S) — after Wave 1 #6. Build the audit *writers* before
  the audit *reader*.
- **Convert a trial into an enrolled student** (S) and **Book a make-up from the
  Attendance page** (S) — after Wave 2, which changes what an enrolment is.

**_A coach week view_ SHIPPED 2026-08-08 as the Schedule tab, ahead of this ranking, which
had placed it after Wave 3.** The reason it was placed there still applies and is now a
carry-forward rather than a sequencing note: a substitute or trainee teaches a lesson of a
class they do not own, so a Schedule tab that resolves "my lessons" from `classes.coach_id`
will show the wrong week.

> **ANSWERED 2026-08-08, so Wave 3 does not have to re-derive it — and the answer is
> narrower than this note assumed.** It is the **cheap** branch, but not because a helper
> already exists. The coupling is **two lines of one query** in `schedule/index.tsx`'s
> `loadData`: `from("coaches").select("id").eq("profile_id", session.id)` and then
> `.eq("coach_id", coach.id)` on `classes`. Nothing else in the screen asks who the coach
> is.
>
> **`lib/scheduleWeek.*` and `lib/scheduleBuckets.*` need NO change at all** — they are
> pure date and bucket maths and contain zero code references to a coach (every mention in
> both files is prose). So Wave 3 changes *which class ids the query selects*, and the
> sections, week arithmetic and marking-state logic are all inherited unchanged. Whatever
> replaces "classes I own" — a `class_coaches` join, a per-session override — only has to
> produce a list of class ids.

### The email / scheduler chain — strict internal order, start any time

**Track invoice-email delivery + retry** (S) establishes the `sent_at` + `IS NULL`
idempotency pattern in `email.ts` → **Credit-note email notifications** (M) inherits it
rather than inventing a second one → *then* the cron decision (HANDOVER §9) gates
**Parent-facing package notifications** (S) and **Automated reminder workflows** (M).

### Later — big features carrying their own dependencies

**An owner-only accounting page (M — _absorbs Revenue reporting_; decide accrual-vs-cash
first; not a priority per the user 2026-08-08)** — build after the trainee-coach item, or
its payroll half is written twice. Needs no capability model.
**Split co-admin permissions (M)** — *yes eventually*; the accounting page does not wait
on it. Parent self-enrolment (M — *needs class capacity, which does not exist*),
Coach-assisted assignment (M), Household split billing (M — *needs a credit-splitting
rule*), Auto PayNow detection (L — *the CSV-import M is the 10% worth doing first*),
In-app payment gateway (L), Native store builds (M — *deferred; not spending the $99 yet*)
→ Push notifications (M — *blocked by it*), Check the logo for brand collisions (S —
*before native builds, whenever those happen*), Bulk WhatsApp Cloud API (M — *only on a
real tenant's request*), Multi-language (M — **decide or refuse it; it is accruing
retrofit tax unranked**), Decide whether `service_role` deserves the whitelist treatment
(M — *a question until the usage audit exists*), More polished dashboards (S — *delete
unless a real question replaces it*).

**Two items are deliberately LAST, and get cheaper by waiting:**

- **Generate real Supabase `Database` types** (M) — a schema snapshot. Waves 2 and 3 are
  both migrations; every one landed first invalidates it.
- **Deeper component-render tests** (M) — they pin screens the planned redesign will
  rewrite.

**Shared `lessonDates.ts` package (M)** stays not-recommended and unranked — free only if
workspaces arrive for another reason.
