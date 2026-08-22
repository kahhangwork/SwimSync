# SwimSync — Backlog

_Last updated: 2026-08-22 — **Two decisions recorded, nothing built.** *A location entity* is DEMOTED
from the queue's head to **Later** (production is one location; it only bites a multi-venue business), so
the build order now has **no rework-critical head** — just the Wave D traps and the Later pool. And
*cancelling TODAY's lesson from the admin panel* is **REFUSED** (advance means advance; today/past is the
coach's rain/coach mark), moved to *Deliberately not doing* — so *Advance-cancel follow-ups* is now closed._

_Previously, 2026-08-21 (6th) — **Advance-cancel EXTENDS a prepaid package SHIPPED** (`20260821000800`,
PRD §7.6): a cancel extends the covering package by `holiday_extension_days`, restore retracts it — the
holiday twin. That follow-up is struck under *Advance-cancel follow-ups*; only *cancelling TODAY* remains
there. The queue's head is now **A location entity** (M)._

_Previously, 2026-08-21 (5th) — **Advance-cancel a lesson SHIPPED** (§8.81, PRD §7.6): the item at the top
of the build order was deleted; two decide-first follow-ups filed under *Advance-cancel follow-ups*._

_Previously, 2026-08-21 (4th) — **parent Upcoming now shows make-ups + extra lessons** (§8.80, PRD §7);
Wave C's ranked five all shipped._

_Previously, 2026-08-21 (2nd) — **booking- AND enrolment-vs-retire races SHIPPED** (§7.200 `20260821000400`,
§7.201 `20260821000500`): both entry paths to a retired class re-read `is_active` under a `FOR UPDATE` lock.
The ROSTER-axis twin filed here that day was itself the §7.201 fix. Both deleted from below._

_Previously, 2026-08-19 (morning) — **Public-holiday voids shipped LIVE** (§8.70, PRD §7.16): a `holiday`
attendance status voids a day's lessons and event-extends packages; `recompute_package_extensions` is gone._

_Previously, 2026-08-15 — **Package renewal automation shipped LIVE** (PRD §7.16 *Renewal
offers*, `docs/DEPLOYMENT.md` §11.22): admin offers + `/package` pay page + Generate-all +
WhatsApp queue + default packages + Students columns/drawer. Build order exhausted again.
Two follow-ups filed: the UNPROMPTED parent nudge (behind cron) and bounding
`recompute_package_extensions`._

_Previously, 2026-08-14 (2nd) — **Catch a duplicate at the admin's Add-student step**
SHIPPED and removed (`find_roster_duplicates`, PRD §7.18). Built as phone **OR** name (not
phone-only as filed): name-only is what catches the dad-signed-up / mum's-number-keyed case,
and the merge banner no longer nets a claimed-vs-unclaimed pair, so creation-time is the only
automatic catch._

_Previously, 2026-08-11 — **Wave 2, *Multiple classes per child*, SHIPPED and was
removed** (`936e3bd`, live). Its Build-order entry is marked COMPLETE rather than deleted,
because two later items were held behind it and both are now unblocked: *Convert a trial
into an enrolled student* and *Book a make-up from the Attendance page*. One new item, the
gap the wave **revealed rather than created**: *a child in EVERY class of their kind has no
per-child make-up*. Two stale rationales corrected in place — Wave 4's "after Wave 2", and
*Cross-tenant students*, which rested on an index that no longer exists.
Previously, 2026-08-10 (3rd session) — ***`verify-schedule-week` fails two COMING UP
checks* SHIPPED and was removed** (`287142b`): driver rot, not a product bug, and the item's
own guess was right — the locator, scoped. §7.121 is the trap the fix nearly introduced.
**Two settled shape decisions were also recovered into *Attendance edit history view*** from
a worktree that was closed the same day it was opened, taking its gitignored `WORKTREE.md`
with it.
Earlier that day: the refused **CI gate on documentation size** filed under *Deliberately not
doing* (§7.119 holds the reasoning; `cb70808` holds the code). And before that: **THREE items
SHIPPED and were removed**, all in one commit
because they were one entanglement: *An unmarked BOOKING is invisible when its class has no
active enrolments*, *The class ROSTER hides a lesson whose only attendee is a guest*, and
*The attendance screen trusts a `sessionId` handed to it in the URL* — struck from the Build
order, from Wave 3's fold-in list, from Later, **and** from their own sections. The first was
Wave 1's parting find and the most valuable thing it left behind: a silent permanent
underbill. **Four items added**, three of them things this work found and deliberately
did not fix: *the admin's invoice pre-flight misses an unmarked EXTRA lesson* (the same
divergence running the other way), *sealing a LATER month strands an earlier unsealed one*
(§8.32's failure mode through a door it did not close), *`verify-schedule-week` fails two
COMING UP checks* (pre-existing, proven so — **since shipped, see above**), and
*`HANDOVER.md` §3 needs graduating*. The
`service_role` usage audit is now **DONE** and carries a recommendation NOT to build the
whitelist._

_Previously, 2026-08-09 (4th) — **the last of the audit gap SHIPPED and was removed**
(Wave 1 Chunk 3, `20260809000200`): *Direct writes to `students` are audited by nobody* is
struck from the Build order **and** its own section. **Wave 1 is now ONE item** — Chunk 4,
the inactive-class engine fix, the only one that touches money. **One item added**, and it
is the hole the shipped work disclosed rather than closed: *Deleting an admin destroys the
audit history* (**S**) — `prepare_admin_delete()` purges the target's `audit_log` rows,
which is exactly the contact-detail history a disputed claim needs. It carries a named
prohibition: do **not** make `actor_id` nullable to solve it (§7.50). *Attendance edit
history view* had its blocker cleared — the writers now exist, so the reader is buildable._

_Previously, 2026-08-09 (3rd) — **the entire PayNow / package chain SHIPPED and was
removed** (Wave 1 Chunk 2, `docs/plans/WAVE_1_PLAN.md`): *Give package requests a
reference number*, *Demote the static PayNow QR upload*, *The PayNow screen calls the
business "Coach"* and *A link to the admin panel from coach Settings* — struck from the
Build order **and** their own sections. **Wave 1 is now two items**, both migrations.
The *native store builds* decision row was settled rather than deferred: the upload is
**collapsed, not hidden**, and the row says why. **One item added**: *A PayNow ID can be
saved that no QR can be built from* (**S**) — a nine-digit mobile or a garbage UEN saves
cleanly, looks configured everywhere, and silently produces no QR._

_Previously, 2026-08-09 (2nd) — **two items SHIPPED and removed** (Wave 1 Chunk 1,
`docs/plans/WAVE_1_PLAN.md`): *Check column geometry on every admin table* and
*`verify-levels.mjs` is not hermetic*. **Struck from the Build order as well as their own
sections** — that is the two-places rule this file's own ⚠ is about. **Two items added**,
both found by the tooling that shipped: *`fixtures-trial-onboarding-teardown.sql` deletes
invoices it does not own* (**S** — it breaks the "owns only its own rows" rule the CI
round-trip enforces, and the next fixture to touch invoices hits it) and *`/makeups` and
`/trials` render a 79px DATE column* (**S**, measured not guessed)._

_Previously, 2026-08-09 — one item added: *The class ROSTER hides a lesson whose only
attendee is a guest* (**S**, Billing and payments; also in the unordered pool). Found while
fixing `verify-trials.mjs` — the roster gates its Mark Attendance button on enrolments
alone, so a trial-only lesson is invisible there while the Schedule tab shows it. **Not a
billing hole**, which is why it is unranked: the lesson stays reachable and markable._

_Previously, 2026-08-08 (second pass) — **`## Build order` is no longer empty.** It had
been since 2026-07-19. The queue is now ranked by **rework cost** rather than value or size
— each item placed so finishing it never sends you back into something already built
(method: `.claude/skills/backlog-prioritisation/SKILL.md`). Five waves, plus an unordered
pool and a strictly-ordered email/scheduler chain. **Six decisions settled with the user
are recorded in a table at the top of the ranking**, because an unrecorded decision is
re-litigated: co-admin permission splitting (yes, not now), coach-per-lesson rather than
per-class, trainee pay (own rate), substitute pay (whoever taught), multiple classes per
child (yes, soon), and native builds (not yet).

**Four new items, one rewrite, one reversal.** New: *A lesson can have a substitute coach,
temporarily* and *Trainee coaches shadow the main coach on a lesson* (Coach workflow), *A
lesson recorded into an already-BILLED month is reported, and settled* (replacing "A
session added AFTER a month is invoiced is never billed"), and *An owner-only accounting
page* (Admin and operations). Superseded: *Multiple coaches per class* — both real needs
turned out to be session-level, so a class-level join table would have been rebuilt.
**Reversed: the *Deliberately not doing* row on substitute coaches** — it claimed
`session_pay_overrides` already supported it, which is false (that table can suppress a
lesson's pay and cannot name another coach). *Revenue reporting* is **absorbed** into the
accounting page, which adds the question it never asked: who is allowed to see it.

_Previously, 2026-08-08 — **two items SHIPPED (struck through in place, not deleted),
one DEPRIORITISED, and one idea refused.** Shipped: *A coach week view*, which went
further than it asked — the week view **replaced the Today tab outright** rather than
reshaping the Classes tab, so the coach's tabs are now Schedule / Classes / My Pay /
Settings — and *Pay and claim straight from the parent's invoice LIST*. Deprioritised:
**Revenue reporting**, moved from *Unordered — no dependencies* to *Later*, which is a
correction as much as a demotion (its accrual-vs-cash question is a dependency, so it
never belonged under "no dependencies"). Refused: a **configurable first-day-of-week**,
considered and dropped with the user — `weekOrder.ts` is Monday-first because it mirrors
the Postgres enum declaration order, and today-first rendering already overrides most of
what the setting would buy. **All of it is LOCAL ONLY at time of writing; see HANDOVER §9.**

Both shipped items carry a **corrected prediction** in their entry, which is the part
worth reading: the week view's filed shape (reshape the Classes tab) was wrong about
where it belonged, and the parent-billing item's predicted double-fire bug **does not
exist** — nested Touchables do not propagate a press on RN-web, tested by deliberately
re-nesting them._

_Previously, 2026-08-06 (second session) — **two items SHIPPED and removed:** *Tie the
attendance-marking window to un-invoiced months* and *`book_trial` has no date floor*, both
closed by `20260806000200` (PRD §7.6). The first shipped **before its own stated trigger** —
it said "revisit the first time a month is billed late", and the user chose to build it as
insurance instead, one month into a live monthly billing rhythm. Its filed fix was also
**wrong in one detail**: "the earliest UNSEALED billing month" leaves no floor at all,
because a month with nothing recorded is never sealed (§8a.1), so gaps reach back forever.
The shipped rule anchors on the **latest** seal instead, with the business's `created_at` as
the fallback when nothing has ever been billed._

_Previously, 2026-08-06 — **one item SHIPPED and removed:** *Multiple admin accounts per
tenant* (PRD §4.3, §8.31 — the join-table sketch it carried was superseded by
`tenants.owner_profile_id`, reasoning in `docs/ARCHITECTURE.md` §6); *Disable a staff
account* narrowed to its remaining COACH half; two new items: *Split co-admin permissions*
and *Owner transfer*. Previously 2026-08-05: *Run the UI drivers in CI*
(HANDOVER §8.30) — all 32 drivers now run nightly under `.github/workflows/ui-drivers.yml`
via `run-all-drivers.sh`, failures collected in one rolling `ui-driver-rot` issue. The
first sweep found eight broken drivers, none a product bug, which was the item's whole
thesis._

_Previously, 2026-08-04 (second session) — **one item filed, two corrected, none shipped
from here.** Filed: *decide whether `service_role` deserves the whitelist treatment* — the
role where grants genuinely are the only gate, and where the `authenticated` oracle
deliberately does **not** transfer. *Run the UI drivers in CI* gained the evidence it was
missing: `verify-parent-claim.mjs` was found red since **58 minutes after it was written**,
and §7.79's static detector **cannot** catch that class — the driver can fail, does fail,
and exits non-zero to nobody. *Direct writes to `students` are audited by nobody* had a
stale premise corrected: browser-written audit rows were possible-but-wrong, and
`20260804000300` made them **impossible**. Note the `anon` REFERENCES/TRIGGER/TRUNCATE
concern named in the line below is **closed** — `20260804000400` revoked it and a remote
dump on 2026-08-04 confirms `anon` holds nothing on any table._

_Previously, 2026-08-04 — **three items shipped and removed** (§8.28): *revoke `anon`
EXECUTE from the remaining SECURITY DEFINER functions*, *a business cannot read its own
audit trail*, and *retire `tenants.kind` / narrow `coaches_without_rate`* — the last of
which was **half-wrong as filed**: the SQL had been correct since 2026-07-19 and the
"fix" of 2026-08-01 had replaced a working column with a browser scan (§7.83). One item
filed: **`anon`'s REFERENCES/TRIGGER/TRUNCATE on 37 production tables** — real, from
Supabase's own template rather than this repo, and currently unreachable. One
**Deliberately not doing** row: the blanket `ALTER DEFAULT PRIVILEGES` revoke, refused
twice. *Attendance edit history view* had its premise corrected — it is now actually true.
Previously, 2026-08-03 — six items filed from a day of real app use: the ordered pair *give package requests a reference number* → *demote the static PayNow QR upload* (**do them in that order**; the reverse breaks paying for a package), the PayNow screen's "Coach" copy, *pay and claim from the parent's invoice list*, *a coach week view*, and *a link to the admin panel from coach Settings*. One **Deliberately not doing** row: **any invoice or payment count in the coach app** — the user's decision, and the kind that gets re-litigated. One item filed and then **deleted the same day because its premise was false**: `verify-tz-saturday.mjs` was recorded as assertion-less on the strength of a bad grep, and running it showed 5/5 (§7.79). The *coach week view* entry was corrected too — the Classes tab gained weekday grouping on 2026-08-03, so the item is now about DATED lessons, not the timetable that shipped. Earlier, 2026-08-02: *Mark package-funded lines on the invoice detail* shipped and was removed_

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

Items below are grouped by **theme**, not priority — the **[Build order](#build-order)**
section right below ranks them for the current stretch. Rough sizes: **S** = an afternoon,
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

## Build order

**Ordered to prevent RE-WORK, not by value or by size:** each item is placed so that
finishing it never sends you back into something already built. Where two items have no
edge between them they share a wave and are picked by value. Method:
`.claude/skills/backlog-prioritisation/SKILL.md`. Sizes as above (**S**/**M**/**L**).

This ranking lives **only here** (one source of truth — deliberately not duplicated as a
number on every heading, which would just drift). The item bodies below stay grouped by
theme.

> ⚠ **A SHIP HAS TO BE MARKED IN TWO PLACES, AND THE RANKED LIST IS THE ONE THAT GETS
> FORGOTTEN.** Three items were found listed here as unbuilt while their own sections read
> SHIPPED — *Makeup lessons* (6 days), *Editing a student's contact details* (6 weeks), and
> *Pay and claim from the parent's invoice list* (caught during the session that shipped
> it). The item bodies were correct every time; these lists were not, and a list is what
> someone picking work actually reads. **When you strike an item through, grep this
> document for its name before you close the file.**

### The near-term plan — build roughly in this order

_(Re-ranked **2026-08-08** by rework cost. The previous ranking had been empty since
2026-07-19. Five shaping decisions were settled with the user the same day and are recorded
below, because an unrecorded decision is re-litigated.)_

#### The six decisions this ranking rests on (settled 2026-08-08)

| Decision | Answer | Consequence for the order |
|---|---|---|
| Split co-admin permissions? | **Yes eventually, not now** | *Split co-admin permissions* moves to Later. The first real need — an **owner-only accounting page** — needs no capability model, because `is_tenant_owner()` already exists |
| Coach per class or per lesson? | **Substitute per LESSON; shadow per CLASS** *(revised 2026-08-12)* | A permanent handover already works. The 2026-08-08 answer was "both per lesson", and the shadow half was **wrong**: a trainee is staffed to a class for a term, not signed up lesson by lesson. Shipped per-lesson on 2026-08-11 and moved to `class_shadow_coaches` on 2026-08-12 — cheap only because production held zero roster rows |
| Trainee coach pay? | **Their own SHADOW rate** *(revised 2026-08-12)* | A shadowed lesson produces two payout rows. "Their own rate" originally meant their teaching rate, which pays a trainee a full coach's wage; `coach_rates` gained a role so a coach can hold both, and payroll REFUSES rather than fall back when no shadow rate is in force |
| Substitute pay? | **Whoever actually taught it** | The session override moves money, so it is a wages change, not just a roster label |
| Multiple classes per child? | **Yes, and soon** | **SHIPPED 2026-08-11** as Wave 2 (PRD §7.4). The ranking was right: it dropped `one_active_enrolment_per_student`, and three pieces of code turned out to be correct only because that index held. Everything enrolment-shaped built after this inherits the new model |
| Native store builds ($99/yr)? | **Not yet — stay web-only** | *Push notifications* stays blocked. **Settled by what shipped 2026-08-09:** the static PayNow QR upload was neither deleted nor hidden — it is **collapsed behind a disclosure and always present**, which keeps the native fallback path alive *and* survives a stored-but-unencodable PayNow ID. Any future native decision inherits that, not a conditional |

#### Three more settled 2026-08-16 (the re-rank after referrals shipped)

| Decision | Answer | Consequence |
|---|---|---|
| Revenue: accrual or cash? | **Accrual** — revenue = invoices *issued* in the month | Settles *An owner-only accounting page*'s decide-first question. Sum `invoices` issued that month **plus** `student_settlements.amount where kind='paid_outside'`; do **not** ship a partial figure |
| Enable cron, or stay manual? | **Manual, for now** | Parks the whole scheduled-reminder tail: *unprompted low-balance nudge*, *automated reminder workflows*, the referral *reward-expiry* nudge. The WhatsApp click-through queue stays the chasing tool. The invoice/credit-note email chain is NOT cron-gated and stays buildable |
| Multi-language? | **Refused** | Low value for the target base; English-only is enough. Moved to *Deliberately not doing* with a Mandarin-for-pickup revisit trigger. Stops it accruing retrofit tax unranked |

#### Wave 1 — cheap, independent, and inherited by everything after (**COMPLETE**)

**All four chunks are DONE.** Chunk 4 shipped 2026-08-09: `classes.is_active` means
scheduling and nothing else, the engine bills retired classes, and the admin can retire and
restore one from the Classes page (`deactivate_class()` / `reactivate_class()`, three
refusals, no overrides). RISK 1 was closed three ways — a `deactivated_at` date clamps what
an inactive class is expected to have run, the RPC refuses to create the blocking state, and
the Classes page can show and restore a retired class. The production audit it gated on
returned zero rows on all three queries.

**And what it did not close is now closed too.** *An unmarked BOOKING is invisible when its
class has no active enrolments* shipped **2026-08-10** — `core.ts`'s two early guards now
consult `bookingsByDate`, so a guest-only class reaches the completeness gate instead of
being skipped and sealed over. It went out with the two coach-screen items it was entangled
with (the roster's guest-only lesson, the attendance screen's trusted `sessionId`) and with
migration `20260810000100`, which shuts the doors that could re-create the blocking state:
`book_trial()` and `schedule_extra_lesson()` now refuse a retired class, and
`classes.is_active = false` requires a `deactivated_at` date.

_(Eight items have now left this wave. **Direct writes to `students` are audited by
nobody** shipped 2026-08-09 as Chunk 3 — an `AFTER UPDATE … WHEN (OLD.* IS DISTINCT FROM
NEW.*)` trigger, `SECURITY DEFINER`, recording `to_jsonb(OLD)`/`to_jsonb(NEW)`. It left one
disclosed hole behind, filed separately below as *Deleting an admin destroys the audit
history*. **Pay and claim from the parent's invoice LIST**
shipped 2026-08-08 alongside the Schedule tab. **Check column geometry on every admin
table** and **`verify-levels.mjs` is not hermetic** shipped 2026-08-09 as Chunk 1 of
`docs/plans/WAVE_1_PLAN.md`. **Give package requests a reference number**, **demote the
static PayNow QR upload**, **the PayNow screen calls the business "Coach"** and **a link
to the admin panel from coach Settings** all shipped 2026-08-09 as Chunk 2 — see PRD
§7.10, §7.16, §7.21. The "hide, do not delete" decision in the table above was honoured
**and then strengthened**: the upload is not hidden at all, only collapsed behind a
disclosure, because a stored-but-unencodable PayNow ID makes "hide when a proxy exists"
one typo away from a business that cannot be paid.)_

#### Wave 2 — **Multiple classes per child** (M) — **COMPLETE 2026-08-11**

Shipped and live: migration `20260811000100`, PRD §7.4 and §7.20. The retrofit tax was
paid where predicted (enrolment UI, five `.find(e => e.is_active)` read sites) and **not**
where the item had guessed: the invoice engine needed nothing at all, because it already
loops per class — `expectedStudentsOn()` was never the problem, and that claim was stale
when it was written. What it *did* cost was three RPC repairs nobody had listed, all of
them correct only because the dropped index held (§7.124, §7.127).

**Waves 3–5 inherit the new model.** *Convert a trial into an enrolled student* and *Book a
make-up from the Attendance page* were held until after this and are now unblocked.

#### ~~Wave 3 — The lesson-level coach roster~~ — **SHIPPED 2026-08-11**

Both items are built and live: `20260811000200`, PRD §7.13/§7.20/§14.3,
`docs/plans/WAVE_3_PLAN.md`.

*(And `20260812000100`'s guard was **deleted one day later** by `20260812000200`, along with
its 16 pgTAP checks: the class-level shadow makes the state it guarded unbuildable. Recorded
because a deleted guard looks like an oversight otherwise. `sessions_i_am_main_on`, which
shipped in the same migration, survives and now has its own test file.)*

**Its follow-up is also done, 2026-08-12** — `20260812000100` (the shadow-branch guard plus
`sessions_i_am_main_on`) and `verify-coach-roster.mjs`, all three struck below.
`docs/plans/WAVE_3_FOLLOWUP_PLAN.md`. *(This heading read "Nothing is queued here" while three
Wave-3-descended items sat unbuilt further down — the exact drift the ⚠ at the top of this
section warns about, found by `/session-start` on 2026-08-12. Struck in both places this time.)*

**Wave 3 is now fully shipped.** Its last open item — *The Attendance page's Coach column can
name someone who did not teach* — SHIPPED 2026-08-14 (money-axis attribution via
`lib/lessonAttribution.ts`, cover chip, shadow line; the struck entry below and §7.152 have the
detail). The product choice settled 2026-08-13 (name who taught, cover chip, shadows on a second
line) was built as specified.

_(A third item once sat here — **the attendance screen trusts a `sessionId` in the URL** —
and shipped 2026-08-10 instead, because the same change removed the caller that passed it.
The screen resolves the session from `(class_id, date)` and accepts no param. Recorded so it
is not re-filed as an oversight.)_

**One prediction in this section was wrong and the correction is worth keeping:** it said
the Schedule tab's coupling was "two lines of one query". `:317` filters **`classes`**, and
`classes_select` did not let a substitute read that row at all — so changing which ids the
query asks for returned nothing until **five** further policies were widened. `lib/scheduleWeek.*`
and `lib/scheduleBuckets.*` did need no change, as predicted. Measuring one line of a query
does not measure what the row behind it is permitted to be.

#### Wave 4 — ~~A lesson recorded into an already-BILLED month is reported, and settled~~ ✅ SHIPPED 2026-08-12

Shipped as specified (PRD §7.17's *recorded into an already-billed month* subsection):
`unbilled_sealed_lessons()` + the standing Invoices-page report + sidebar badge, settled
through `student_settlements`. The item's full text is deleted from this file per the
doc gate; the reasoning it carried now lives in the PRD subsection and the migration
header (`20260812000400`).

#### Wave 5 — admin authority

12. ~~**Owner transfer** (S/M)~~ — **SHIPPED 2026-08-13** (`20260813000100`, PRD §4.4):
    platform-admin only, one path for handover and lost-owner alike.
13. ~~**Disable a COACH account** (M)~~ — **SHIPPED 2026-08-13** (`20260813000200`,
    PRD §4.3 *Disabling a coach*): atomic handover to a replacement, pure-coach ban.
14. ~~**Tenant suspension** (M)~~ — **SHIPPED 2026-08-13** (`20260813000300`, PRD §4.4
    *Suspending a business*): staff and parents dark, staff banned, engine skips the
    tenant; already-sent invoice links deliberately keep working. **Wave 5 complete.**

~~**Package renewal automation — M** (decided + planned 2026-08-15)~~ — **SHIPPED LIVE
2026-08-15** (PRD §7.16 *Renewal offers*, `docs/DEPLOYMENT.md` §11.22). Admin-created
offers + tokenised `/package` pay page + Generate-all preview + shared WhatsApp queue +
per-category/all-classes default packages + Students Package/Left/Expires columns and an
Actions drawer. **Also discharged** *A Playwright driver for the weeks/holiday package UI*
(`verify-package-renewal`). ~~**Build order is exhausted again** — pick from *Unordered*.~~

~~**NEXT — Parent referral codes (M)**~~ — **SHIPPED LIVE 2026-08-15** (§8.61, `docs/DEPLOYMENT.md`
§11.23): migration `20260815000700` + `public-package` v2 + `package-emails` v3 + both apps, on prod,
grant dump clean, RISK 12 checks 0/0. DORMANT (no business has enabled it).

**SHIPPED LIVE 2026-08-21 — Capacity hard limit + holiday retirement boundary + Lessons badge** (§8.73,
`docs/plans/CAPACITY_HOLIDAY_BADGE_PLAN.md`, DEPLOYMENT §11.31): three migrations, holiday → capacity →
badge, no engine change, grant dump clean. Its one calendar-wave follow-up, *A location entity*, was
**demoted to Later 2026-08-22** (production is one location) — see the *Later* section below.

**Build order re-ranked 2026-08-16 after referrals shipped.** No rework-critical sequence remains —
the queue is now a decision-gated tail plus a flat value pool. Three decisions settled (table above):
accrual, manual reminders, multi-language refused. The order below: **Wave B** the one real internal
chain → **Wave C** value-ranked independents → **Wave D** latent traps → **Later** big features →
deliberately-last. Sections restructured below.

> ~~**NEXT — Advance-cancel a lesson (M)**~~ — **SHIPPED 2026-08-21** (PRD §7.6 *Advance-cancel*,
> §7.203/§7.204, `20260821000700`). Both decide-first follow-ups are now settled (package-extension
> **SHIPPED** 2026-08-21, §8.82; cancelling-today **REFUSED** 2026-08-22 → *Deliberately not doing*), so
> *Advance-cancel follow-ups* is closed. **No rework-critical head remains** — the queue is the Wave D
> latent traps plus the *Later* pool (which now also holds *A location entity*, demoted 2026-08-22).

### Wave B — the one genuine internal chain — **EXHAUSTED bar the cron-gated tail**

*Invoice-email delivery + retry SHIPPED LIVE 2026-08-16 (PRD §7.7, `docs/DEPLOYMENT.md` §11.24),
establishing the `invoice_email_sent_at` + per-invoice atomic-claim pattern.*
***Credit-note email notifications SHIPPED 2026-08-17** (PRD §7.8) — it did inherit that
pattern, as its own `credit_notes.email_sent_at` claim column.* **Nothing buildable is left in
Wave B**; the next build comes from **Wave C** below.

**The tail is PARKED — manual chosen 2026-08-16.** The cron decision gated *The UNPROMPTED
parent low-balance nudge* (S) and *Automated reminder workflows* (M) (plus the referral
reward-expiry nudge); all stay unbuilt while reminders remain manual. Revisit if the WhatsApp
click-through queue stops scaling.

### Wave C — independent, pick by value (no edges between them)

**All five ranked Wave C items have SHIPPED** — struck in their own sections below:
1. ~~Convert a trial into an enrolled student~~ — DONE 2026-08-17.
2. ~~Upcoming lessons view for parents~~ — DONE 2026-08-17; **make-ups + extra lessons added
   2026-08-21** (§8.80, PRD §7); **cancelled lessons added 2026-08-21** (advance-cancel, PRD §7.6).
   `docs/plans/UPCOMING_LESSONS_COMPLETE_PLAN.md` is complete.
3. ~~Book a make-up from the Attendance page~~ — DONE 2026-08-17.
4. ~~Attendance edit history view~~ — DONE 2026-08-17 (the Change History page).
5. ~~Export to CSV~~ — DONE 2026-08-17.

**Wave C is exhausted bar the lower-value S pool, no order:** Maps deep link, Better
filtering/search, Moving a student between businesses (two silent loose ends), the
family-status client-side scan, Email-confirmation copy, Tick off swimming skills (M).

### Wave D — latent traps: cheap now, silently worse later

- ~~**A PayNow ID that can't build a QR**~~ — **DONE 2026-08-18** (§8.68). Advisory warning at
  the admin save (`SwimSyncAdmin/lib/paynow.ts`, mirrors `buildPayNowPayload`'s mobile check);
  a UEN has no checksum so only the mobile shape is verifiable, which is all the real builder checks.
- ~~**`fixtures-trial-onboarding-teardown` deletes invoices it doesn't own**~~ — **DONE 2026-08-18**
  (`e401ed7`). The invoice delete is now scoped to the fixture's own class (`invoice_items → lesson_sessions.class_id`)
  and ordered before the session delete; a sibling worktree's invoices survive.
- ~~**Bound `recompute_package_extensions`**~~ — **SUPERSEDED 2026-08-19** (§8.70). The scan is
  gone entirely: holiday extension is now event-driven (marked at attendance time), so there is
  no standing per-load scan left to bound. `recompute_package_extensions` was dropped.
- ~~**A re-toggled attendance correction issues a SECOND credit note and DOUBLES the credit**~~
  — **DONE 2026-08-18** (§8.68, migration `20260818000100`). Symmetric ledger: one `credit_notes`
  row reused per `invoice_item_id` (`UNIQUE(invoice_item_id)` + `lesson_session_id` index);
  `absent→present` voids an undrawn note (−balance), and un-correcting an already-DRAWN credit is
  **refused** (`CN001`). The partial email index was found **redundant** — full `UNIQUE(invoice_item_id)`
  + reuse-row makes "one email per line" structural — so it was deliberately NOT added.
- ~~**`tenants.suspend` is VESTIGIAL and should be dropped**~~ — **DONE 2026-08-18** (§8.68).
  `DROP COLUMN IF EXISTS` — the column was schema DRIFT (present in the DB, created by no
  migration), which is why `IF EXISTS` was required for a clean `db reset`.
- ~~**`/makeups` and `/trials` 79px date column**~~ — **DONE 2026-08-18** (§8.68). `whitespace-nowrap`
  on the Date `<Th>`/`<Td>` in both pages.
- ~~**Partial-payment accounting for a voided-credit reopen**~~ — **BUILT LOCALLY 2026-08-22, not yet
  deployed** (`20260822000100`, `docs/plans/PARTIAL_PAYMENT_PLAN.md`). Paid invoices are now immutable: a
  void against a PAID invoice posts the drawn value to a new `parent_tenant_balances.debit_balance` (the
  mirror of `credit_balance`) instead of reopening it; the engine folds that debit onto the next invoice,
  drawing credit against the debit-inclusive base so credit and debit net. Reviewed by `/plan-review`
  (fable) — the single-signed-column idea was replaced with the separate `debit_balance` for ledger
  safety. Two follow-ups filed below. Dormant (0 credit notes on prod). **Deploy via `/deploy` when ready.**
- **Partial-payment: seamless re-correction of a debited note — the FOLDED case only** (M)
  `[pending case BUILT 2026-08-23]` — re-correcting a voided-and-debited note whose debit is still
  **PENDING** now **auto-unwinds** it (`20260822000200`, `handle_attendance_update`): the debit is
  retracted, the undrawn remainder returns to the pool, and the note is restored. **What REMAINS
  deferred:** once the debit has been **FOLDED** onto a later invoice (or written off), the re-correction
  still refuses (`CN002`) — reversing a folded/settled charge is the multi-flip state machine. **Why still
  deferred:** deeply dormant, and `INVOICE_RUNBOOK.md` now has a manual path (issue a credit note on the
  adjustment invoice). Safe: no silent misbill. `partial_payment_followups.test.sql` pins both arms.
- ~~**Partial-payment: admin PRE-BILL debit visibility**~~ — **BUILT LOCALLY 2026-08-23, not yet deployed**
  (`20260822000200`, `docs/plans/PARTIAL_PAYMENT_FOLLOWUPS_PLAN.md`). A "Pending charges — not yet
  invoiced" panel on the admin Invoices page (tenant-scoped) shows each family's `debit_balance` before it
  bills, with a **Write off** action (`write_off_parent_balance` — admin-only, audited, reconciliation-
  safe). The deletion-cascade worry became an **offboard guard** instead: a `parent_tenants` BEFORE UPDATE
  trigger refuses set-inactive while `debit_balance > 0` (**debit only** — credit is preserved across
  offboard); the write-off is its exit ramp. A standalone "collect now" charge was designed then
  **REJECTED** (it forced a `kind` discriminator + an engine change and still only produced a chaseable
  invoice). Dormant (0 credit notes on prod). Deploy via `/deploy`.
- ~~**`HANDOVER.md` §3 needs graduating**~~ — **DONE 2026-08-22.** DORMANT trimmed to one line per
  area; the *Production reality* deploy/rollback narrative dropped for a pointer to `docs/DEPLOYMENT.md`
  §11, which already held it (restated in §3 it was a fourth copy that drifts). Prohibitions + the
  verified-vs-specified table kept intact, as the item specified. HANDOVER back under the 45 KB budget.

### Later — big features carrying their own dependencies

**An owner-only accounting page (M — *absorbs Revenue reporting*)** — **accrual chosen
2026-08-16** (revenue = invoices issued that month; sum issued invoices + `paid_outside`
settlements, no partial figure), and the trainee-coach payroll dependency is **discharged**
(shipped 2026-08-12). So this now waits on nothing but priority. Needs no capability model.
**Split co-admin permissions (M)** — *yes eventually*; the accounting page does not wait
on it. **A location entity / venue (M — *demoted here 2026-08-22*)** — production is one
location, so promoting `classes.location_name` to a `locations` table only pays off for a
multi-venue business; full item under *Admin and operations*. Household split billing (M — *needs a credit-splitting
rule*), Auto PayNow detection (L — *the CSV-import M is the 10% worth doing first*),
In-app payment gateway (L), Native store builds (M — *deferred; not spending the $99 yet*)
→ Push notifications (M — *blocked by it*), Check the logo for brand collisions (S —
*before native builds, whenever those happen*), Bulk WhatsApp Cloud API (M — *only on a
real tenant's request*). *(Multi-language and More polished dashboards moved to
Deliberately not doing 2026-08-16.)*

**Two items are deliberately LAST, and get cheaper by waiting:**

- **Generate real Supabase `Database` types** (M) — a schema snapshot. Waves 2 and 3 are
  both migrations; every one landed first invalidates it.
- **Deeper component-render tests** (M) — they pin screens the planned redesign will
  rewrite.

**Shared `lessonDates.ts` package (M)** stays not-recommended and unranked — free only if
workspaces arrive for another reason.

---

## Coach workflow

### ~~Makeup lessons~~ — SHIPPED 2026-08-02 as the guest-pass model (PRD §7.20)
The two invariants it was expected to break held un-broken: a make-up is a **booking**
(the trial_bookings shape), never a second enrolment, and billing still follows
attendance rows — a guest's row bills at their home class's rate or draws the family's
package by the booking's snapshotted category. No "makeup credit" ledger was needed
because a missed lesson never billed in the first place. Three follow-ups filed below:
*Book a make-up from the Attendance page*, *A different-coach PRIVATE make-up*, and the
`book_trial` date-floor asymmetry.

### A child in EVERY class of their kind has no per-child make-up — **S/M** `[Wave 2 fallout]`
When a child is enrolled in every class of their category, there is nowhere to guest them
into, so a missed lesson has no per-child remedy at all.

**Why:** Wave 2 (`20260811000100`) did not create this gap — it *revealed* one the dropped
constraint was hiding. `book_makeup()` now refuses every class the child is actively in
(it must: booking into their other class bills correctly but **silently voids** the
make-up — the child attends the lesson they were already attending and gets nothing
replacing the missed one). The Make-ups modal shows the existing "no other class of the
same kind" panel and routes to **Extra lesson** — but `schedule_extra_lesson(class_id,
date, reason)` is **class-wide**: it creates an off-schedule session that *every* enrolled
child is then expected at. That is not a per-child make-up, and each of those children
becomes a lesson someone must mark or the month blocks.

**Notes:** the honest workarounds today are a whole-class extra lesson, or marking the
miss non-billable so the family is not charged. A real fix is probably a per-child
off-schedule session — one child, one date, priced at their home rate — which is close to
the guest-pass shape already in `makeup_bookings` but with the child's own class as host.
**Do not "fix" it by relaxing the own-class refusal**; that is the silent-void case, and
it is pinned by `multi_class.test.sql`. Only bites a business whose category has few
classes and a keen swimmer in all of them, which is why it is filed rather than built.

### ~~Book a make-up from the Attendance page~~ — **S** — **DONE 2026-08-17**
Shipped: absent/cancelled rows carry a **Book make-up** action; the row's class is the home
the make-up replaces, so the modal asks only host class + date and calls `book_makeup()`. The
Make-ups page stays primary. ⚠ RISK 6 gate (`lib/makeupFromAttendance.ts`, unit-tested): the
button shows only on the child's OWN enrolled class — a guest row carries the host class, not
an enrolment, and would be refused. PRD §7.20 describes it. (Off-schedule extra dates are not
offered here — the Make-ups page remains the full-featured home.)

### A different-coach PRIVATE make-up — **M**
A private-category make-up today is an **Extra lesson of the child's own class** — same
coach by construction. A school whose private coach is away wants the make-up taught by a
*different* coach, which means a temporary one-off class (its own coach, rate, wage row,
and cleanup) or a per-lesson coach override. Deliberately deferred from the guest-pass
work: real complexity, no requester yet.

### Tick off swimming skills per child — **M**
Mark which of a level's skills a child has passed, so a coach can see "Ethan has 4 of 6
for Toddler 2" and a parent can watch progress accumulate.

**Why:** the skills exist as data now (PRD §7.15) and describe the LEVEL only. The obvious
next question from any coach looking at that list is "which of these has this child
done?" — which is the actual pedagogical record a swim school keeps, and today still lives
on paper or in the coach's head.

**Notes:** deliberately deferred when the skill lists were built 2026-07-19, and the data
was modelled as rows rather than prose *specifically* so this would not need a migration
out of a text blob. What makes it an M rather than an S:

- **Coaches have no write path to students**, by design — granting them `UPDATE` would
  also let them edit names, dates of birth and notes, because RLS is row-level, not
  column-level. This needs its own narrow table (`student_skill_progress`) with its own
  policy, not a widening of `students_update`.
- **Decide what happens when a child changes level.** Records should almost certainly be
  kept and simply not shown — a child who moves up and later moves back should not lose
  their history — but that is a decision, not a default.
- **Decide whether a skill is binary or graded.** The source curriculum is a flat list,
  which suggests passed / not-passed; anything richer is a bigger claim about how coaches
  actually assess.
- Watch the read cost: a roster of six children each with six skills is 36 rows, so fetch
  it per class rather than per student.

### ~~Convert a trial into an enrolled student~~ — **S** — **DONE 2026-08-17**
Shipped: the *past — needs marking* list on the Trials page carries a **Convert to enrolled**
action that enrols the child into the class they tried, reusing the Unassigned Children insert.
The RISK 1 two-press guard (a rebooked *upcoming* trial would otherwise block billing) is in
`lib/trialConvert.ts` and unit-tested; PRD §7.17 describes the behaviour. The past trial row
deliberately stays on the needs-marking list — converting is not marking.

<details><summary>Original item (kept for the reasoning)</summary>

After a trial is marked, give the Trials page a **"Convert to enrolled"** action instead
of sending the admin to Unassigned Children to do it.

**Why:** converting is the whole point of running a trial, and it currently has no home.
Since 2026-07-26 a child with an *upcoming* trial is deliberately hidden from Unassigned
Children (they need no decision yet), so the conversion path is: wait for the trial date
to pass, then find them on a page named after a different problem. The decision belongs
where the trial does.

**Notes:** the enrolment is the dangerous half — an active enrolment makes the child
expected at **every** lesson, and unmarked attendance blocks billing outright. So this is
a relabelling of an existing guarded action, not a new capability: reuse the same insert
Unassigned Children performs, and keep the "this makes them expected every week" wording.
The natural trigger is the Trials page's *past — needs marking* list, once the lesson has
been marked.

</details>

### ~~Editing a student's PARENT contact details~~ — **S** — **DONE 2026-07-26**
Shipped and deployed (`3832670`): every child on the admin Students page has a **Contact
details** action. **PRD §7.19** describes the behaviour; `CONTACT_DETAILS_PLAN.md` has the
plan, the risk review and the walked gate.

The reasoning below is kept because two of its calls were **settled differently** than it
proposed, and the differences are the design:

- **A claimed child is READ-ONLY, not editable.** The item left this open. Settled: the
  admin sees every linked parent's own `profiles` row, and the family maintains it in the
  app. A second editable copy would be the stale duplicate `students.age` was removed for
  — and `is_tenant_admin(NULL)` refuses the write anyway, since a parent is global.
- **A pending claim LOCKS the fields**, which the item did not anticipate.
  `student_claims.match_reason` is a snapshot, so editing under a live claim makes the
  admin approve on a reason that stopped being true.
- The phone check is **advisory everywhere and blocks nothing**; the `964` on production
  is now fixable, which was the point.

**Still outstanding, and split out above:** *Direct writes to `students` are audited by
nobody* — this screen and `setLevel()` both write with no `audit_log` row.

<details><summary>Original item (kept for the reasoning)</summary>

There is no way to change `provisional_contact_name` / `_phone` / `_email` on an existing
student.

> **These are the PARENT's contact details, stored on the child's row — not the child's.**
> A child has no phone or email of their own anywhere in the model, and should not. The
> columns exist for the window before the adult who brought the child has an account:
> `provisional_contact_phone`'s own `COMMENT` reads *"the number the coach arranged the
> trial on"*. All three are load-bearing, not just record-keeping — `_email` and `_phone`
> are the top two ranked signals in `find_student_candidates()`, and **`_name` is used as
> the invited parent's `full_name`** (`invite-parent/route.ts`), which is why a blank one
> showed an unnamed parent on the admin roster (HANDOVER §8.12).

**Why:** those fields are now how a child is matched to their parent's account
(PRD §7.18), and the phone is **required** when a child is created — but only *going
forward*. Every child added before 2026-07-26 has no contact details at all, so they can
only ever be matched by name, which is the weakest signal. There is no screen that can fix
that, and on production several real children are in exactly that state.

**Notes:** one of them has `964` stored as a phone, which `normalize_phone()` correctly
rejects as too short to be a signal — so bad data is already there and unfixable through
the UI. The admin's edit-student path is the obvious home, and **no migration is needed**:
`students_update` already grants `is_tenant_admin(tenant_id)` (`20260718000900_tenant_rls`).
Coaches must not get it: granting them `UPDATE` on `students` also exposes names, DOBs and
notes, because RLS is row-level, not column-level.

**Decide before building — should these stay editable once the child is CLAIMED?**
Nothing clears them on claim, link or merge (`merge_students()` `COALESCE`s them), so a
claimed child keeps them indefinitely. The argument for read-only-after-claim: the real
contact details then live on `profiles`, and a second editable copy on the student row is a
stale duplicate of exactly the kind `students.age` and `classes.price_per_lesson` were
removed for — plus it feeds the matcher for a child who can no longer be a candidate.

</details>

### ~~Attendance edit history view~~ — **S** — **DONE 2026-08-17**
Shipped as the **Change History** page (`/history`) — both settled shape decisions honoured:
labelled "Change History" not "Audit log" (the trail has holes by design), and one global
filtered list, not per-entity. Reads `audit_log` directly (grant + RLS already existed),
entity-type + date-range filters applied in the DB, diffs the `to_jsonb` snapshots
(`lib/auditDiff.ts`, unit-tested). ⚠ RISK 5: an unresolvable actor renders "unknown user",
never "system" — actor_id is always non-null (no-JWT writes insert no row), so "system" is a
defensive-only fallback. PRD §14 describes it.

<details><summary>Original item (kept for the reasoning)</summary>

Surface the existing audit trail in the UI.

**Why:** every attendance edit is already logged to `audit_log`, but nobody can see it
without SQL. When a parent disputes a charge, the answer exists and is unreachable.

**Notes:** the data is already there — this is a read-only view, not a new capability.
Admin panel first; the coach probably doesn't need it.

**The premise is now actually true (2026-08-04).** This item used to carry a warning that
"the data is already there" was only *half* true: `audit_log.tenant_id` was unset by most
writers, and `is_tenant_admin(NULL)` returns FALSE, so a business could read almost none
of its own trail — a history screen would have shown claims and merges and silently
omitted every attendance save. `20260804000300` stamps every row from its entity by
trigger and backfilled the 81 unstamped rows production held. **Two things to still get
right when building this:** the rows are visible to the *tenant admin*, not to the coach
whose edit they record; and `old_value`/`new_value` are full `to_jsonb(OLD/NEW)` snapshots,
so the screen must diff them rather than print them — the dispute this exists for is
*what the number used to be*.

**Two shape decisions are already settled — recovered 2026-08-10, and the recovery is
itself the lesson.** A worktree was opened for this item, took both decisions, wrote them
into its `WORKTREE.md`, and was closed the same day with no code written. `WORKTREE.md` is
**gitignored**, so closing the worktree destroyed the only copy; they survive here because
they happened to still be in a sibling session's context. That is the exact loss
`/worktree-close` exists to prevent — *extract the graduate list before the worktree is
destroyed* — and it failed silently, because a decision nobody wrote down leaves no gap
where it used to be.

1. **Route `/history`, label "Change History" — deliberately NOT `/audit` or "Audit log".**
   That name claims a complete legal record, and this trail has holes **by design**:
   `prepare_admin_delete()` purges a deleted admin's rows, and a write with no JWT actor
   (migration, `psql`, seed, edge function) records nothing at all and is allowed through
   (**§7.120**). The label must not promise what the data cannot deliver — and a reader must
   render an unattributed row as *"system"*, never blank.
2. **One global filtered list — NOT a per-entity route.** Entity type and a date range are
   filters, exactly as `attendance/page.tsx` already does it. A per-entity page would need an
   entry point from all five entity screens and answers a narrower question than *"what
   changed here recently"*, which is the one a disputed charge actually asks.

</details>

### ~~A coach week view~~ — **SHIPPED 2026-08-08 as the Schedule tab** (PRD §14.2)
It went further than this item asked. Rather than turning the *Classes* tab into a week
strip, the week view **replaced the Today tab outright** — the user's call, on the grounds
that two tabs both listing today's lessons with marking chips is duplication in the app's
most prominent navigation. Tabs are now **Schedule / Classes / My Pay / Settings**, and
the Classes tab and its roster are untouched.

Three decisions worth keeping, because each was reached by rejecting the obvious version:

- **Sections are driven by MARKING STATE, not the calendar** — NEEDS MARKING / TODAY /
  COMING UP / DONE. A purely calendar split (today / upcoming / past) collapses into one
  undifferentiated list on any week that is not the current one, which is exactly the week
  a selector exists to reach.
- **NEEDS MARKING is FLOOR-scoped, never week-scoped**, and it is the only section that
  ignores the selector. Week-scoping it would hide a straggler the coach has no reason to
  go looking for, and unmarked attendance blocks billing with no override. Note the range
  is not unbounded: `markable_floor` already means "back to the latest unsealed month".
- **The week is held as an OFFSET integer, not a stored Monday** (§7.95).

Deliberately NOT built: a configurable first-day-of-week. `weekOrder.ts` is Monday-first
*because* it mirrors the Postgres `day_of_week` enum declaration order, and today-first
rendering already overrides most of what the setting would buy. Considered and dropped
with the user 2026-08-08; do not file it as an oversight.

### ~~A lesson can have a substitute coach~~ · ~~Trainee coaches shadow the main coach~~
**SHIPPED 2026-08-11** — both, as one schema change, exactly as this section insisted.
Behaviour is in `PRD.md` §7.13/§7.20; the decisions and the ranked risk review are in
`docs/plans/WAVE_3_PLAN.md`. Kept as a stub only because *Multiple coaches per class* is
recorded below as superseded by them.

### ~~`assign_session_coach`'s shadow branch can demote a lesson's main~~ — **SHIPPED 2026-08-12**
`20260812000100_session_roster_guard.sql`. The guard covers **both** ways a lesson has a main,
not just the one this item described: the ROW main (a `session_coaches` row) and the
**ABSENCE** main (no roster row, so the class's own coach teaches it). A row-only guard misses
the second entirely — `assignableShadows()` filters by the *effective* main, so the client
already refused both and only the server half was missing. Plan and its ranked risk review:
`docs/plans/WAVE_3_FOLLOWUP_PLAN.md`. Two things it bought that outlive it: **§7.137** (the
pre-check form is TOCTOU; the guard belongs inside the statement that takes the lock) and the
driver's stale-tab race, **§7.139**.

Original entry, kept because the reasoning is still the reason:
Its `ON CONFLICT (lesson_session_id, coach_id) DO UPDATE SET role = 'shadow'` would silently
turn the session's **main** coach into a shadow if an admin added that same coach as a shadow.

**Why:** the demoted lesson then has no main, so the absence rule takes over and pay reverts
to the class's own coach — a quiet re-attribution of money nobody asked for. Only a
**client-side** re-check guards it today, so any other caller of the RPC is unprotected.

**Notes:** `set_session_main_coach()` deliberately refuses `ON CONFLICT DO NOTHING` for the
mirror of exactly this reason, so the asymmetry is an oversight in `20260811000200`, not a
design. **Needs a root-checkout migration** — a worktree found it and correctly could not fix
it. Cheapest form: raise in the shadow branch when the coach already holds `role = 'main'`
on that session, forcing the admin to reassign the main explicitly.

### ~~Wave 3 shipped with no UI driver~~ — **SHIPPED 2026-08-12**
`verify-coach-roster.mjs` + `fixtures-coach-roster.sql` + teardown, **25 checks**, in the
nightly sweep. Both constraints this entry named held: the teardown is scoped by CLASS across
every month — wider than the `(class, month)` §7.132 asks for, because a lesson at `today - 7`
straddles two months near the 1st — and the fixture builds two NON-admin coaches (§7.131). Two more were found by
measuring its sabotage signature, and both had it scoring full marks over broken code —
**§7.140**. The walk is wider than the manual one: it also covers the new guard's two server
branches through a stale-tab race (§7.139) and the substitute actually marking the lesson,
guest included.

Original entry:
`verify-coach-roster.mjs` + `fixtures-coach-roster.sql` + teardown. Wave 3's behaviour is
covered by 40 pgTAP checks, 40 vitest and 40 jest tests and a manual UI walk, and by **nothing
in the nightly sweep**.

**Why:** every other shipped surface has a driver, so the sweep is the standing answer to "did
a change three weeks from now break this?" Wave 3 is the one feature that would fail silently
— and it is the feature whose failure mode is an unmarkable guest and a billing month that
will not close, which no unit test can reach because it needs the real RLS path in a browser.

**Notes:** a driver needs no schema change, so it waits on no migration. Two constraints, both bought the hard way: the **teardown must be scoped
`(class, month)`, not by id** (§7.132 — `assign_session_coach()` creates lesson rows the
fixture never named, and `check-fixture-roundtrip.sh` cannot catch the orphans because the
driver creates them); and the fixture needs a **non-admin** coach, because the seed coach is
also the tenant admin and no narrowing can be demonstrated on him (§7.131). The walk to
automate is in `docs/plans/WAVE_3_PLAN.md` Step 4, and the manual version already passed:
owner 7/7, trainee 5/5, substitute 12/12.

### ~~`Clear` can leave a lesson unmarkable AND un-nagged~~ — **SUPERSEDED 2026-08-12**
Not fixed — made unbuildable. `20260812000200` moved shadows off the lesson entirely: a shadow
is now a dated assignment to the whole CLASS, so `Clear`, which removes a *lesson's* substitute,
has no shadow row left to strand. The remaining route in — the class's own coach also being one
of its shadows — is refused by `assign_class_shadow()`, by `trg_class_shadow_guard` on the table
itself, and by `set_class_terms()` in the other direction. PRD §7.13, §7.6.

**What the fix would have cost, for the record:** the filed version was an RPC that refused
`Clear` while such a shadow existed, and it would have had to keep working for every future path
that could create the state. Removing the state removed the guard too — `20260812000100`, one day
old, was deleted whole along with its 16 pgTAP checks.

### ~~The Attendance page's Coach column can name someone who did not teach~~ — **SHIPPED 2026-08-14**
The read-only Attendance audit page now attributes each lesson on the **MONEY axis** — who was
paid, never `classes.coach_id` — so a class handed over no longer names the new coach on the
outgoing coach's lessons. The resolution lives once in `SwimSyncAdmin/lib/lessonAttribution.ts`
(`attributeLessons()` mirrors `coach_attribution_kind()`: substitute → `class_rate_on()` terms
→ shadow), and `wages/page.tsx` now shares its `resolveShadows()` so there is no longer a second
client copy of the shadow arm. The column names who taught, an amber `Cover` chip when a
substitute is named, and `+ Name (shadow)` on a second line; the filter/sort are re-keyed to
coach **ids**. The plan and every risk mitigation are in `docs/plans/SMALL_ITEMS_PLAN.md` §B2/§B6;
the axis trap is **§7.152**. Browser-verified with a seeded handover + substitute + shadow (8/8).

### ~~A set-returning gate for the coach's roster probes~~ — **SHIPPED 2026-08-12**
`sessions_i_am_main_on(uuid[]) RETURNS SETOF uuid`, in the same migration as the guard above
exactly as this entry asked. Its body is `coach_is_main_on_session()` and nothing else — two
copies of "who is main" is the bug §7.129 already charged this wave for. `SwimSyncApp` consumes
it; `CHUNK = 8` is gone. **It was not the cheap change it looks like**: the caller subtracts
the answer from what it asked, so the fail-loud direction INVERTS when a per-item probe becomes
a batch, and every short or reshaped response now hides a lesson that needs marking. **§7.138.**

Original entry:
`sessions_i_am_main_on(uuid[]) RETURNS SETOF uuid` would collapse the coach app's per-session
`coach_is_main_on_session()` calls into one round trip.

**Why:** §7.134 forces a `SECURITY DEFINER` probe per session, because RLS hides the row that
would answer the question. The Schedule tab bounds the set (own classes, session row exists,
not finished) so a month of history costs nothing today — this is latency insurance, not a
fix.

**Notes:** not written by the worktree that wanted it, because **a worktree never authors a
migration** and the bounded loop is correct as it stands. Do it in the same migration as the
`assign_session_coach` guard above rather than on its own.


---

## Billing and payments

### ~~A PayNow ID can be saved that no QR can be built from~~ — **S** — **DONE 2026-08-18** (§8.68)
_Advisory warning at the admin save for the mobile-shape case (`SwimSyncAdmin/lib/paynow.ts`,
mirroring `buildPayNowPayload`). The UEN "wrong-yet-valid" half remains uncatchable by design
(no checksum), as the notes below predicted; the dry-run reduces to the mobile check because
that is the only thing the real builder validates on a stored proxy. Advisory only, no DB CHECK._
Tell the admin, at save time, that the PayNow UEN or mobile they just entered cannot be
encoded — instead of letting them find out from a parent who could not pay.

**Why:** `paynow_uen` is stored **completely raw** (`invoices/page.tsx` uses
`blankToNull(raw)` and nothing else), and `paynow_mobile` goes through
`normalizeSgPhone`, which only **strips non-digits** — `checkSgPhone` is advisory and
"never blocks", and there is no DB `CHECK` (`20260802000600:44-47`, deliberately, so a
blocked save cannot strand anyone). So `912345678` — nine digits, one typo — saves
cleanly and looks configured on every screen, while `buildPayNowPayload` throws on
`!/^\d{8}$/` and no parent at that business ever sees a dynamic QR. Today the damage is
bounded: `verify-paynow-fallback.mjs` pins that the parent still gets a payable PayNow ID
+ amount + reference, and the coach can still upload a fallback image. But **nobody is
ever told the QR is broken**, so the business quietly collects nothing through the
mechanism it thinks it configured.

**Notes:** the UEN half is worse than the mobile half — a garbage UEN produces a
*valid-looking* QR that pays nowhere, which is `lib/paynow.ts`'s "wrong-yet-valid" RISK 2
case, and no amount of advisory phone checking touches it. **The right shape is almost
certainly a dry run, not a validator**: call `buildPayNowPayload()` with a $1 amount and
the entered proxy at save time and show a warning if it throws — that reuses the one
authority instead of adding a second copy of the rule (§7.18). Keep it **advisory**: the
sgPhone doctrine is deliberate and a blocked save helps nobody. Ideally show the admin
the QR that would be generated, which makes the failure self-evident. Do **not** add a DB
`CHECK`. Raised while building Wave 1 Chunk 2, where this was explicitly out of scope.

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

### ~~Parent referral codes — double-sided package discount — **M**~~ `[SHIPPED 2026-08-15, §8.61]`
Built exactly as planned (`docs/plans/REFERRAL_PLAN.md`): `REF-XXXXX` per membership doubling as
a join code, friend's first-package discount + referrer's later-package reward (FIFO queue,
tenant-wide expiry on the referrer's), tenant %/$ default + per-product override (`0` = opt-out),
admin Referrals page (grant/void/disable), same-household guard, referrer earn-email. First price
modifier in the system — changes `amount_payable`, never `total_value`. **LIVE on prod 2026-08-15**
(`docs/DEPLOYMENT.md` §11.23), DORMANT until a business enables it. Two follow-ups filed below: the
"your reward expires soon" nudge and any unprompted low-balance email (both cron-gated).

### The UNPROMPTED parent low-balance nudge — **S**
Automatically email/notify the parent when their package runs low or nears expiry, WITHOUT
the admin sending a renewal offer.

**Why:** the admin-triggered renewal offer now exists (PRD §7.16, its own email), but it is
worked by hand. This is the parent-side, no-admin-action version. **Notes:** all the pieces
exist — `package_renewal_candidates()` is the "who", `package-emails` the delivery — so it
is a scheduled check away, gated on cron (same blocker as the invoice reminder chain).

### Bound `recompute_package_extensions` — **S** `[found 2026-08-15]`
`recompute_package_extensions` loops every `status='active'` package on each Packages/Billing
page load. Status never flips at expiry, so the set grows unboundedly over years.

**Why:** a per-load full scan is fine at a few dozen packages, a problem at thousands.
**Notes:** bounding it (skip packages whose effective end is > N months past) is safe **only**
if a late-added holiday inside an old nominal window can still resurrect an expired package —
verify that assumption before adding the bound. (Fable review #9, deferred from the weeks work.)

### In-app package refunds — **S**
Record a refund against a cancelled package instead of settling fully offline.

**Why:** cancellation freezes the remaining value and shows it, but the money movement
lives outside SwimSync — fine at one tenant, unauditable at ten. **Notes:** the
commercial convention discussed 2026-07-20: refund = paid − (lessons taken × walk-in
rate), i.e. claw back the volume discount on lessons actually used; don't apportion
"bonus vs cash".

### Household-level split billing — **M** `[MVP-excluded]`
Let two parents (e.g. separated households) each receive a share of the invoice.

**Why:** requested often enough in family-facing products to be worth recording. Today
one invoice goes to one parent account, and any splitting happens between the parents
off-platform.

**Notes:** the data model is closer to ready than it looks — `parent_students` is
already **many-to-many**, so a student can have two parents. What's missing is a split
rule and a decision about which parent's credit balance a correction lands in. Credit is
pooled **per parent** (`docs/ARCHITECTURE.md` §6), so splitting invoices without splitting credit
would produce a ledger nobody can explain.

### ~~Revenue reporting~~ — **ABSORBED 2026-08-08** into *An owner-only accounting page*
Tell a business what it actually earned in a month.

**Absorbed, not dropped.** The content is now the main half of *An owner-only accounting
page* (**Admin and operations**), which adds the one thing this item never said: **who is
allowed to see it**. That turned out to be the deciding question — it is the first concrete
thing a co-admin should not see, and it needs no capability model because
`is_tenant_owner()` already exists. Everything below still applies and is the reason the
accounting page carries a decide-first question.

**Deprioritised 2026-08-08**, and moved from *Unordered — no dependencies* to *Later*.
Raised as a build candidate one month into the live billing rhythm and declined by the
user — the question is real but not urgent while there is one business and one operator
who can read the invoice list directly. The move is also a correction: the item's own
notes say the accrual-vs-cash question must be settled **before any code**, which is a
dependency, so it never belonged under *no dependencies*. That decision is still the
first thing to settle if this is picked up.

**Why:** SwimSync has **no revenue ledger at all.** It tracks obligations (`invoices`),
whether they were settled (`status`/`paid_at`), and outgoings (`coach_payouts`) — but
nothing sums income. The only money aggregate in the whole admin panel is
`totalOutstanding` (`SwimSyncAdmin/app/(admin)/invoices/page.tsx:389`), which is money
*owed*, not money *received*. A coach asking "how did July go?" has to add it up by hand
from the invoice list, which is the same spreadsheet-rebuilt-monthly problem that coach
wages (§7.13) existed to close on the payroll side.

**Notes — decide this FIRST, before any code:** is revenue **accrual** (invoices issued
in the month) or **cash** (payments received in the month)? They diverge exactly when it
matters — an invoice generated on 7 Aug for July, paid 20 Aug, belongs to a different
month under each. Everything else follows from that answer.

Two sources must be summed once trial onboarding ships, not one:
`invoices` (paid) **plus** `student_settlements.amount` where `kind = 'paid_outside'` —
money taken for a trial by a walk-in whose parent never registered, which cannot ride the
invoice rails at all (`invoices.parent_id` and `payment_records.invoice_id` are both NOT
NULL). See `TRIAL_ONBOARDING_PLAN.md`.

**Do not ship a partial figure.** A revenue number that counts invoices but silently omits
settlements — or vice versa — is worse than no number, because it reads as authoritative.
That is precisely the mistake PRD §4.4 records about the platform pages, which showed
several businesses' figures added together and labelled as one; the fix there was to show
nothing rather than something wrong.

### `HANDOVER.md` §3 needs graduating — **S** `[docs]`
`HANDOVER.md` is **~1000 lines against its own ~700 target**, and §3 ("what works") is about
40% of it. The file has carried a note flagging this since 2026-07-26.

**Why:** `HANDOVER.md` is read in full at the start of every session, so every line is paid
repeatedly — and stale content that sits *next to* the right answer competes with it, which
is the exact failure §8.17 fixed for the rest of the file. Most §3 bullets restate behaviour
`PRD.md` already specifies in full.

**Notes:** the graduation is not "delete §3". What is load-bearing there and exists **nowhere
else** is (a) the **prohibitions** — *don't re-add an invoice count to the coach app*, *no
rate is the finished state*, *"clean slate" is a banned phrase*, *don't read a count out of
this paragraph* — and (b) the **verified-vs-specified** distinction, including every
*"dormant in the sense that matters"* qualifier, which records what has and has not been
exercised on real data. Keep those, point at the PRD for the rest. Three bullets were
graduated this way on 2026-08-10 (password reset, attendance marking, parent empty states) as
the pattern to copy. Do it in one pass rather than a bullet at a time, or the remainder reads
as arbitrary.

### ~~The admin's invoice pre-flight misses an unmarked EXTRA lesson~~ — **SHIPPED 2026-08-13**
`378d4aa`. Fixed on BOTH axes, not just the filed one. The filed half — union the class's
session dates so an off-pattern extra is seen — came with a second finding: the union had to
move **above** the `expected.length === 0` guard, or a class whose ONLY lesson that month was
an extra was dropped whole (a missing class, not a missing date). And the risk review found
the divergence ran on a class-status axis too: the dialog filtered `is_active` while the
engine does not, so a RETIRED class holding an unmarked lesson blocked generation and was
invisible to the dialog *and* to every screen that could clear it — §8.32's deadlock on a
visibility axis. The weekly expectation is now clamped at `deactivated_at` mirroring the
engine, while sessions that genuinely ran are still reported. Session dates are clamped to
`to`, which is **inert on any ENDED month** (the only kind the engine can bill) and suppresses
a false gap for a FUTURE covered lesson — `assign_session_coach()` creates a session row when
cover is arranged in advance. Counts are taken over dates a mark was actually owed on, so the
"{marked} of {expected}" line cannot inflate. vitest 326 (+9), proven red three ways.
`docs/plans/SMALL_ITEMS_PLAN.md` §B1.

Original entry:
`SwimSyncAdmin/lib/classCoverage.ts` and `generate-invoices/core.ts` are two copies of one
rule, and on 2026-08-10 they were brought into line in ONE direction only. The engine unions
`sessionByDate.keys()` into `datesToCheck` (`core.ts`); `classCoverage.ts` unions only
`bookedByDate.keys()`. So an unmarked **off-schedule extra lesson** (`schedule_extra_lesson`,
which sits off the class's weekday and therefore never appears in the weekday series) blocks
the engine while the admin's Generate-invoices dialog reports the month as complete.

**Why it matters:** the dialog is what the admin reads *before* pressing the button. Being
told "all marked" and then refused is the confusing half; the dangerous half is that the
dialog is also where the missing dates are NAMED, so the admin has no list to act on.

**Why it is S and not urgent:** it over-reports readiness, never under-bills — the engine's
block is unaffected and no money is lost. Found 2026-08-10 while fixing the divergence
running the other way (a guest-only class was named by the dialog and skipped by the engine).

**Notes:** the fix is one line in `classCoverage.ts` — union the session dates the caller
already fetches. Do it the next time anything opens that file, and add the case to
`SwimSyncAdmin`'s vitest coverage of `computeClassCoverage`. §7.18 is the standing reason
these two must not drift: hand-written copies of "who was expected here" caused a live
underbill.

### ~~Upcoming lessons view for parents~~ — **S** — **DONE 2026-08-17**
Shipped: an **Upcoming** section on the parent Attendance screen, derived from each active
enrolment's weekday over ~4 weeks (`lib/upcomingLessons.ts`), holidays subtracted. No sessions
pre-generated. PRD §7.5 describes it. Ad-hoc `lesson_session` cancellations are a named
follow-up (see below); the RISK 4 holiday exclusion is unit-tested.

<details><summary>Original item (kept for the reasoning)</summary>

Show parents the lessons that are scheduled next, not just the history of marked ones.

**Why:** parents currently see only what already happened. "When is my next lesson?" is
probably the single most common question the app *can't* answer, and it's the kind of
gap that makes an app feel like a billing tool rather than something you'd open weekly.

**Notes:** explicitly called out as **not provided** in PRD §7.5. The building block
already exists — expected lesson dates are derived at read time from
`classes.day_of_week` via `lib/lessonDates.ts`, which is exactly what the coach's
unmarked-lessons backlog uses. Point it at the future instead of the past. **This does
not require pre-generating sessions** — resist that; see `docs/ARCHITECTURE.md` §6.

</details>

**Follow-up (Wave D-ish):** the upcoming list reflects the schedule, not individual
`lesson_session` cancellations/reschedules — a lesson cancelled ahead of time still shows.
Higher fidelity means unioning `lesson_sessions` + bookings (`scheduleWeek.ts`'s
`lessonDatesInRange`) and cross-referencing status, as the coach forward-view does. Deferred:
holidays were the free 90%; ad-hoc cancellations are rarer and cost a join.

### ~~Pay and claim straight from the parent's invoice LIST~~ — **SHIPPED 2026-08-08** (PRD §7.21)
Both controls now sit on each outstanding card in `(parent)/billing`, matching the public
tokenized page the WhatsApp reminder links to. App-only: no migration, no new RPC — the
list select just had to start fetching `paid_claimed_at`, which only the detail screen
had been reading. `verify-parent-pay-claim.mjs` (16 checks) is the guard.

The claim's one-way rule held exactly as this item required: `claim_invoice_paid` writes
`paid_claimed_at` and nothing else, so a claimed invoice stays **outstanding** until the
coach confirms it against their bank. The driver asserts that explicitly.

**Two findings worth keeping, because both corrected a confident prediction:**

- **Nesting the buttons inside the card's touchable does NOT double-fire**, which is the
  opposite of what the plan review expected. The concern was real in shape —
  `confirmAction` is a blocking `window.confirm` on RN-web, so a bubbled press would run
  the RPC and *then* navigate, stranding the toast and the claimed line on a screen the
  parent had already left. It was tested by deliberately re-nesting them: still 16/16.
  React Native's responder system grants the responder to the innermost view and does not
  propagate to ancestor Touchables. The card is still laid out with the action row as a
  **sibling** of the touchable — it reads honestly and does not depend on that behaviour
  surviving an RN-web upgrade — but **do not repeat the double-fire claim as fact**, and
  do not cite the driver's "one dialog / no navigation" checks as the nesting guard; they
  cannot go red from nesting.
- **The detail screen's label is "Pay via PayNow QR" and the list's is "Pay via PayNow".**
  That difference is load-bearing for `verify-tenant-branding.mjs`, which used to match
  `/PayNow/i` and resolved to the right control only because the detail screen mounted
  later in DOM order (§7.10). It now targets the longer string, which only the detail
  screen can contain. Keep the two labels distinct.

### Child identification: NRIC last 4 — **S** — _considered and declined 2026-07-19_
Capture the last 4 characters of a child's NRIC as part of their identity.

**Status:** the problem this existed to solve — a coach with two students called "Ethan
Tan" picking the wrong one — **is solved**, using **name + date of birth** instead
(PRD §5.1). The stored `age` column is retired and age is derived. So this item is kept
only for its reasoning, not as work.

**Why NRIC was declined:** partial NRIC (last 3 digits + checksum) is **still personal
data** under PDPC guidance and its collection is restricted, so storing it needs a
standing justification — and it would put regulated data on every coach's roster, since
coaches can already read any student in their class. Date of birth was **already
collected and already required** by the add-child form, so it answers the same question
with no new personal data and no regulatory question at all.

**Revisit only if** a real collision proves DOB insufficient — two children of the same
name *and* the same birthday at one business. That has never happened, and the identity
index would refuse the second one loudly rather than silently confusing them.

### Maps integration — **S** `[MVP-excluded]`
Tap a class location to open it in Maps.

**Why:** small, cheap, and genuinely useful the first time a parent drives to a new
pool. `classes.location_address` is already captured and currently just renders as text.

**Notes:** deep link to the platform maps app; no new data needed.

---

## Notifications and reminders

### ~~Credit-note email notifications~~ — **SHIPPED 2026-08-17**
Built as the `credit-note-emails` edge function; see **PRD §7.8** for the behaviour and
`docs/plans/CREDIT_NOTE_EMAIL_PLAN.md` for the design.

**Neither mechanism this item proposed was used.** It named `pg_net` from the trigger or a
Supabase DB webhook; both were rejected. `pg_net` puts a network call inside a
`SECURITY DEFINER` trigger running in the attendance write's transaction — on the billing
path — and is cloud-only, so the whole send path would have shipped never having run
locally. A webhook is dashboard config rather than a migration: invisible to the repo and
untestable. The coach app calls a `verify_jwt`-ON function instead, re-checking the caller
against `attendance_write`'s own expression — the `package-emails` pattern that already
existed here and that this item never considered.

### Crash-safe email claim (eliminate the one-row claim window) — **S**
The shipped invoice retry (SHIPPED LIVE 2026-08-16 — PRD §7.7) uses the boolean
`invoice_email_sent_at` as BOTH the claim and the sent-marker: it claims one invoice, sends it,
resets on failure. A crash/timeout in the ~one-row window between claim and send silently drops
that single invoice's email.

**Credit notes now share the exposure** (`credit_notes.email_sent_at`, 2026-08-17) and it is
*sharper* there: the invoice path has an automatic retry pass on every generate-invoices run,
whereas the credit-note path has **only the admin Resend button** by decision — and a claimed
row renders as *emailed*, so Resend cannot reach it. A `try/finally` covers a thrown send; a
process kill does not. Fix both columns together; the design is one column, not two.

**Why:** email is best-effort, but a silent drop still means a parent never hears about a bill
or an adjustment. Today bounded to one in-flight row and low-volume, so low-priority.

**Notes:** eliminating the residual window needs a separate `claimed_at` column (or a per-scope
advisory lock) so a crash-safe send-then-stamp ordering is safe under concurrency — a boolean
column cannot be both claim and sent-marker. Design + why the per-invoice claim was chosen:
`docs/plans/INVOICE_EMAIL_RETRY_PLAN.md` (⚠ RISK 1).

### One-click bulk WhatsApp sends (Cloud API) — **M** `[Phase 3]`
Send the payment reminder to every unpaid parent with ONE click, server-side, instead
of one Send per chat via the wa.me click-through queue.

**Why:** the queue costs the admin one press of Send per parent (deliberate — that press
is WhatsApp's anti-spam boundary and the wa.me path cannot legitimately remove it). At
some roster size, or for tenants who want unattended sends, that stops being acceptable.

**Notes:** decided with the user 2026-08-02 (`docs/design/PAYMENT_COLLECTION_DESIGN.md`):
the only legitimate path is Meta's WhatsApp Business Platform (Cloud API) — utility
template messages to SG numbers at ≈S$0.02 each (≈S$1–5/month at 50–200 msgs), which the
user judged plausibly acceptable. The cost is friction, not money: a dedicated phone
number NOT registered on the consumer/Business app, Meta business setup, pre-approved
message template, and unverified accounts cap at 250 business-initiated conversations
per 24h (sufficient here; full verification lifts it). Sequence strictly after the
wa.me queue ships and only if a real tenant asks.

### Push notifications — **M** `[MVP-excluded]`
Native push to parents and coaches.

**Why:** the natural home for the reminders above, and for "attendance marked" /
"invoice ready."

**Notes:** **blocked on native store builds** — push doesn't work on the static web app
that's currently deployed, so this can't precede the platform item below. Note that
Notification Preferences buttons were **removed** from coach Settings and parent Profile
as dead stubs; `docs/ARCHITECTURE.md` §12 has the restore notes. Don't re-add the button until there's
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

### ~~Advance-cancel follow-ups~~ — **BOTH SETTLED, section closed** `[raised 2026-08-21 while shipping advance-cancel]`
Advance-cancel itself SHIPPED 2026-08-21 (PRD §7.6, §7.203/§7.204). Both follow-ups are now settled:

- ~~**What a cancel means for a PREPAID PACKAGE.**~~ **SHIPPED 2026-08-21** (`20260821000800`, PRD §7.6):
  a cancel extends the covering package by the tenant's `holiday_extension_days`, restore retracts it —
  the holiday twin, snapshotted at cancel time. Dormant on prod: 0 packages.
- ~~**Cancelling TODAY's lesson from the admin panel.**~~ **REFUSED 2026-08-22** with the user — moved to
  *Deliberately not doing*. Advance means advance: a lesson happening today or already past is the
  **coach's** call, marked `cancelled_rain`/`cancelled_coach`, and the admin can already set that same
  mark from the lesson page (§7.22). A second admin route to call off *today* duplicates the coach's path
  and buys nothing — the two surfaces would then have to agree on a lesson whose roster may already exist.
  The RPC's `p_date <= today_sg()` refusal stays as the guard; relaxing it is the one-line change if a real
  admin ever needs to call off a lesson that morning before the coach has touched it.

Cosmetic, not filed separately: the coach Schedule's collapsed COMING UP day summary still counts a
cancelled lesson in its "N lessons"; the card inside is struck.

### A location entity (venue) — **M** — **Later** (demoted 2026-08-22: production is one location) `[raised 2026-08-19 while building the admin calendar]`
Promote `classes.location_name` (free text) to a `locations` table the class references, so the
calendar, Lessons list and a future Maps link filter and group by a real venue.

**Why:** the calendar's Location filter (PRD §7.22) is built on *distinct `location_name` values*,
which works for one business at one pool but fragments the moment "Clementi" and "Clementi SC" both
exist. A multi-venue business (the OClass reference the user showed) wants columns per venue in the
day view, not a dropdown over strings.

**Notes:** the filter and the Maps item (`location_address`) are the two consumers; an expand/
contract migration (add table + FK, backfill from distinct names, keep the text column until both
apps read the FK). Per-venue columns in the day view are the UI half. Not urgent: production is one
location.

### An owner-only accounting page — **M** — _raised 2026-08-08, not a priority_
One page showing what the business actually earned and paid out — revenue, wages paid,
outstanding — **visible to the owner and not to co-admins**.

**Why:** raised by the user while deciding whether co-admin permissions need splitting. It
is the first concrete thing a co-admin should *not* see, and the reason the answer to
"split co-admin permissions" is *yes eventually, not now*.

**Notes:**

- **This needs NO capability model.** "Owner only" is already expressible —
  `tenants.owner_profile_id` and `is_tenant_owner()` shipped 2026-08-06. So this page can
  be built whenever it becomes a priority, and it does **not** wait on
  *Split co-admin permissions*. Recording that explicitly, because the two look coupled and
  are not.
- **This absorbs _Revenue reporting_** as its main content. Its decide-first question is
  **settled: ACCRUAL** (revenue = invoices *issued* that month), chosen with the user
  2026-08-16. It still inherits *do not ship a partial figure* — two sources must be summed,
  `invoices` issued that month **plus** `student_settlements.amount` where
  `kind = 'paid_outside'`.
- Wages paid out come from `coach_payouts`, which is already draft→frozen per period. The
  trainee-coach dependency is **discharged** — shadows ship two payout rows already
  (`20260812000200`), so the payroll half exists and this reads it rather than reinventing it.

### Split co-admin permissions — **M**
Restrict what individual co-admins can do — e.g. an assistant who can mark attendance and
chase payments but cannot change class pricing or issue credit notes.

**Why:** the user has said feature-splitting is coming ("I will only be splitting features
in the future"). Today every co-admin has the owner's full authority except admin
management, which is the right first cut but means an assistant hired to chase invoices
can also reprice every class.

**Notes:** parent/coach/admin are ONE database role, so grants can't do this — only RLS
resolution or per-capability checks can (§8.29's structural finding). The seam is
`is_tenant_admin()`/`is_tenant_owner()` in `20260806000100`: a permissions model slots in
as either more owner-style columns (cheap, coarse) or a `tenant_members`-style capability
table (the additive path the shipped design deliberately left open —
`docs/ARCHITECTURE.md` §6). Don't add enum roles for this (same reasoning as the owner
column: permanent, string-audited everywhere, can't express one-owner-per-tenant).

### The family-status search scans every membership client-side — **S**
`handleFamilySearch` on the Platform page fetches **all** `parent_tenants` rows and filters
in the browser.

**Why:** PostgREST caps every response at `max_rows = 1000` (`config.toml`) and does so
**silently** — no error, just fewer rows. So the search quietly stops finding families once
the platform passes a thousand memberships, and the failure looks like "that family isn't on
SwimSync" rather than like a bug. It is the same ceiling `platform_tenant_overview()` was
added to avoid; this is the one client-side scan left on that page.

**Notes:** found 2026-07-19 while rebuilding the page around the RPC. Deliberately left
working rather than extended — the fix is a server-side search (an RPC taking the query
string, or a `.ilike` filter pushed into the query instead of `.filter()` in JS), which is
its own piece of work. Harmless at today's scale; the reason to record it is that the failure
mode is invisible.

### Moving a student between businesses leaves two loose ends — **S**
`reassign_student_tenant()` moves the student but not everything attached to them.

**Why:** the platform admin's student-rescue tool (PRD §4.4) is the remedy when a parent
joins with the wrong join code — so it runs at exactly the moment a family is confused,
and it currently leaves them in a state nobody is told about.

**Notes:** found 2026-07-19 while auditing the money paths; **not a data-loss bug**, but
both ends are silent, which is the problem.

- **The parent is never joined to the new business.** The RPC updates
  `students.tenant_id` and closes enrolments, but writes no `parent_tenants` row — and
  that row is what the add-child picker and the parent's billing grouping rely on. The
  child lives at tenant B while the parent has no membership there.
- **Credit is stranded, silently.** Balances are per `(parent, tenant)`. If the family
  held credit at A and their only child leaves, it becomes unspendable. That is *correct*
  by the never-crosses-businesses rule (PRD §5.6) — the failure is that nothing warns the
  admin before the move.

**This is for the mistake case only.** A genuine migration between businesses is a
different flow and needs no code: the old business marks the family inactive, the new one
gives them its join code, and the child is added there as a new record. History stays with
the business that taught it, which is the isolation working correctly. Don't conflate the
two by making the rescue tool "move everything".

### ~~Export to Excel / CSV~~ — **S** — **DONE 2026-08-17**
Shipped all three at once (invoices, credit notes, attendance), not invoices-only as the
item proposed — the serialisation was shared, so the incremental cost of the other two was
near zero. Each admin table has an **Export CSV** button (`lib/csv.ts` + per-page columns);
PRD §14 *(Superadmin Panel)* describes the behaviour. Two safeguards hardened by
`/plan-review` are the durable part: a **formula-injection guard** (a parent-entered name
like `=HYPERLINK(...)` is neutralised with a leading apostrophe — quoting alone does NOT stop
Excel evaluating it), and a **cap-block** that refuses to emit when the source fetch was
truncated (keyed on the unfiltered fetch count, not the filtered view — a client filter that
shrinks a capped 1000 rows to 50 does not make the export complete). Excel unit is dollars,
exported raw for summing; UTF-8 BOM for unicode names. Both safeguards graduate to §7.

### Better filtering and search — **S** `[Phase 2]`
Search across the admin tables, and per-table filters beyond Attendance.

**Why:** fine at 17 students, painful at 100. Filing this as a scale problem, not a
today problem.

**Notes:** **partly shipped 2026-07-26** — every column on all 22 tables is now sortable
and Attendance gained class and date-range filters (PRD §14.3, §14.4). What remains is
*search*, and filters on the other tables. The sorting rules live in
`SwimSyncAdmin/lib/tableSort.ts`; reuse them rather than writing a second comparison — the
hard-won parts are that blanks stay last in **both** directions, that sorting is
numeric-aware, and that columns sort by what is **on screen** rather than what the row
stores. Attendance's filter deliberately keys on class **id, not title**, because two
classes can share a name.

### ~~More polished dashboards~~ — **RETIRED 2026-08-16** `[Phase 2]`
Richer metrics on the admin dashboard. **Retired with the user 2026-08-16** — the item's own
standing instruction was "delete if a real question ever replaces it", and none has. No
specific pain behind it. Moved to *Deliberately not doing*; the concrete money question
("how much am I owed / did I earn?") is served by *An owner-only accounting page* instead.

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

### Check the logo for brand collisions — **S**
Search existing swim-school, swim-club and fitness marks for anything close to the pace
clock, before it is on a storefront.

**Why:** the mark now ships in both apps and on `swimsync.sg`, and it has **never been
checked against anything that already exists**. A collision is cheap to fix now and
expensive after a store listing, printed flyers, or a coach's shirts — and a store
submission is exactly where a trademark complaint surfaces. Blocks nothing today; it
just gets more expensive the longer it waits.

**Notes:** this is a search job, not a drawing job — no design work unless it turns
something up. Circle-with-a-hand shapes are common in timer and stopwatch iconography,
so check *swim/fitness* brands specifically rather than generic icon sets. Do it before
**Native store builds** above, since that is the moment it bites. Related loose end: the
wordmark in the lockup is a **placeholder system font stack**, not a chosen typeface —
worth settling in the same pass. Geometry and rationale are in `brand/README.md`;
HANDOVER §8.2.

### ~~Multiple coaches per class~~ — **SUPERSEDED 2026-08-08**
Replaced by two lesson-level items in *Coach workflow*: *A lesson can have a substitute
coach, temporarily* and *Trainee coaches shadow the main coach on a lesson*.

The item's own note asked the right question — *"if the real need is 'someone else covers
this week', that's a session-level concern, not a class-level one"* — and the answer, from
the user on 2026-08-08, is that **both** real needs are session-level: a temporary
substitute, and trainees shadowing. A class-level join table would have expressed neither
and would have been rebuilt.

### ~~Multi-language support~~ — **REFUSED 2026-08-16** `[MVP-excluded]`
Beyond English. **Refused with the user 2026-08-16:** low value for the customer base being
sought, English-only is enough, and it was accruing retrofit tax unranked. Moved to
*Deliberately not doing*. **Revisit trigger:** Mandarin for grandparents doing pickup, if a
real tenant asks — that is the one honest reason, and nobody has.

---

## Foundations and engineering debt

These aren't features; they're the things that will make future features cost more, or
that are quietly waiting to break something.

### ~~Deleting an admin destroys the audit history~~ — **SHIPPED 2026-08-13** (`20260813000400`)
**Resolved by REFUSING the delete, not by a tombstone table.** `audit_log.actor_id` was the
single deliberate exclusion in `profile_reference_columns()`; every other FK pointing at
profiles already refused the delete by name. Removing the exclusion stops exempting one table
from the mechanism that already existed, and the purge is gone — it had become unreachable.
`actor_id` stays `NOT NULL`: the prohibition below held (§7.50).

**The accepted consequence, chosen with the user:** an admin who has written any audit row can
no longer be hard-deleted at all. Deactivation is the route, and their profile, auth user and
**email address** are occupied permanently. The trade is that the record outlives the person.
The `deleted_profiles` tombstone stays the upgrade path if hard delete is ever needed back.
The production gate was checked before landing: all three tenant admins are their own tenant's
OWNER, and an owner was already undeletable, so the change took nothing away from anyone.

**The finding worth carrying, because it nearly shipped as a non-event:** both suites covering
admin deletion exercised only a profile that had never acted — pgTAP seeded an audit row purely
to watch it be purged, and `verify-admins.mjs` deletes a fixture that is never an actor. The
change would have passed both while proving nothing about the product. A new `adminhistory@`
persona now drives the refusal in a real browser, including the half pgTAP cannot see: that the
route's compensating unban leaves the account **able to sign in**, since it bans *before* it
calls the RPC. pgTAP 925, driver 24/24, both proven red. `docs/plans/SMALL_ITEMS_PLAN.md`
Phase A.

Original entry:
`prepare_admin_delete()` **purges the target's `audit_log` rows** before the hard delete,
because `audit_log.actor_id` is a `NOT NULL` FK with no cascade
(`20260806000100_co_admins.sql:56`). So removing a departing admin erases every record of
what they did.

**Why:** as of `20260809000200` every edit to a student is recorded — including
`provisional_contact_phone` and `_email`, the top two ranked signals in
`find_student_candidates()`, which decide **which parent is offered which child**. The
dispute that trail exists for is "who changed the number, and when", and the person most
likely to be at the centre of it is an admin who has since left. The purge deletes exactly
the evidence, and the typed-DELETE confirm says so — so this is a known, disclosed hole,
not a silent one.

**Notes:**
- **Do NOT make `actor_id` nullable to solve it.** It is depended on elsewhere and §7.50 is
  the reason it is `NOT NULL`. `20260809000200`'s header carries the same prohibition for
  the same column.
- The shapes worth weighing: a `deleted_profiles` tombstone table the FK can point at; or
  `ON DELETE SET NULL` plus a denormalised actor label captured at write time (which
  survives the delete and is what a reader actually wants to see); or refusing the hard
  delete once the admin has audit rows, which `prepare_admin_delete()` already does for
  *recorded work* and would merely extend.
- This is a **retention** decision before it is a schema one — how long the trail is meant
  to outlive the person. Settle that with the user first; every option above is cheap once
  it is answered.

### `fixtures-trial-onboarding-teardown.sql` deletes invoices it does not own — **S**
Its cleanup is `DELETE FROM invoice_items … WHERE i.tenant_id = v_tenant AND
i.billing_month = <its month>` — every invoice in the tenant for that month, not just the
ones it created. Same for the `invoices` and `billing_periods` deletes beneath it.

**Why:** `check-fixture-roundtrip.sh` pass 2 exists to enforce "each fixture owns only its
own rows", and this one silently breaks that rule. It went unnoticed for as long as no
sibling put a row in those tables. On 2026-08-09
`fixtures-admin-table-geometry.sql` became the first fixture to hold a **credit note**
against an invoice item, and the over-broad `DELETE` immediately hit
`credit_notes_invoice_item_id_fkey` and failed the entire stacked unwind — six tables left
dirty, while every fixture still reported "loads fine". The next fixture to touch invoices
hits the same wall.

**Notes:** the new fixture worked around it by putting its invoice **four months back**,
which is a dodge, not a fix — the teardown is still wrong and the workaround is a comment
someone will delete. Scope the three deletes to the parent/class the fixture owns (it
already knows both). Do **not** widen `check-fixture-roundtrip.sh` to tolerate it. Proving
the fix is cheap: run the full round-trip, then move that fixture's billing month back to
last month and confirm the unwind still passes.

### ~~`/makeups` and `/trials` render a 79px DATE column~~ — **S** — **DONE 2026-08-18** (§8.68)
_Fixed the column classes as the note below directs: `whitespace-nowrap` on the Date `<Th>`/`<Td>`
in both pages. No width assertion added to the driver (per §7.71)._
Both pages squeeze their date column to 79px at a 1280px viewport, reported by
`verify-admin-table-geometry.mjs`'s width probe.

**Why:** narrow enough that a date wraps or truncates on the two screens where the date
*is* the information — a guest is expected at one lesson, on one day, and nowhere else.
Cosmetic today; it is filed because it was measured rather than guessed, and because
nothing else will notice it.

**Notes:** the geometry check reports width but deliberately does **not** assert on it
(§7.71) — a table whose columns all carry `w-full` renders one at ~110px while every
alignment and text assertion still passes, so width is a human-judgement signal, not a
pass/fail one. Do not "fix" this by adding a width assertion to the driver; fix the two
pages' column classes. The threshold in the driver is 80px and is arbitrary.

### Generate real Supabase `Database` types — **M** — _low priority, do last_
Give the supabase-js client a generated `Database` type (`supabase gen types typescript`
→ `createClient<Database>(...)`) so query results are typed from the real schema instead
of guessed from the select string, retiring the `any` casts scattered across every
screen that reads a nested join.

**Why:** today there is no `Database` generic anywhere, so supabase-js infers response
shapes from the select string alone and every nested embed is treated as an `any` — real
type safety across the app's ~11+ query sites is simply absent. With generated types, a
misspelled column, a dropped field, or a wrong status value is caught by the compiler
before it ships, everywhere, not just where someone remembered to be careful.

**Notes:** **deliberately ranked last, and only worth doing once the schema has stopped
changing** — the generated types are a *snapshot* that must be regenerated on every
migration, or they silently go stale and start lying, which is worse than no types. It's
an **M**, not an **S**: it touches every query site, and even with the generic in place
supabase-js still infers to-one embeds as arrays without `!inner`/`!hint` annotations, so
a few casts remain. This **supersedes and absorbs** the `any`-cast fix already applied in
`(parent)/home/child/[id].tsx` (shipped 2026-07-16, HANDOVER §8d) — that cast was the
pragmatic `S`-sized fix to clear the baseline now; this is the thorough version for later. Do **not**
start this while migrations are still landing (NRIC and coach-defined levels are still
schema-touching backlog items ahead of it). The natural trigger is "the schema is
frozen and we want compiler-enforced safety before a big build."

### Deeper component-render tests — **M** `[handover]`
RN screens with a mocked Supabase; admin table components.

**Why:** frontend tests currently cover `lib/**` pure functions only. The billing *maths*
is well covered (34 pgTAP + 8 Deno), but the screens where a coach actually loses money
by abandoning a task are covered only by hand-run Playwright drivers.

**Notes:** named in `docs/TESTING.md` §5 as "the natural next additions." The
`run-ui-playwright` drivers show what's worth pinning.

### Shared `lessonDates.ts` package — **M**
The file is duplicated **byte-identical** in both apps.

**Why:** filed for visibility, **not recommended**. `docs/ARCHITECTURE.md` §6 makes the case
deliberately: separate npm projects, no workspaces, different React majors, different
bundlers and test runners. Sharing ~120 lines of pure date maths would need workspace +
Metro `watchFolders` + `transpilePackages` surgery. The file has **zero imports**, so
drift is cheap to spot (`diff` the two), and each has its own test file.

**Notes:** the reason to revisit is if workspaces arrive for *another* reason — then
this comes along free. Until then: **edit both.** Recorded so the decision isn't
re-litigated from scratch every time someone notices the duplication.

### ~~Production data cleanup~~ — **S** — **DONE 2026-07-26**
The script was **run against production**. `Peter Zztest` — active, enrolled, and
positioned to block a real month from billing — is deleted. Production now holds
**9 students and 7 parents, all real**, with `attendance`, `lesson_sessions` and
`invoices` at **0**. HANDOVER §9 has the current state.

**Still outstanding, and small:** the **orphaned PayNow QR file** in Storage, which the
SQL script does not touch. Deliberately still excluded: `TestClass` (a class carries
effective-dated `class_rates`, and `trial_bookings.class_id` is `RESTRICT`) and the
`jj test` coach in **Epic Swim**, which is that business's data rather than ours.

The notes below are kept because **the reasoning outlived the task** — the next data
cleanup, on any environment, hits every one of these again.

**Notes — from the script that ran on 2026-07-26:**

- The script lives outside the repo (scratchpad), because a data-cleanup migration would
  re-run on every `db reset` and on any future environment. It deletes **12 students and
  5 parent accounts by exact name/email**, ends in `ROLLBACK` so the first run only shows
  its plan, and was rehearsed against a **restored copy** of the production data before
  being run for real: 21 → 9 students, 12 → 7 parents, attendance and sessions to 0, no
  survivor left parentless.
- **Never match test data by pattern.** `LIKE '%test%'` works today and deletes a real
  child called *Justin* later. Name them.
- **`audit_log.actor_id` blocks deleting a profile** — it is `NOT NULL` and `NO ACTION`,
  so it can be neither cascaded nor blanked. Audit rows *authored by* a doomed account
  must be deleted first; rows written by the real admin *about* a deleted child dangle
  harmlessly (`entity_id` has no FK) and should be kept.
- Deleting `auth.users` cascades `profiles → parents → parent_students`. It does **not**
  remove students — those belong to the business, not the account.
- Running it took production's `attendance` back to **0**, which made HANDOVER §9's "first
  attendance ever recorded" note false. **That note was rewritten, not deleted** — the loop
  *was* proven end to end on 2026-07-25 and then the evidence was tidied away, and today's
  zero must not be re-read as "the path has never been exercised."

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
| **Multi-language support** | Refused 2026-08-16 with the user: low value for the customer base being sought, English-only is enough, and it was accruing retrofit tax while sitting unranked. English-only was already an explicit MVP call (§8.1) and is a reasonable long-term answer for Singapore. **Revisit only if** a real tenant asks for Mandarin (grandparents doing pickup is the one honest trigger) — a "not yet", not a "never". |
| **More polished dashboards** | Retired 2026-08-16. Vaguest item in the backlog, no specific pain behind it, kept only because the PRD named it. Its own standing note was "delete if a real question replaces it", and none did. The concrete money question it gestured at is served by *An owner-only accounting page*. Revisit only if a specific metric someone actually asks for replaces "polish the dashboard". |
| **A blanket `anon` revoke via default privileges** | **Done 2026-08-04 (`20260804000400`) — this row is kept only so the two earlier refusals are not re-litigated as though nothing changed.** Declined 2026-07-21 and again earlier on 2026-08-04, both times on the grounds that it would lock a future function that legitimately needs `anon`. That objection had already expired on 2026-08-02, when `public-invoice` established the standing rule (`docs/ARCHITECTURE.md` §6) that anything public is served by an **edge function, never an anon RPC** — so the case being protected was one the architecture forbids. Doing it also revealed that the statement everyone had in mind (`… IN SCHEMA public REVOKE … FROM PUBLIC`) **succeeds and does nothing** (§7.85), meaning both refusals were declining something that would not have worked anyway. |
| **A `service_role` usage whitelist** (the `authenticated` treatment, `20260804000600`-style) | **Rejected 2026-08-14 after the 11-call-site audit; the one-liner that WAS worth doing shipped the same day (`20260814000300`, `docs/DEPLOYMENT.md` §11.20).** The `authenticated` argument does not transfer: there the oracle was "no policy could ever permit this", proving 50/148 grants dead — but `service_role` has `rolbypassrls` and no policies, so that oracle returns *everything*. A whitelist would have to come from **actual usage**, and the surface is too big to be worth it: `generate-invoices` alone reads 21 of 37 tables and writes 8, and the ~dozen a whitelist would exclude are all tables a future feature plausibly reaches from the engine or an admin route — with `permission denied` **inside the invoice engine** as the failure mode. The exposure is already bounded by the **secret key** (Vercel/Supabase env only, never a browser), and a whitelist would not defend the real worst case: a leaked key holding `auth.admin.deleteUser`/`updateUserById`, which are not table grants and no `GRANT` restrains. So: don't build the whitelist; the audit table (a 2026-08-10 snapshot, regenerate don't trust) is the input if it is ever revisited anyway. **Do not extend `table_grants.test.sql` to cover `service_role`** — it asserts "no privilege where no policy could permit", which `bypassrls` makes inexpressible (§7.87). |
| **Making the Students page's "All" tab mean active-only** | Considered 2026-07-26 so the header count would always equal the visible rows, and declined **with the user**: it would hide departed children from the default view and change behaviour people rely on. The header therefore deliberately describes a **subset** of the rows, and the `· N inactive` suffix is what explains the gap. **Do not "fix" the mismatch** — it is the honest reading. (`lib/studentCounts.ts`.) |
| **An "In progress" state on a class card while its lesson is running** | Offered 2026-07-26 while building the attendance-status chips and declined. A class shows **Upcoming** until its **end** time, because a coach marks at the end of a lesson — so one still running is not yet overdue and a fourth word for it buys nothing. The `Now` badge already says a class is happening. `hasEndedInSg()` is keyed to the end time deliberately; if this is revisited, that is the single place it changes. |
| **Pre-generating lesson sessions** (a scheduled session generator) | PRD §7.5 is knowingly unimplemented and should stay that way. Sessions are created lazily by the coach's attendance save; which lessons *should* have happened is derived at read time from `classes.day_of_week`. Pre-generation adds a job, a schedule, and a pile of edge cases when classes change — for no gain the read-time derivation doesn't already deliver. **Don't "fix" this** without a reason the derivation genuinely can't serve. (`docs/ARCHITECTURE.md` §6.) |
| **A parent-facing swimming-ability picker** | Removed on purpose (PRD §5.1). Parents self-reporting ability isn't information anyone trusted; the class a child is in is the real signal. If levels return they should be **coach-defined** — see the backlog item above. |
| **Re-adding Notification Preferences / Help & Support buttons** | Removed as dead stubs with empty handlers, not lost (`docs/ARCHITECTURE.md` §12). Build the feature first, then the button. |
| **`Alert.alert` for user feedback** | A **no-op on RN-web**, so it silently does nothing on the deployed app. Use `confirmAction` / the global Toast / inline form errors instead (`docs/ARCHITECTURE.md` §12a). The only sanctioned use left is the native-only media-library permission prompt. |
| **Invoicing a child immediately when they are set inactive** | Proposed as "settle up what they owe on the way out"; rejected 2026-07-18. Invoices are `UNIQUE(parent_id, billing_month)`, so an early partial-month invoice makes the regular run skip that parent via the `already_exists` guard — stranding their **siblings'** lessons for that month. That is exactly the multi-class underbilling bug the same session fixed, re-entered through a new door. It also breaks PRD §7.7's one-complete-calendar-month rule. The normal cycle already bills them correctly, because billing follows **attendance rows** rather than current enrolment (HANDOVER §8). |
| **An override on the completed-month guard** | Considered and refused 2026-07-19 while building it. Billing a month that has not ended is never legitimate: the attendance gate ignores lessons that have not happened yet, so a mid-month run reads as **complete**, bills what exists and **seals** the month — after which the rest of that month can never be billed (a sealed month is skipped; the `already_exists` guard skips the parent even if reopened). An override could therefore only ever produce that loss. Same reasoning as the attendance-block row below, and `force` was deliberately kept to its single meaning — skip the sealed-month guard — rather than growing a second one. If someone wants to bill mid-month, the answer is to wait, not to override. (`docs/GOTCHAS.md` §7.32, §8.6.) |
| **An override / "Generate anyway" on the attendance block** | Removed deliberately 2026-07-18 (PRD §7.7). The case it appeared to serve — a class that genuinely didn't run — is already handled *inside* the completeness rule by marking everyone `cancelled_rain`/`cancelled_coach`. So the bypass wasn't covering a legitimate case; it was letting an unrecorded lesson through into a **permanent** underbill, because a lesson can never be added to an invoice that already exists (§11.6). The escape hatch for a class that can't be completed is removing the student, not overriding the check. |
| ~~**A per-tenant invoice run day**~~ **— NOW BUILT (2026-07-19)** | Kept as a record of the reasoning, which held up. It was correctly refused while there was one business, and shipped as a per-tenant column the moment tenanting arrived, exactly as this row predicted ("trivial next to the RLS rewrite that happens anyway"). A useful example of deferring a small generalisation until the thing that needs it exists. |
| **Modelling level families and a progression graph** (Toddler/Beginner/Intermediate tiers, "T4 → B3" rules, milestone markers) | Considered 2026-07-19 from a real swim school's level table, and rejected by the user: **different schools and coaches have different ladders, and different mappings between them.** Modelling tiers and progression edges would bake one business's structure into the schema and make every other tenant bend to it — the opposite of what a per-tenant curriculum is for. The generic primitive already covers it: a school with 16 rungs across 5 tiers simply names them that way (`Toddler 1` … `Epic 2`) and orders them, and `tenant_levels.note` carries any progression rule *in that business's own words* ("Progress to B3 upon completing T4"). Free text is the right amount of structure here — human-readable, and no schema commitment to a shape only one customer has. Revisit only if something needs to *compute* over progression (auto-advancing a child, say), which nothing does. |
| ~~**Modelling substitute coaches**~~ **— REVERSED 2026-08-08, now a real item** | **Two things in the original refusal were wrong.** (1) *"The schema already supports it (`session_pay_overrides`)"* is **FALSE**: that table is `(lesson_session_id, pays_coach BOOLEAN, set_by, set_at)` — it can suppress a lesson's pay and cannot name another coach. (2) *"Revisit when a business has enough coaches to cover for each other"* — that is now; the user asked for it directly on 2026-08-08, including trainee coaches, and decided pay follows **whoever actually taught**. See *A lesson can have a substitute coach, temporarily* and *Trainee coaches shadow the main coach on a lesson* under **Coach workflow**. **The row's one durable finding survives and is why this is not a regression:** a PERMANENT handover is not this problem and already works through effective-dated class terms (`set_class_terms()` writes `class_rates.paid_coach_id` + `effective_from`). What had no representation was the one-off cover. |
| **Wiring anything to `tenants.kind`** | The column is an enum defaulting to `'private'` that **nothing sets, changes or reads** — the tenancy backfill hardcoded it in July 2026 and no screen, RPC or admin control has touched it since. It is reserved for future *pricing*, and §6 forbids it reaching an RLS policy. It briefly appeared as a "Type" column on the Platform page and was replaced 2026-07-19 with a **derived** shape (one coach who is also the admin = a private coach), because the stored value would have read "private" for an actual swim school and nobody would have noticed. **Don't display it, and don't branch on it** — if a business's shape matters, derive it. If pricing eventually needs a stored kind, give it a writer and a UI at the same time, or it will drift again. |
| **A browsable directory of coaches / schools for parents** | Considered as the way a parent picks their business, rejected 2026-07-19 in favour of **join codes** (PRD §5.1). A list publishes SwimSync's entire customer roster to every parent and every competing school; worse, a mis-tap puts a child on a stranger's roster where that business's admin can see and bill them, because nothing in the flow proves the family deals with them. **Possession of a code is that proof.** It also stops scaling at a few hundred tenants. If a discovery feature is ever wanted, make it search-by-exact-name so the full list is never enumerable. |
| **A "view as tenant" impersonation mode for the platform admin** | Rejected 2026-07-19 while building the platform page. It means scoping *every* admin screen to a chosen tenant rather than the caller's own — far larger than the support need, which is answered by a cross-tenant business list plus the ability to **move a student** between businesses (PRD §4.4). Revisit only if support actually gets stuck without it. |
| **Cross-tenant students** (one child taking lessons at two businesses) | Out of scope 2026-07-19. A student belongs to one business. *(The old wording added "and `one_active_enrolment_per_student` already enforces one active class" — that index was dropped by Wave 2 on 2026-08-11 and a child may now hold several enrolments. The tenant boundary is what makes this out of scope; the enrolment count never was.)* Note this **is** a real thing in Singapore, so this is a "not yet" rather than a "never" — but it touches enrolment, billing and the tenant boundary at once. Revisit on actual demand, not in anticipation. |
| **Platform billing (SwimSync charging the schools)** | Deliberately unbuilt 2026-07-19: the pilot is free. `tenants` is the natural billing subject when it arrives, so nothing in the current schema blocks it — but building it now would be a second money model with no payer. |
| **Putting the SwimSync mark on the invoice email** | Rejected 2026-07-19 while adding the logo. That header is the **tenant's** logo and business name by design (PRD §7.10): a parent pays their coach or school, and an invoice headed "SwimSync" reads as a platform bill — actively confusing for a family with children at two businesses. SwimSync is named in the footer as sender of record, and that is the whole of its billing there. The *recovery* email is a separate case and also stays wordmark-only: SVG does not render in most mail clients, and a hosted PNG adds a broken-image failure mode to the one message a locked-out user needs. (HANDOVER §8.2, `brand/README.md`.) |
| **A non-calendar wage cycle** (e.g. 16th–15th) | Wages assume **calendar months**, with only the *pay day* configurable (PRD §7.13). A different period boundary is a new period concept rather than a setting, and would need its own sealing and adjustment rules. Nobody has asked for it. |
| **Public self-service signup for businesses** (a "Start your business" page on the admin panel) | Considered 2026-07-21 while building tenant provisioning (PRD §4.4) and rejected in favour of platform-admin onboarding. With **no platform billing and no approval step**, an open signup form is an open door: spam tenants, unbounded free-tier growth, and — the real cost — every one of them mints a **join code**, which is the only proof a family deals with a business (§5.1). SwimSync onboards businesses one conversation at a time; the second one is a hand-onboarded school. Revisit when there is inbound demand *and* something gating it (payment, or manual approval before the tenant becomes joinable). |
| **Deleting a business from the admin panel** | Rejected 2026-07-21 with provisioning. A tenant deletion cascades into its families, students, invoices, credit notes and attendance — so a destructive button sitting on a support panel is a bigger risk than the mis-typed name it would fix, and the mistake it fixes is rare and cheap to correct in SQL. A **failed** provision already cleans up after itself (the route deletes the tenant if the invite fails), which covers the only case that happens automatically. An "only if the tenant is empty" variant was considered and judged not worth its own RPC, guard and tests. |
| **Sending the invite through Supabase Auth's own invite email** | Considered 2026-07-21 and rejected in favour of `generateLink({type:'invite'})` + our own Resend send. Supabase's path would need a `templates/invite.html` **pasted into the production dashboard**, where nothing in the repo can see it and no test can catch it drifting from the file — and resending to an already-invited user has uncertain semantics (it may 422 rather than re-send). Our own send makes the template code-owned and unit-tested, no-ops without `RESEND_API_KEY`, and makes Resend deterministic. Note the deliberate inversion of the invoice-email rule: an invoice email is best-effort because billing must not depend on delivery, whereas **the invite IS the deliverable**, so a failed send surfaces the link for the operator instead of being swallowed. |
| **Per-coach / per-tenant timezone (now)** | The invoice engine's billing timezone is a single configurable seam (`APP_TIMEZONE`, default `Asia/Singapore` — `generate-invoices/dates.ts`), and the frontend stays SG-hardcoded. Multi-timezone is a "don't-paint-into-a-corner" concern, **not near-term** (the user's explicit call). Don't build per-tenant TZ or generalize `lessonDates.ts` to multi-TZ before then — true multi-timezone folds into the **tenanted admin accounts** item when that lands. (HANDOVER §8a.) |
| **Typing `<Thead>`'s children so a `<Tr>` inside it fails typecheck** | Considered 2026-07-26 while fixing the Levels table (`docs/GOTCHAS.md` §7.54) and declined by the user in favour of a call-site scan test. It would be the stronger guard in principle — the mistake becomes unrepresentable rather than merely detected — but React's `children` typing does not express "only these element types" cleanly, so it needs casts or a wrapper at call sites, and it would put a fiddly type on the component that backs **all 14 admin tables**. `components/Table.test.tsx` catches the same mistake in CI, names the file and the exact fix, and risks nothing at runtime. Note the earlier failure this replaces: the previous attempt at prevention was a **docblock asserting the broken form was "unrepresentable"**, which it was not — the lesson is that the guard must be executable, not that it must be a type. |
| **Any invoice or payment count in the COACH app** | Settled with the user 2026-08-02 while removing the coach's Billing tab. The Today screen carried an "Outstanding" tile counting unpaid invoices across every parent the coach serves, and the obvious repair was to relabel it *Unpaid invoices* and make it tappable. The user rejected the whole category: **a coach does not need to know how many invoices are unpaid — that is an admin-app question.** Since fee-free payment collection shipped (PRD §7.21), everything that makes an invoice actionable — the `INV-YYYY-NNNN` reference, the dynamic QR, the WhatsApp queue, the "parent says paid" badge, the **Claimed** filter — lives on `admin.swimsync.sg`, so a number on the coach's phone can only ever prompt a decision the coach cannot act on well. It was also **not today-scoped and not lesson-shaped** while sitting between "Classes Today" and "Students Today", so it read as a fact about today's lessons. A private coach holds the tenant-admin role anyway and loses nothing. **Don't re-add a count, a badge or a filter here** (PRD §7.9; the prohibition is also a comment in `(coach)/schedule/index.tsx`). |
| **Individually disabling a PARENT account** | Considered and dropped 2026-07-19, restated when tenant suspension shipped (2026-08-13, the last of the disabling controls). Families leaving a business is handled by tenant-level active/inactive (`parent_tenants.is_active`), which is the actual common case — and a whole business going dark is tenant suspension (PRD §4.4). The only genuine platform-level trigger for a parent is a PDPA consent-withdrawal request — where "can't log in, records retained" is right, since IRAS requires ~5 years of financial records — and that has never happened. If it ever does, the mechanism staff disabling uses (auth ban + read-back) applies unchanged; parents are otherwise **never** auth-banned, because a parent is multi-tenant and a ban is account-level (WAVE_5_PLAN.md decision 5). |
| **Parent self-enrolment into classes** (a parent picks and joins a class themselves) | Refused 2026-08-21 with the user: **parents should not choose their own class.** Which lane a child belongs in is a coaching judgement — ability, age, temperament — not a parent's pick, and letting parents self-select would put children in the wrong class and undo the streaming the school does deliberately. The onboarding stall this was meant to cure (a new family waits for the admin to assign each child) is real, but the fix is to speed up the *admin* side, not to hand the decision to parents. Note this closes the door on parents *choosing*; a lighter **preference-at-signup that the admin approves** was not what was rejected and could still be revisited if the assignment queue ever genuinely hurts. The capacity/schedule/retired-class DB guards built for this (§8.75, 2026-08-20/21) stand on their own and lose nothing. |
| **Coach-assisted assignment workflow** (a coach assigns students to their own classes, not just the superadmin) | Refused 2026-08-21 with the user, alongside parent self-enrolment. **Class assignment stays a superadmin action** — the two candidate ways to remove the admin from the loop, letting the *parent* pick and letting the *coach* pick, were both rejected, so this is a deliberate single point of control, not an oversight. The onboarding bottleneck it named is real but is answered by better admin tooling, not by delegating the decision. This was previously "the only sanctioned route at this bottleneck" once parent self-enrol was refused; that framing is now void — neither route is sanctioned. Revisit only if a real second-coach tenant makes admin-only assignment genuinely painful, and even then the question is *coach-assisted* (coach proposes, admin confirms), not coach-authoritative. |
| **Cancelling TODAY's (or a past) lesson from the admin panel** | Refused 2026-08-22 with the user, closing the last advance-cancel follow-up. Advance-cancel is deliberately *advance only* — `cancel_lesson`'s `p_date <= today_sg()` refusal. A lesson happening today or already past is the **coach's** call, marked `cancelled_rain`/`cancelled_coach`, and the admin can already set that same mark from the lesson page (PRD §7.6, §7.22). A second admin route to call off today's lesson would duplicate the coach's path and buy nothing — worse, the two surfaces would then have to agree on a lesson whose roster may already exist. **Revisit only if** a real admin needs to call off a lesson *that morning, before the coach has touched it*; the one-line change is relaxing that date refusal, and it stays refused until someone actually asks. |
| **A CI gate on documentation size** (`scripts/check-doc-budget.sh` — byte budget on `HANDOVER.md`, line cap on `CLAUDE.md`, wired into `repo-invariants`) | Built, proven to fail correctly on a one-byte growth, and **reverted the same day** at the user's call (`cb70808` holds it; `6013082` removed it). The case *for* is strong and is recorded in **§7.119**: instruction alone has now failed twice, taking `HANDOVER.md` to 290 KB and then to 91 KB, and the repo already uses exactly this pattern for a rule that kept being forgotten (`check-teardowns.sh`, whose own header says *"A note in a document does not catch that; a failing build does."*). The case *against* won on two counts, both fair: **failing a build on a documentation byte-count is disproportionate** when the same push carries a billing fix, and the ratchet as built was seeded at the file's *exact* current size, so the next session's first legitimate §9 addition would have reddened CI with no headroom at all. What replaced it: the same limits as **countable rules** in `/update-docs` — ledger row ≤200 chars, ≤1 `_Previously,_`, ≤45,000 bytes — measured at the **start** of Step 5 rather than asked as a Final-check question, which is the specific failure the old rule had (five consecutive sessions answered it and waived it). **If `HANDOVER.md` regrows a third time, restore the script from `cb70808` rather than re-wording the rule a fourth time** — that escalation is written into `/update-docs`'s Final check, so it does not depend on anyone remembering this row. |
