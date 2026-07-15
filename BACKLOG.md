# SwimSync — Backlog

_Last updated: 2026-07-16_

Things SwimSync **could** become. Nothing here is built or committed to — if it were
built, it would be in [PRD.md](PRD.md) instead. See [README.md](README.md) for why the
documents are split this way.

**What's actually being worked on right now lives in [HANDOVER.md](HANDOVER.md) §9**,
not here. This document is the queue; the handover is the current shift.

### How to use this

Every item carries a **Why**. That's the rule that keeps this from becoming a wishlist:
if you can't say who it helps and what breaks without it, it isn't ready to be an item
yet. Where a decision has already been made about *how* a thing should work if it's ever
built, it's recorded under **Notes** — those are hard-won and worth more than the item
itself.

Items are grouped by theme, not by priority. Rough sizes: **S** = an afternoon,
**M** = a few days, **L** = a genuine project.

**Provenance tags** point back to where an idea came from, so the original reasoning
stays reachable:

- `[MVP-excluded]` — one of the 14 items PRD §3.2 deliberately ruled out of the MVP.
  §3.2 stays in the PRD as the historical record of that scope decision; the items are
  mirrored here now that SwimSync is past pure MVP-building and they're live options
  rather than a boundary.
- `[Phase 2]` / `[Phase 3]` — from the PRD §15 release plan.
- `[handover]` — carried over from HANDOVER §9, which was doing the backlog's job before
  this document existed.

---

## Coach workflow

### Bulk "set all to…" on the attendance screen — **S** `[handover]`
One control at the top of the attendance screen that sets every student to the same
status at once, then lets the coach adjust individuals.

**Why:** cancelling a rained-out class is currently 17 students × 2 taps, one at a time.
That's exactly where a coach abandons the task — and an abandoned cancellation is
**indistinguishable from a forgotten lesson**, which is the failure mode that silently
costs money (see the unmarked-lessons work, PRD §7.5). This is the highest-value small
follow-up on the list: it's purely client-side, it protects the billing loop, and it
takes an afternoon.

**Notes:** no schema change — populate the existing attendance state map before save.
HANDOVER §8 flagged it as deliberately deferred so it could ship on its own.

### Makeup lessons — **L** `[MVP-excluded]` `[Phase 3]`
A student misses a lesson and attends a different session to make it up, without being
billed twice.

**Why:** this is the most-requested thing in every real coaching business, and the
current model has no answer at all — a missed lesson is simply non-billable and gone.
As soon as parents are paying real money, "I paid for a lesson we couldn't attend" is
the conversation the coach will have to keep having by hand.

**Notes:** genuinely hard, and the reason it's L rather than M. It breaks two invariants
at once: one active class enrolment per student (§5.3) and billing straight from
attendance (§5.5). A makeup means a student appears on a class they aren't enrolled in,
and a lesson gets paid for on a date other than the one it happened. Worth designing on
paper before touching code — probably a "makeup credit" concept distinct from the
existing money-credit-note, so the two ledgers don't get confused with each other.

### Coach-defined swimming levels — **M** `[handover]`
Let coaches define their own level labels and set a level per student.

**Why:** the class name currently carries the level ("SwimSafer Level 5"), which works
for one coach with four classes and stops working the moment a coach wants to track a
student's progress *within* a class, or a second coach uses different level names.

**Notes:** `students.swimming_ability` (nullable enum) was **deliberately kept** in the
schema for this and is always NULL today — nothing writes it, nothing displays it. When
this returns it should be **coach-defined**, not the current fixed
beginner/intermediate/advanced enum, and probably free text or a new table. **Do not
re-add a parent-facing level picker** — parents self-reporting ability was removed on
purpose (PRD §5.1, HANDOVER §6).

### Coach-created student profiles — **M** `[MVP-excluded]`
Let a coach create a student directly, instead of only parents creating them.

**Why:** students are parent-created only, so a coach who signs up a family poolside
can't enter them — the parent must go home, self-register, and add the child before the
coach can mark a single lesson. That's the friction being felt right now during the
first real onboarding push. It also blocks the trial-lesson case: a walk-in trial can't
be marked at all until the parent has an account.

**Notes:** needs care with the parent-link model (`parent_students`) and RLS — a
coach-created student has no parent account to link to yet, so it needs either a
placeholder parent or a claim flow where a parent later takes ownership. The claim flow
is the better shape but the bigger build.

### Attendance edit history view — **S** `[Phase 2]`
Surface the existing audit trail in the UI.

**Why:** every attendance edit is already logged to `audit_log`, but nobody can see it
without SQL. When a parent disputes a charge, the answer exists and is unreachable.

**Notes:** the data is already there — this is a read-only view, not a new capability.
Admin panel first; the coach probably doesn't need it.

---

## Billing and payments

### Automatic PayNow payment detection — **L** `[MVP-excluded]` `[Phase 3]`
Reconcile incoming PayNow transfers against outstanding invoices automatically.

**Why:** marking invoices paid by hand is the coach's most repetitive monthly chore, and
the one most likely to be done wrong or late — every "have you paid?" message to a
parent who already paid comes from this gap.

**Notes:** the hard part isn't SwimSync, it's the bank. Singapore retail bank feeds
aren't openly available to a part-timer; realistically this needs either a payments
provider or manual bank-statement import. **A CSV/statement import that suggests matches
is the 10% of this that delivers 80% of the value** and is an M, not an L — worth
considering first.

### In-app payment gateway — **L** `[MVP-excluded]` `[Phase 3]`
Take card/PayNow payment inside the app rather than sending parents to a QR code.

**Why:** removes the "did they actually pay?" gap entirely, and gets rid of manual
verification with it.

**Notes:** in tension with the product's whole economic premise. PayNow QR is **free**;
a gateway takes a cut of a part-time coach's margin, and the current stack is
deliberately $0. Probably only makes sense if SwimSync ever serves coaches other than
its owner. Related: automatic PayNow detection above gets much of the benefit without
the fee.

### Package / subscription pricing — **L** `[MVP-excluded]` `[Phase 3]`
Sell a block of lessons (or a monthly subscription) up front instead of billing per
attended lesson.

**Why:** it's how a lot of swim schools actually price, it smooths the coach's cash
flow, and it makes revenue predictable. Pay-per-attendance means a rainy month is a pay
cut.

**Notes:** this is not a pricing tweak, it's a **second billing model** living beside
the first, and it inverts the core rule that billing derives from attendance (§5.5).
Packages need a balance to draw down, an expiry policy, and a completely different
answer to "what happens when a lesson is cancelled." Expect it to touch the invoice
engine, the credit ledger, and every billing screen. Don't start this without deciding
whether it *replaces* per-lesson billing or coexists with it.

### Household-level split billing — **M** `[MVP-excluded]`
Let two parents (e.g. separated households) each receive a share of the invoice.

**Why:** requested often enough in family-facing products to be worth recording. Today
one invoice goes to one parent account, and any splitting happens between the parents
off-platform.

**Notes:** the data model is closer to ready than it looks — `parent_students` is
already **many-to-many**, so a student can have two parents. What's missing is a split
rule and a decision about which parent's credit balance a correction lands in. Credit is
pooled **per parent** (HANDOVER §6), so splitting invoices without splitting credit
would produce a ledger nobody can explain.

### Fix the UTC-derived default billing month — **S** `[handover]`
The invoice engine's default billing month is derived in UTC.

**Why:** it's a live latent bug. It's harmless today only because invoices are generated
manually with the month picked explicitly, and cron isn't wired on the free tier. **The
day anyone switches cron on, it bills the wrong month** — the same class of UTC-vs-SGT
error that already shipped a real double-billing bug (HANDOVER §7.7).

**Notes:** fix with `todayInSg()` from `lib/lessonDates.ts`, the same helper that pinned
the earlier bug. Currently documented as a warning in `INVOICE_RUNBOOK.md`, which is not
the same as fixed. **Do this before enabling cron, not after.**

---

## Parent experience

### Upcoming lessons view for parents — **S** `[PRD §7.5]`
Show parents the lessons that are scheduled next, not just the history of marked ones.

**Why:** parents currently see only what already happened. "When is my next lesson?" is
probably the single most common question the app *can't* answer, and it's the kind of
gap that makes an app feel like a billing tool rather than something you'd open weekly.

**Notes:** explicitly called out as **not provided** in PRD §7.5. The building block
already exists — expected lesson dates are derived at read time from
`classes.day_of_week` via `lib/lessonDates.ts`, which is exactly what the coach's
unmarked-lessons backlog uses. Point it at the future instead of the past. **This does
not require pre-generating sessions** — resist that; see HANDOVER §6.

### Parent self-enrolment into classes — **M** `[MVP-excluded]`
Let parents pick and join a class themselves rather than waiting for the superadmin.

**Why:** assignment is a manual superadmin step today, so every new family stalls until
someone gets to it. That's the bottleneck in the onboarding push happening right now.

**Notes:** needs class capacity — which doesn't exist yet — or parents will overfill a
lane. A lighter middle ground: let the parent express a *preference* at signup that the
superadmin approves, which removes the back-and-forth without giving up control.
Related: coach-assisted assignment below.

### Multiple classes per child — **M** `[MVP-excluded]` `[Phase 3]`
Let one student attend more than one class a week.

**Why:** a keen swimmer taking two sessions a week is an ordinary case that SwimSync
simply can't represent — the parent needs a second child profile as a workaround.

**Notes:** MVP enforces one active enrolment per student with a DB constraint (§5.3,
§7.4) that's covered by a pgTAP test. Billing already sums per attendance record, so the
invoice engine may need less work than expected — the constraint, the enrolment UI, and
the attendance screens are where the work is. Often wanted together with makeup lessons;
they share the "a student can appear in more than one place" problem.

### Maps integration — **S** `[MVP-excluded]`
Tap a class location to open it in Maps.

**Why:** small, cheap, and genuinely useful the first time a parent drives to a new
pool. `classes.location_address` is already captured and currently just renders as text.

**Notes:** deep link to the platform maps app; no new data needed.

---

## Notifications and reminders

### Email invoice and credit-note notifications — **S** `[Phase 2]`
Email the parent when an invoice is generated or a credit note is issued.

**Why:** today an invoice appears silently and the parent only finds out by opening the
app — so the coach chases payment manually for a bill the parent never knew existed.
This is the cheapest possible improvement to getting paid on time.

**Notes:** the infrastructure is **already live and paid for** — Resend on
`noreply@swimsync.sg`, with a branded template pattern established at
`supabase/templates/recovery.html` (HANDOVER §11). This is likely the best
effort-to-value item in the whole document.

### WhatsApp payment reminders — **M** `[Phase 2]`
Nudge parents about outstanding invoices over WhatsApp.

**Why:** in Singapore, WhatsApp is where this conversation actually happens — the coach
is already sending these messages by hand. Email is politer; WhatsApp gets read.

**Notes:** a named secondary goal since the original PRD (§2.2). Needs the WhatsApp
Business API (approval + per-message cost) or an unofficial bridge, which is
against-terms and fragile. **Sequence this after email**, which is free and already
wired. Consider a middle option first: a "copy reminder message" button the coach pastes
into WhatsApp — no API, most of the value.

### Push notifications — **M** `[MVP-excluded]`
Native push to parents and coaches.

**Why:** the natural home for the reminders above, and for "attendance marked" /
"invoice ready."

**Notes:** **blocked on native store builds** — push doesn't work on the static web app
that's currently deployed, so this can't precede the platform item below. Note that
Notification Preferences buttons were **removed** from coach Settings and parent Profile
as dead stubs; HANDOVER §12 has the restore notes. Don't re-add the button until there's
a real feature behind it.

### Automated reminder workflows — **M** `[MVP-excluded]` `[Phase 3]`
Scheduled, rules-driven nudges (e.g. "invoice unpaid after 7 days") rather than one-off
sends.

**Why:** turns chasing payment from a thing the coach remembers to do into a thing that
just happens.

**Notes:** needs a delivery channel first (email above), **and a scheduler** — there's
no cron on the free tier, which is the same constraint that makes invoicing manual. That
constraint is the real gate here, not the feature.

---

## Admin and operations

### Delete-coach action in the admin UI — **S** `[handover]`
A real delete/deactivate control for coaches.

**Why:** removing a coach currently means running SQL in the Supabase dashboard. That's
fine for the owner and impossible for anyone else — and dashboard SQL against production
is exactly where a bad afternoon comes from.

**Notes:** `classes.coach_id → coaches(id)` has **no cascade** (RESTRICT), so a coach
can't be deleted while any class references them. The UI needs to say that plainly
rather than surfacing a raw FK error. **Deactivate is probably the right verb** — real
deletion destroys billing history. HANDOVER §9 lists this as "if asked."

### Export to Excel / CSV — **S** `[MVP-excluded]` `[Phase 3]`
Export attendance, invoices, and credit notes from the admin panel.

**Why:** it's how the data gets to an accountant at tax time, and it's the escape hatch
that makes the whole system less scary to commit to — if you can always get your data
out, you're not trapped.

**Notes:** admin tables already query exactly this data; the work is serialisation and a
download. Start with invoices, which is the one with an actual deadline behind it.

### Coach-assisted assignment workflow — **M** `[Phase 3]`
Let a coach assign students to their own classes, not just the superadmin.

**Why:** the superadmin is a bottleneck for a step the coach is better placed to do —
they're the one who knows which lane a child belongs in. It's only invisible today
because the coach and the superadmin are the same person.

**Notes:** this is the assumption that breaks first if SwimSync ever serves a second
coach. RLS already has `coach_serves_parent()`-style helpers to build on. Related to
parent self-enrolment — both attack the same bottleneck from different ends.

### Better filtering and search — **S** `[Phase 2]`
Filters and search across the admin tables.

**Why:** fine at 17 students, painful at 100. Filing this as a scale problem, not a
today problem.

### More polished dashboards — **S** `[Phase 2]`
Richer metrics on the admin dashboard.

**Why:** the vaguest item here, and honestly the weakest — it has no specific pain
behind it. Kept only because the PRD names it. **Delete this item if a real question
ever replaces it** ("how much am I owed?" would be a better item than "polish the
dashboard").

---

## Platform and reach

### Native store builds (iOS / Android) — **M** `[handover]`
EAS builds → Android APK / iOS TestFlight → the stores.

**Why:** the app is currently a static web app used in Safari, which works but can't do
push, can't be installed from a store, and feels like a website. This is the difference
between "a link the coach sends parents" and "an app."

**Notes:** deliberately deferred until the app "sticks" — iOS is **$99/yr** and the
whole stack is $0 today. **Blocks push notifications.** Decision point is willingness to
spend, not engineering.

### Multiple coaches per class — **S** `[MVP-excluded]`
Allow more than one coach on a single class.

**Why:** covers a co-taught lane or a substitute coach. Low urgency at one coach.

**Notes:** `classes.coach_id` is a single FK — this becomes a join table. Worth checking
against the substitute case first: if the real need is "someone else covers this week,"
that's a *session*-level concern, not a class-level one, and the cheaper fix is
different from what this item describes. **Confirm the need before building the join
table.**

### Multi-language support — **M** `[MVP-excluded]`
Beyond English.

**Why:** recorded for completeness. English-only was an explicit MVP decision (§8.1) and
is a reasonable long-term answer for Singapore.

**Notes:** the honest reason to do this would be Mandarin for grandparents doing pickup
— which would be a real reason, but nobody has asked.

---

## Foundations and engineering debt

These aren't features; they're the things that will make future features cost more, or
that are quietly waiting to break something.

### Extract the completeness rule into a shared helper — **S** `[handover]`
"A lesson is marked only when every actively-enrolled student has an attendance row on
it" is **hand-written in four places**: `core.ts:141-152` (engine gate),
`SwimSyncAdmin/lib/classCoverage.ts`, `(coach)/today/index.tsx` (`fullyMarked`), and
`(coach)/classes/[id]/roster.tsx`.

**Why:** HANDOVER §6 calls this "duplication waiting to drift," and it's right. This
rule *is* the billing safety net — if the coach's screen and the admin's gap report ever
disagree about what "marked" means, the disagreement shows up as an underbill nobody
notices.

**Notes:** the engine copy is **unavoidable** (Deno, no npm resolution), so the target is
three-into-one, not four. Until then: **if you touch the rule, touch all four.**

### Fix the 5 pre-existing `tsc` errors in the app — **S** `[handover]`
`SwimSyncApp/app/(parent)/home/child/[id].tsx` doesn't typecheck (Supabase join typing).

**Why:** CI runs jest, not `tsc`, for the app — so these are invisible and permanent.
Worse, a known-broken baseline means a *new* type error hides in the noise, and every
future session wastes time re-establishing that these aren't their fault (HANDOVER §5
has to warn about it explicitly).

**Notes:** fix, then add `tsc --noEmit` to CI so the baseline stays clean. The second
half is the point.

### Deeper component-render tests — **M** `[handover]`
RN screens with a mocked Supabase; admin table components.

**Why:** frontend tests currently cover `lib/**` pure functions only. The billing *maths*
is well covered (34 pgTAP + 8 Deno), but the screens where a coach actually loses money
by abandoning a task are covered only by hand-run Playwright drivers.

**Notes:** named in HANDOVER §5 as "the natural next additions." The
`run-ui-playwright` drivers show what's worth pinning.

### Shared `lessonDates.ts` package — **M**
The file is duplicated **byte-identical** in both apps.

**Why:** filed for visibility, **not recommended**. HANDOVER §6 makes the case
deliberately: separate npm projects, no workspaces, different React majors, different
bundlers and test runners. Sharing ~120 lines of pure date maths would need workspace +
Metro `watchFolders` + `transpilePackages` surgery. The file has **zero imports**, so
drift is cheap to spot (`diff` the two), and each has its own test file.

**Notes:** the reason to revisit is if workspaces arrive for *another* reason — then
this comes along free. Until then: **edit both.** Recorded so the decision isn't
re-litigated from scratch every time someone notices the duplication.

### Production data cleanup — **S**
Two leftovers from pre-launch verification may still be in the cloud project: an
**orphaned PayNow QR file** (from the demo coach "Marcus") in Storage, and a throwaway
test parent **`kahhangg+swimrt1@gmail.com`** in auth.

**Why:** harmless, but the production DB is otherwise a genuine clean slate, and this is
the only known exception. It's recorded **only in Claude's project memory** right now —
which ages out. Writing it down here is most of the value.

**Notes:** both are dashboard operations (no service key locally).

### Email confirmation copy and templates — **S** `[handover]`
Confirmation emails still use Supabase defaults.

**Why:** cosmetic today because **email confirmation is intentionally OFF** — a
self-registering parent isn't sent one. Only matters if confirmation is ever turned on.

**Notes:** confirmation was turned off deliberately (it stranded web parents on a "check
your email" step). The branded template pattern exists at
`supabase/templates/recovery.html` if this is ever needed.

---

## Deliberately not doing

Kept so the reasoning doesn't get re-litigated.

| Idea | Why not |
|---|---|
| **Pre-generating lesson sessions** (a scheduled session generator) | PRD §7.5 is knowingly unimplemented and should stay that way. Sessions are created lazily by the coach's attendance save; which lessons *should* have happened is derived at read time from `classes.day_of_week`. Pre-generation adds a job, a schedule, and a pile of edge cases when classes change — for no gain the read-time derivation doesn't already deliver. **Don't "fix" this** without a reason the derivation genuinely can't serve. (HANDOVER §6.) |
| **A parent-facing swimming-ability picker** | Removed on purpose (PRD §5.1). Parents self-reporting ability isn't information anyone trusted; the class a child is in is the real signal. If levels return they should be **coach-defined** — see the backlog item above. |
| **Re-adding Notification Preferences / Help & Support buttons** | Removed as dead stubs with empty handlers, not lost (HANDOVER §12). Build the feature first, then the button. |
| **`Alert.alert` for user feedback** | A **no-op on RN-web**, so it silently does nothing on the deployed app. Use `confirmAction` / the global Toast / inline form errors instead (HANDOVER §12a). The only sanctioned use left is the native-only media-library permission prompt. |
