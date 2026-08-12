# Class-level shadow coaches — a shadow belongs to the CLASS, not to one lesson

_Planned 2026-08-12 with `/plan-with-confidence`. Supersedes the `Clear` bug filed in
`BACKLOG.md` (found 2026-08-12) — that item is struck by this plan, not fixed by it._

**The one-sentence version:** a substitute stays a one-off on a single lesson; a shadow
becomes a dated assignment to a whole class, permanent until it is ended, paid at a new
shadow rate for every lesson that ran unless the main coach records them absent.

---

## Why this replaces the bug we set out to fix

The `Clear` bug is: the class's own coach holding a *shadow* row on a lesson with no main
is a contradictory state — `coach_is_main_on_session()` says they are the main (absence
rule), `lessonRole()` reads their shadow row and says they may not mark. The lesson leaves
NEEDS MARKING, the screen goes read-only, and unmarked attendance blocks the billing month
with no override (§8i) and nothing on any screen saying why.

Once a shadow is a property of the **class**, `Clear` — which removes a *lesson's*
substitute — has no per-lesson shadow row left to strand. **The state becomes unbuildable
rather than guarded.** The remaining route in (the class's coach also being one of its
shadows) collapses to one obviously-wrong row on one table, refused by one check on two
paths, instead of an invariant that must hold across every lesson.

That is the argument for doing this instead of the filed fix, and it is worth more than the
fix: `20260812000100` had to guard *two* ways a lesson can have a main, on the add path
only, and still left `Clear` open.

---

## The decisions this plan rests on (settled with the user, 2026-08-12)

| Decision | Answer | Consequence |
|---|---|---|
| Per-lesson shadow: keep or drop? | **Drop entirely** — class-level only | `session_coaches.role` disappears; `assign_session_coach()` loses its role argument (**§7.123 — signature change**) |
| What gets a shadow paid for a lesson? | **Every lesson that ran, minus recorded absences** | New `session_coach_absences`; no row means present, matching the roster's own absence-rule pattern |
| Who records the absence? | **The main coach, on the attendance screen** | The only person who knows, on a screen they must already visit. An admin-only exception list would never be filled in |
| Where does the admin manage shadows? | **The Classes page** | It is now a property of the class. Lesson Coaches becomes substitutes-only |
| What does a shadow see? | **The class's whole schedule while assigned; nothing once ended** | Visibility asks *"assigned today?"*; pay asks *"assigned on the lesson's date?"* — two questions, one dated record |
| Dated or undated assignment? | **Dated** (`effective_from` / `effective_to`) | Settled by consequence — see RISK 1. An undated row makes removal claw back all past pay |
| Backdating | **Allowed, unless that coach's payout for the month is `paid`** | The single most valuable decision here — see "What the seal rule buys" |
| Shadow rate | **A second rate per coach**, role-dimensioned on `coach_rates` | A coach can hold a shadow rate and a main rate, each effective-dated |
| No shadow rate configured? | **Refuse to run payroll**, naming coach + class + date | Matches the existing refusal for a lesson with no class terms in force |
| Promotion to main coach | **No promote button** — admin ends the shadow, then changes the main coach | Out-of-order is refused with a message; an *ended* assignment never blocks a handover |

---

## What the seal rule buys — read this before touching the wage engine

Forbidding backdating into a month whose payout is `paid` means **the payout builder's two
adjustment loops never need to learn about the ASSIGNMENT table.**

- *Adjustments B* (`20260811000200:783`) exists to pay someone newly-owed money for an
  already-settled month. If backdating cannot reach a settled month, the case cannot arise.
- *Adjustments A* (`:726`) exists to correct already-paid sessions. Because assignments
  carry dates, an August lesson keeps answering *"yes, T shadowed then"* for ever. The
  answer never changes, so there is nothing to adjust.

That machinery is the riskiest code in the wage engine — it is what double-paid during
Wave 3 (§7.129: Coach A 30.00 + Coach B 50.00 on one 50.00 lesson, found by hand before any
pgTAP existed). **Not touching it is the main risk reduction in this plan.** If a later
change makes backdating into a paid month legal, both loops come back into scope and this
paragraph is the reason why.

### ⚠ RISK 1 MITIGATION — THE ARGUMENT ABOVE IS TRUE OF THE ASSIGNMENT AND FALSE OF THE ABSENCE

The seal rule freezes `class_shadow_coaches`. It does **not** freeze
`session_coach_absences`, and an absence row is a *second* input to the same predicate. The
main coach can reach a past lesson for as long as `markable_floor()` allows — which is at
least the 1st of last month — so attendance for an already-`paid` month is editable by
design. Three consequences, all money, none of them visible on any screen:

- **A tick removed after the month is paid emits an unguarded clawback.** Adjustments A
  re-asks `session_pay_amount(session, coach)`, the absence row makes attribution FALSE,
  `v_now = 0`, and a negative adjustment lands on the current draft. Arguably right — but
  nothing in this plan decided it, and no guard bounds it.
- **A tick RESTORED after the month is paid pays nothing, for ever.** Adjustments A is
  driven `FROM coach_payout_items` and the shadow has no item for that lesson; Adjustments B
  is driven `FROM session_coaches` and a class shadow has no row there. Neither loop can
  ever visit that (coach, lesson) pair. **That is a permanent silent underpayment** — the
  exact failure the whole wages cluster exists to remove.
- **"Settled" means two different things.** This plan's guard tests
  `coach_payouts … coach_id = <this coach> AND status = 'paid'`. Adjustments B's own settled
  test (`:792-797`) has **no `coach_id` filter** — a month is settled if *any* coach in the
  tenant was paid for it. A shadow with no rate in August has no August payout row at all,
  so a per-coach seal happily lets an admin backdate into a month the engine considers
  closed, and nothing will ever pay them.

**Steps, not warnings:**

1. **Write the backdate guard against the TENANT, not the coach.** Refuse when
   `EXISTS (SELECT 1 FROM coach_payouts WHERE tenant_id = <tenant> AND status = 'paid'
   AND period_month >= to_char(<the date being set>, 'YYYY-MM'))`. Same shape as Adjustments
   B's test, deliberately, so the two definitions of "settled" cannot drift.
   **Do NOT narrow it to the coach being assigned** — the coach with no payout row is
   precisely the one the narrow form lets through.
2. **Refuse an absence write for a sealed month, in the same words.** Add the identical
   tenant-wide check to the absence insert/delete path (a `BEFORE INSERT OR DELETE` trigger
   on `session_coach_absences`, so no client path can miss it). A month whose payouts are
   paid is a month whose shadow attendance is frozen. **Do NOT add an override.**
3. **Extend Adjustments B's driving query anyway.** Union the class-shadow arm into its
   `FROM`, so that if the guard is ever relaxed the newly-owed case is already covered
   rather than silently absent. The `session_carried_for_coach()` helper already makes it
   emit-once; this is three lines and it removes the *permanent* failure mode entirely.
4. **pgTAP proves all three** — see Step 2 cases 13–15. Case 14 (restore a tick after the
   month is paid) is the one that would otherwise never be written, because nothing on any
   screen would show it failing.

---

## Schema

One migration, root checkout, `db/…` branch. One schema change in flight (§7.55).

### 1. `class_shadow_coaches` — the assignment

```
id             UUID PK
tenant_id      UUID NOT NULL  -- STAMPED by trigger, not derived in every policy
class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE
coach_id       UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE
effective_from DATE NOT NULL
effective_to   DATE NULL          -- NULL = still assigned
assigned_by    UUID REFERENCES profiles(id)
assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
ended_by       UUID REFERENCES profiles(id)
ended_at       TIMESTAMPTZ

CHECK (effective_to IS NULL OR effective_to >= effective_from)
UNIQUE (class_id, coach_id) WHERE effective_to IS NULL   -- one ACTIVE assignment
```

**Two date questions, deliberately two functions** — collapsing them is the mistake this
schema exists to make impossible:

- `coach_is_active_class_shadow(p_class_id)` — *am I assigned **today**?* Drives
  **visibility**. `SECURITY DEFINER`, reads `current_coach_id()`, and takes today from
  **`today_sg()`** (`20260727000100`) and nothing else.

  > **⚠ RISK 7 MITIGATION — `CURRENT_DATE` IS A RED TEST, NOT A STYLE PREFERENCE.**
  > `CURRENT_DATE` is the *session's* time zone, which is UTC on this server (§7.94), and
  > `20260806000200` does not "settle" a date at all — it calls `today_sg()`, as does
  > `20260807000100`, which shipped after class edits were refused for eight hours a day.
  > **`class_terms.test.sql` 16 asserts that NO function in `public` has `CURRENT_DATE` or
  > `now()::date` anywhere in its `prosrc`.** Writing either here turns that assertion red
  > for the whole suite, which is the structural mitigation — nothing depends on anyone
  > remembering. Same for `coach_shadowed_class_on()`: it takes the date as an argument and
  > must not read a clock at all.
- `coach_shadowed_class_on(p_class_id, p_date, p_coach_id)` — *was this coach assigned on
  that lesson's date?* Drives **pay**. Takes the coach as an argument, like
  `coach_attributed_to_session()` and for the same reason (§7.125: the caller at payroll
  time is the admin, not the coach).

The `tenant_id` stamp trigger must fire on **UPDATE as well as INSERT** — §7.57, and the
tenant must not survive a re-pointed `class_id`. Copy `session_coach_stamp_tenant()`.

> **Considered and not done:** an `EXCLUDE USING gist` constraint forbidding overlapping
> date ranges per (class, coach). It needs `btree_gist`, and overlap is harmless here —
> attribution is an `EXISTS`, so two overlapping rows cannot double-pay. The partial unique
> index above is what actually matters. Revisit only if history editing is ever added.

### 2. `session_coach_absences` — the exception, not the rule

```
lesson_session_id UUID NOT NULL REFERENCES lesson_sessions(id) ON DELETE CASCADE
coach_id          UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE
marked_by         UUID REFERENCES profiles(id)
marked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
PRIMARY KEY (lesson_session_id, coach_id)
```

**A row means the coach was NOT there.** No row means they were, and they are paid.

This direction is chosen, not incidental. It is the same shape as the roster's own safety
argument — *"no roster row means the class's coach is the main coach"* — and it gives three
properties the opposite direction does not:

1. **Forgetting does not silently underpay.** An overpayment appears as a line item on the
   Wages page and can be seen; an underpayment appears nowhere and is indistinguishable
   from "the coach wasn't there".
2. **Backdated assignment works with no extra code.** Past lessons that are already marked
   have no absence row, so they pay — which is exactly what backdating is for.
3. **A failed write is safe.** Attendance saves as a direct `.upsert()`, not an RPC
   (`attendance.tsx:586`), so absence rows are a *second* write that can fail on its own.
   Under default-paid, a failed write leaves the coach paid — the recoverable direction.

Only ever written for a **shadow**. The main coach marking the lesson is itself the proof
they were there, so an absence row for them is meaningless; nothing in the UI can create one
and pgTAP pins that.

> **⚠ RISK 9 MITIGATION — THIS TABLE NEEDS THE SAME TENANT TRIGGER ITS SIBLING GETS.**
> As drafted it carries no `tenant_id` and no cross-tenant check, while
> `class_shadow_coaches` copies `session_coach_stamp_tenant()`. That asymmetry is §7.125's
> shape: the write policy (`coach_is_main_on_session(lesson_session_id)`) says *who* may
> write, and nothing at all says the `coach_id` belongs to the same business as the lesson.
> **Add `tenant_id UUID NOT NULL` and a `BEFORE INSERT OR UPDATE` stamp trigger that raises
> when `coaches.tenant_id` differs from the lesson's class tenant** — the same body, the
> same reason, and it also makes the SELECT policy a column comparison instead of a
> `session_tenant()` call per row. **The trigger must fire on UPDATE too** (§7.57).
>
> **⚠ RISK 1 MITIGATION (cont.) — and the seal trigger from "What the seal rule buys"
> lives on this table too.** Insert and delete both.

### 3. `coach_rates` gains a role

```
CREATE TYPE coach_rate_role AS ENUM ('main', 'shadow');
ALTER TABLE coach_rates ADD COLUMN role coach_rate_role NOT NULL DEFAULT 'main';
-- UNIQUE (coach_id, effective_from) becomes UNIQUE (coach_id, role, effective_from)
```

Every existing row becomes a `main` rate. **Nothing existing changes behaviour on the day
the migration lands** — but that is only true until this same wave creates the first shadow
rate, which is the trap below.

A new `coach_rate_on(p_coach_id, p_date, p_role)` replaces the inline lookup at
`20260811000200:523`.

> **⚠ RISK 6 MITIGATION — ENUMERATE THE READERS FROM THE LIVE DATABASE, THEN FIX THE ONE
> THAT SILENTLY PICKS THE WRONG ROW.** The four live readers are
> `session_pay_amount(uuid,uuid)` (`20260811000200:522-526`), `generate_coach_payouts`'s
> on-payroll `EXISTS` (`:657`), **one** `platform_tenant_overview()` — whose live body is in
> `20260806000100:603`, not the three older migrations grep finds first (§7.115, and citing
> "three platform-overview functions" is that gotcha committed inside the plan that cites
> it) — and the Wages page at **two** sites, a read and a write.
>
> The read is the dangerous one and it is not role-blind:
> `wages/page.tsx:174` selects `coach_rates(amount, unit_minutes, effective_from)` and
> `:179-183` sorts **every** rate row by `effective_from` and takes `[0]` as "the rate in
> effect". The moment a coach gets a shadow rate dated later than their main rate, **the
> Wages page displays the trainee rate as that coach's rate**, and payroll pays something
> else. Steps:
>
> 1. **`.eq("coach_rates.role", "main")` on the existing embed**, in the same commit as the
>    migration — the page keeps meaning what it says today.
> 2. **`wages/page.tsx:376`'s `insert` must send `role` explicitly**, never rely on the
>    column default, or the shadow editor writes a second `main` rate and the two rows race
>    on `effective_from`.
> 3. **`generate_coach_payouts`'s on-payroll `EXISTS` stays role-blind, deliberately** — a
>    coach who holds only a shadow rate must still enter the loop, or their pay is skipped
>    in silence before any refusal can fire. Write that as a comment on the line.
> 4. **`SwimSyncAdmin/lib/payoutItems.ts` is not in this plan and must be.** Its
>    `SessionRosterRow.role` and its `LessonLineKind = "shadow"` both come from
>    `session_coaches.role`, which §4 below deletes. Left alone, a class shadow's payout line
>    falls through to `"ordinary"` ("the class's terms paid them, as always") or, when the
>    lesson also has a substitute, to `"reassigned"` — a clawback label on a positive
>    payment. Re-derive the `"shadow"` kind from `class_shadow_coaches` and cover it in
>    `payoutItems.test.ts`.

> **The class flat-rate override does not apply to a shadow.** `session_pay_amount()`
> already reasons that a flat class amount "is a property of the class's own coach teaching
> it", so a substitute falls through to their own rate. A shadow falls through for the same
> reason. Written as the condition, not as a comment.

### 4. `session_coaches` simplifies

With shadows gone it holds at most **one** row per lesson — the substitute.

- Drop the `role` column and the `session_coach_role` enum.
- `one_main_coach_per_session` (partial unique) becomes a plain `UNIQUE (lesson_session_id)`.
- `assign_session_coach(class, date, coach, role)` → **`assign_session_coach(class, date, coach)`**.
  This is a **§7.123 signature change**: `DROP FUNCTION` then `CREATE`, never
  `CREATE OR REPLACE` with a changed argument list, or PostgREST resolves the old
  `pg_proc` row by name (§7.124, measured in Wave 2).
- The entire shadow branch of `assign_session_coach()` and **all of `20260812000100`'s
  guard** disappear with it. So does `session_roster_guard.test.sql`.

> **⚠ Before touching the signature, run `grep -rn '\.rpc(' SwimSyncApp SwimSyncAdmin`** —
> the pattern is `\.rpc(`, **not** `supabase.rpc(`. Four call sites go through an injected
> client (`db.rpc`, `SwimSyncApp/lib/studentStatus.ts`) and the narrower pattern misses
> them (§7.142). HANDOVER §3 carries this prohibition because the enumeration has been wrong
> three times; the command is the fact, not any list.

> **⚠ RISK 2 MITIGATION — DROPPING `role` BREAKS FIVE LIVE FUNCTION BODIES AND POSTGRES WILL
> NOT STOP YOU.** A classic string-body function carries no column dependency, so
> `ALTER TABLE session_coaches DROP COLUMN role` succeeds in silence and every one of these
> throws `column sc.role does not exist` at **runtime**:
>
> | Function | Where `role` is | What breaks when it throws |
> |---|---|---|
> | `coach_is_main_on_session` | `:137` | `attendance_write` USING **and** WITH CHECK — **no coach in any business can save attendance**, and unmarked attendance blocks the billing month with no override (§8i) |
> | `coach_teaches_session` | `:120` | `sessions_select` and `attendance_select` — the read side of every coach screen |
> | `coach_attributed_to_session` | `:449` | the payout builder's selection query *and* `session_pay_amount` |
> | `session_pay_amount(uuid)` — the **one-arg** form | `:551` | the compat shim §7.123 left for the deployed client |
> | `set_session_main_coach` | `:404, :408` | every substitute assignment |
>
> The plan's access-gate table calls `coach_is_main_on_session` **"unchanged in meaning"**.
> That is true of its *meaning* and false of its *body*, and the sentence as written invites
> leaving the body alone. Rewrite it, and the other four, in the same migration.
>
> 1. **Enumerate mechanically, not from this table:**
>    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
>     WHERE n.nspname='public' AND p.prosrc ~ 'session_coaches';` — run it **before** writing
>    the migration and **again** after applying. The after-list must contain no `role`.
> 2. **Take every body from `pg_get_functiondef()`, never from `20260811000200`** (§7.115).
>    The line numbers above were true on 2026-08-12 and are a starting point, not the source:
>    `assign_session_coach()` has already been replaced once by `20260812000100`, and any of
>    these five can move the same way before this migration is written.
> 3. **Order matters:** `DROP FUNCTION assign_session_coach(uuid,date,uuid,session_coach_role)`
>    → rewrite the five bodies → `ALTER TABLE … DROP COLUMN role` → `DROP TYPE
>    session_coach_role`. The type drop fails while any function signature still names it,
>    and that failure is the useful one — do not work around it by leaving the type.
> 4. **Three client queries select the dead column too**, and each returns a PostgREST 400
>    rather than a type error: `schedule/index.tsx:392`, `attendance.tsx:333`,
>    `wages/page.tsx:267`. `npm run typecheck` cannot see any of them — grep
>    `grep -rn '"role"\|role:' ` across both apps' roster call sites instead.

> **⚠ RISK 3 MITIGATION — STEP 7's ORDER IS THE ORDER §7.123 SAYS IS WRONG FOR THIS CHANGE.**
> §7.123 is not a warning to be careful; it is a rule with two permitted resolutions, and
> this plan currently takes neither. The live admin panel calls
> `assign_session_coach(p_class_id, p_session_date, p_coach_id, p_role)` at
> `lesson-coaches/page.tsx:301`. Between `supabase db push` and the Vercel build of `main`,
> that call cannot resolve and **assigning any coach to any lesson is broken in
> production** — the same failure, on the same page family, as the one measured on
> 2026-08-11.
>
> **Take resolution (a): keep the 4-arg form as a shim.** The migration ends with
>
> ```
> CREATE OR REPLACE FUNCTION public.assign_session_coach(
>   p_class_id UUID, p_session_date DATE, p_coach_id UUID, p_role session_coach_role)
> RETURNS UUID … AS $$
>   -- Compat shim for the deployed admin panel across the §7.123 window. Removed
>   -- by the follow-up migration once Vercel has built main. 'shadow' is no
>   -- longer a lesson-level concept, so it is REFUSED loudly, never ignored.
> BEGIN
>   IF p_role <> 'main' THEN
>     RAISE EXCEPTION 'shadows are now assigned to the whole class — reload this page';
>   END IF;
>   RETURN assign_session_coach(p_class_id, p_session_date, p_coach_id);
> END; $$;
> ```
>
> - `session_coach_role` and the `role` column part company: the **type** survives the
>   window for the shim's argument list; the **column** goes in this migration.
> - **A separate follow-up migration drops the shim and the type**, filed in `BACKLOG.md`
>   before this one lands so it cannot be forgotten. One schema change in flight (§7.55) —
>   it is the next one, not a parallel one.
> - **`DROP` + `CREATE` does not carry a grant forward** the way `CREATE OR REPLACE` does
>   (§7.124's second bullet). The new `assign_session_coach(uuid,date,uuid)` needs its own
>   `REVOKE`/`GRANT` block, and so does every new function in this wave. Verify with
>   `has_function_privilege('authenticated', 'public.assign_session_coach(uuid,date,uuid)',
>   'EXECUTE')` in pgTAP, not by reading the migration.
> - **`\df assign_session_coach` must show exactly two rows** after the migration (shim +
>   new), and exactly one after the follow-up. Assert it; §7.124 exists because nobody did.

---

## Access gates — three functions widen, eight policies do not

The good news found while planning: **all eight of the policies Wave 3 widened key off
helper functions — not one reads `session_coaches` directly.** (Checked against
`20260811000200` §3: `sessions_select`, `attendance_select`, `attendance_write`,
`classes_select`, `enrolments_select`, `students_select`, `trial_bookings_select`,
`makeup_bookings_select`.) Extending the helpers means the policies themselves need no
rewrite, and the expensive RLS work is already paid.

| Function | Change |
|---|---|
| `coach_teaches_session(session)` | add `OR coach_is_active_class_shadow(class_of(session))`, **and** drop `role = 'main'` from its absence-rule arm |
| `coach_rostered_in_class(class)` | add `OR coach_is_active_class_shadow(class)`. **It does NOT become a direct lookup** — the substitute arm is still per-lesson and keeps its join through `lesson_sessions`. The new arm is cheap; the function is not simplified |
| `coach_rostered_with_student(student)` | add the shadow branch across all **three** of its arms (enrolled, trial guest, make-up guest). **Missing a guest branch is a billing deadlock, not a cosmetic gap** — the engine expects the guest, the block has no override, and no screen says why the month will not close |
| `coach_is_main_on_session(session)` | unchanged in **meaning**; its **body must still be rewritten** to drop `role = 'main'` — see RISK 2. A shadow still never marks |

> **⚠ RISK 5 MITIGATION — MAKE THE THIRD ARM STRUCTURALLY IMPOSSIBLE TO FORGET.** A reviewer
> reading three near-identical `EXISTS` blocks cannot tell a missing arm from a present one,
> which is how this gets shipped. **Extract the shadow test into a single
> `coach_shadows_class_of_student_via(p_student_id, p_class_id)`-shaped arm and write the
> function as one `UNION ALL` over the three booking sources**, so all three arms consume
> the same expression by construction. If that proves awkward, the fallback is vigilance and
> it must be said so out loud here.
>
> **The pgTAP assertion is a count, not three separate checks:** create one enrolled child,
> one trial guest and one make-up guest on a shadowed class and assert the shadow's
> `students` SELECT returns **exactly 3**. A per-arm test passes two-thirds of the way; a
> count does not. Prove it red by deleting **each** arm in turn (§7.25) — three sabotages,
> three recorded failures, not one.

New policies + **their own `GRANT`s** for both new tables (§7.87 — a policy without the
matching grant throws `permission denied` in dev, and `table_grants.test.sql` goes red on
any privilege no policy permits; **never** fix that with a blanket re-grant).

- `class_shadow_coaches`: SELECT = platform admin / tenant admin / `coach_id = current_coach_id()`. WRITE = tenant admin only.
- `session_coach_absences`: SELECT = same three. WRITE = tenant admin **or the lesson's main
  coach** (`coach_is_main_on_session(lesson_session_id)`), because the coach is the one
  ticking the box.

---

## Pay

**`coach_attributed_to_session(session, coach)` is the single predicate** both the selection
query and `session_pay_amount()` use, deliberately, so they can never disagree — that pair
is what makes a clawback work, and letting them drift is precisely §7.129. All three changes
go **there and nowhere else**:

```
   EXISTS (substitute row for this coach)
OR (NOT EXISTS (any substitute row) AND class terms paid them on that date)
OR ( coach_shadowed_class_on(class, session_date, coach)
     AND NOT EXISTS (absence row for this session + coach) )
```

Parenthesised deliberately: `AND` binds tighter than `OR`, so the unbracketed form happens
to parse correctly *today* and would stop doing so the moment a fourth arm is appended. The
absence test belongs to the **shadow arm only** — a substitute's presence is proved by them
marking the lesson.

`session_pay_amount(session, coach)` picks the rate by role: shadow rate when the
attribution came from a shadow assignment, main rate otherwise, class flat never for a
shadow.

> **⚠ RISK 4 MITIGATION — ONE COACH CAN SATISFY TWO ARMS AT ONCE, AND NOTHING HERE SAYS
> WHICH RATE WINS.** Nothing in the plan forbids assigning a class shadow as the one-off
> **substitute** on a lesson of that same class, and it is a real arrangement — "T shadows
> the class, and on the 12th T covers because the main coach is sick". Then arm 1 and arm 3
> are both true. `coach_attributed_to_session()` returns a bare BOOLEAN, so
> `session_pay_amount()` cannot ask it *which* arm matched and must re-derive the answer —
> **two places encoding one rule, which is §7.129 exactly, in the one function §7.129 was
> written about.** Worse: with an absence row also present, arm 1 still pays, and if the
> role check runs shadow-first the coach who actually taught is paid the trainee rate.
>
> 1. **Write the precedence down as a single ordered function**, not as two independent
>    tests: `coach_attribution_kind(session, coach) RETURNS TEXT` → `'substitute'` /
>    `'terms'` / `'shadow'` / `NULL`, evaluated in that order. **Substitute always beats
>    shadow.**
> 2. **`coach_attributed_to_session()` becomes
>    `coach_attribution_kind(...) IS NOT NULL`** — one body, so the predicate and the rate
>    choice cannot drift. Keep the existing name and signature; the payout builder's
>    selection query and its grant both reference it.
> 3. **`session_pay_amount()` branches on the returned kind**, never on a second
>    `coach_shadowed_class_on()` call.
> 4. **pgTAP case 16 is this exact coach**: class shadow *and* substitute on one lesson,
>    with three distinct amounts (main rate, shadow rate, class flat) so a wrong branch
>    cannot pass by coincidence — the shape that caught §7.129.

**Payroll pre-flight refusal**, in the same place and style as the existing "no class terms
in force" check (`20260811000200:636-650`), before the coach loop:

> a shadow coach has no shadow rate in force — refusing to run payroll rather than pay the
> wrong rate: <coach> on <class>, <date>

**Backdate guard**, inside `assign_class_shadow()` and `end_class_shadow()`: refuse when a
`coach_payouts` row exists **for the tenant** with `status = 'paid'` and
`period_month >= to_char(the date being set, 'YYYY-MM')` — tenant-wide, not per-coach, for
the reason given under RISK 1. Note this is the **payout** seal — not `billing_periods`,
which seals *parent invoicing* and is a different axis.

**The out-of-order handover guard**, in `set_class_terms()`: refuse to move `coach_id` to a
coach who holds an **active** shadow assignment on that class, with a message naming the fix.
It cannot fire for an assignment that has already ended, so history never blocks a handover.

> **⚠ RISK 4 MITIGATION (cont.) — `set_class_terms()` IS CALLED ON EVERY CLASS EDIT, NOT
> ONLY ON A HANDOVER.** A rename or a time change sends the *unchanged* `p_coach_id`
> through the same path. **Gate the new check on `p_coach_id IS DISTINCT FROM
> classes.coach_id`**, or one bad row makes the class permanently uneditable. Place it
> **before** the `UPDATE classes` at `20260807000100:105`, not after — the function returns
> early at `:122` when only money is unchanged, and a guard below that line never runs for a
> rename.
>
> `set_class_terms` keeps its exact 11-argument signature, so this is a plain
> `CREATE OR REPLACE` with **no** §7.123 exposure. Do not take the opportunity to change it.
> pgTAP: a rename of a class that *has* an active shadow must still succeed (case 10b) —
> that is the assertion that catches an ungated guard, and the handover-refusal test will
> pass with or without it.

---

## Steps

Each step ends verified. Nothing proceeds on a step whose tests have not been proven to fail
without the change (§7.25).

### Step 1 — The migration (root checkout, `db/…` branch, ONE file)

Everything above. Plus the **committed rollback file** written *before* the deploy
(`supabase/rollback/<ts>_class_shadow_coaches_DOWN.sql`) — a scratchpad backup nobody can
find is not a rollback plan. Rehearse it: every pre-change pgTAP check must pass under the
DOWN, and the DOWN's function bodies proven byte-identical to `pg_get_functiondef()` by diff
(§7.93).

**Read every function body from `pg_get_functiondef()`, never from the migration that first
created it** (§7.115) — `CREATE OR REPLACE` means the newest definition can be in any later
file, and grep finds the oldest first. That cost a wrong risk rating on 2026-08-10.

### Step 2 — pgTAP, proven red

New `supabase/tests/class_shadow_coaches.test.sql`. Rewrite the shadow half of
`session_coach_roster.test.sql`. **Delete `session_roster_guard.test.sql`** — its guard no
longer exists. Each new check proven red by *targeted* sabotage, not by dropping the whole
function.

The cases that carry the money:

1. A shadow is paid the **shadow** rate, not their main rate — three distinct amounts so a
   wrong argument cannot pass by coincidence (the shape that caught §7.129).
2. An absence row suppresses that lesson's shadow pay and **nothing else's**.
3. Ending an assignment **does not** change pay for lessons inside its date range.
4. Backdating into a `paid` month is refused; into a `draft` month it is allowed and pays.
5. A shadow **cannot** write attendance; the main coach's write is unaffected.
6. A shadow sees the class's lessons, students, trial guests and make-up guests — all three
   guest arms, because missing one is a silent billing deadlock.
7. Once ended, the shadow sees **none** of it — the user's explicit requirement.
8. …unless they are now the class's main coach.
9. The class's own coach cannot be given an active shadow assignment on that class.
10. `set_class_terms()` refuses a main-coach change onto an active shadow; accepts it once ended.
10b. A **rename** of a class that has an active shadow still succeeds — the guard is gated on
    a changing `coach_id` (RISK 4).
11. Payroll refuses when a shadow has no shadow rate in force.
12. `anon` holds EXECUTE on nothing new (grant dump, §7.82/§7.85), **and `authenticated`
    holds EXECUTE on every function this wave creates** — named by exact signature, because
    `DROP`+`CREATE` does not carry a grant (§7.124). A grant probe that names a signature
    that no longer exists **errors and aborts the whole file** with a bad plan, so grep the
    suite for `assign_session_coach(uuid,date,uuid,session_coach_role)` before dropping it.
13. **Backdating into a month sealed for ANOTHER coach is refused** — the shadow has no
    payout row of their own for that month, which is the case a per-coach seal lets through
    (RISK 1).
14. **A tick RESTORED after the month is `paid` is refused by the absence seal** — and, with
    the seal temporarily disabled, Adjustments B emits the owed amount exactly once. This is
    the permanent-underpay case; it is invisible on every screen and will not be written
    unless it is on this list.
15. **A tick REMOVED after the month is `paid` is refused by the same seal**, so no
    unguarded clawback can be produced by a coach editing attendance.
16. **A coach who is both the class shadow and the lesson's substitute is paid the
    SUBSTITUTE rate** — three distinct amounts, precedence asserted (RISK 4).
17. A shadow's payout line renders as `shadow` on the Wages page, not `ordinary` and not
    `reassigned` (vitest, `payoutItems.test.ts`).

### Step 3 — Admin panel

- **Classes page** — a Shadow coaches section: add (coach + start date), end an active one,
  and the past assignments listed with their date ranges. An inline note when the chosen
  coach has no shadow rate, so the payroll refusal is met *before* payroll.
- **Lesson Coaches page** — remove the Shadows column, the *Add shadow* action and
  `assignableShadows()`. Substitutes only. The page's header comment loses rule 3's shadow
  half and gains the new model in one line.
- **Wages page** — a second rate editor (main / shadow), the existing rate embed narrowed to
  `role = 'main'` and the existing `insert` sending `role` explicitly (RISK 6), and the
  payroll refusal rendered legibly rather than as a raw error.
- **`lib/payoutItems.ts`** — the `shadow` line kind re-derived from `class_shadow_coaches`
  instead of `session_coaches.role` (RISK 6). Not optional: without it a shadow's payment
  renders under a clawback label.

### Step 4 — Coach app

- `lib/coachRoster.ts` — `lessonRole()` gains a class-level `isClassShadow` **and keeps its
  per-lesson input**, which becomes a boolean `isSubstitute` rather than a `RosterRole`.
  It does **not** get simpler: three inputs become four. Keep the existing defensive case as
  an unreachable-state test.

  > **⚠ RISK 8 MITIGATION.** The draft claimed `lessonRole()` "loses the per-lesson
  > `assignment` input … it gets **simpler**, which is the tell that the model is right".
  > A substitute is still per-lesson, so the input cannot go, and a plan that expects the
  > function to shrink will make it shrink by dropping the substitute case. **Assert the
  > count instead of the shape:** `coachRoster.test.ts` has 4 `lessonRole` cases today and
  > must have **more** afterwards, never fewer. A dropped case is a dropped role.
  >
  > `parseAssignments()` rejects any row whose `role` is not `"main"|"shadow"`
  > (`coachRoster.ts:66`) and its jest cases feed `role` in explicitly — both must change
  > with the column, and neither is visible to `tsc`.

- **Schedule tab** — fetch active shadow classes; render their full schedule read-only with
  the existing *Shadowing* badge. A shadowed lesson must **never** enter NEEDS MARKING.

  > **⚠ RISK 8 MITIGATION — A SHADOWED CLASS TAKES A DIFFERENT DATE SOURCE FROM A COVERED
  > ONE, AND THE CURRENT CODE ENFORCES THE OPPOSITE.** `schedule/index.tsx:570-582` reads
  > `owned ? lessonDatesInRange(...) : rosteredHere.filter(...)`, and the comment above
  > `rosteredDatesByClass()` states the rule it exists for: *"a substitute must see the ONE
  > lesson they are covering, not the class's every Tuesday."* A class shadow is the exact
  > opposite — every Tuesday, and no per-lesson rows at all, so `rosteredHere` is **empty**
  > and the shadow sees nothing. The ternary must become
  > `owned || shadowedHere ? lessonDatesInRange(...) : rosteredHere.filter(...)`,
  > and the substitute branch must stay untouched. Write it as one named predicate
  > (`showsWholeSchedule`) rather than two `||`s at the call site.
  >
  > **RISK 10 is already closed structurally and must stay that way:** `probeIds` is pushed
  > only under `if (owned && …)` at `:636` and `:682`, so a shadowed class cannot enter the
  > covered-out probe set and cannot dilute the subtraction (§7.138). **Do NOT relax that
  > `owned &&` to `owned || shadowed` while widening the date source above** — they are two
  > different questions on adjacent lines. A comment on both sites saying so.

- **Attendance screen** — for the main coach, a *Coaches present* section under the students
  listing that lesson's shadows, **pre-ticked**; unticking writes an absence row. Renders
  nothing at all when the class has no shadows, so an untouched business gains no furniture.

  > **⚠ RISK 1 MITIGATION (cont.) — the absence write happens AFTER the attendance upsert
  > and uses `finalSessionId`.** The `lesson_sessions` row is created lazily inside
  > `handleSave()` (`attendance.tsx:574`), so an absence row written before it has no lesson
  > to reference. Order: resolve session → upsert attendance → write absences → audit log.
  > A failed absence write shows the Toast and leaves the coach **paid** (the recoverable
  > direction, RISK 6 in the original ranking) — `Alert.alert` is a no-op on RN-web, so it
  > must be the global Toast or an inline error, never an alert.

### Step 5 — `verify-coach-roster.mjs`

Rewrite for the new model; the substitute half survives largely intact. Its fixture needs a
**non-admin** coach (§7.131 — the seed coach is also the tenant admin, and no narrowing can
be demonstrated on them) and a teardown scoped **`(class, month)`, not by id** (§7.132 —
assignment creates lesson rows the fixture never named).

> **⚠ RISK 10 MITIGATION — THE FIXTURE PAIR IS IN CI AND IS NOT IN THIS PLAN.**
> `fixtures-coach-roster.sql` and `fixtures-coach-roster-teardown.sql` both name
> `session_coaches` (teardown `:35`, postcondition `:95`) and the fixture seeds a
> `roster-shadow@swimsync.test` coach (`:11`, `:90`). They run under
> `check-fixture-roundtrip.sh`, which is **in CI**, so a stale fixture fails the build for
> the whole repo rather than only this driver. Both files change in this wave; the teardown
> must gain `class_shadow_coaches` and `session_coach_absences` deletes or the next run
> inherits an assignment (§7.118).
>
> Also not named in this plan and each needing an edit: `SwimSyncApp/lib/coachRoster.test.ts`
> (jest), `SwimSyncAdmin/lib/sessionRoster.test.ts` and `payoutItems.test.ts` (vitest), and
> `supabase/tests/coach_wages.test.sql` — the last because `session_pay_amount` and
> `generate_coach_payouts` both change and assertion 33 is the refusal test §7.130 says is
> the one that survives a rewrite. **Run `supabase test db` once before writing anything and
> record the per-file counts; a file whose count drops has lost a test, not passed one.**

**Measure the sabotage signature** (§7.140): two of this driver's checks scored full marks
with the client sabotaged, and were found only by measuring what breaking the feature
actually does to the score. Do that again for every new check.

### Step 6 — Verification gate

pgTAP · Deno **×2** (§7.15 — a completing run seals its billing month, so passing once
proves nothing) · vitest · jest · typecheck both apps · fixture round-trip · the new driver
with its signature measured · `verify-schedule-week` before *and* after the coach-app change
· rollback rehearsed · `anon` EXECUTE count unchanged.

### Step 7 — Deploy, in this order and no other

1. Migration alone to `main`; `supabase db push`; **`supabase migration list --linked`** and
   check the `remote` column is filled. `db push` printed a `pgdelta` stack trace *and*
   `Finished` on three separate days — that is the normal output, not an incident, and it is
   not proof. (§7.60, §11.9)
2. Post-deploy **remote grant dump** — local and cloud disagree by construction (§7.39, §7.89).
3. Only then the app commits. Vercel builds both sites from `main`, so **a push is the app
   deploy**; a backend-first change lands on `main` last.
4. Confirm with a user-visible string grep of the served bundle. A 200 proves nothing
   (§7.31, §7.51).
5. **⚠ RISK 3 MITIGATION — the window between 1 and 3 is only survivable because of the
   4-arg shim.** Before pushing the migration, confirm the shim exists in the file:
   `grep -c 'session_coach_role' <the migration>` must be non-zero. After the Vercel build
   of step 3 is live and confirmed by step 4, **and not before**, the follow-up migration
   drops the shim, the enum and the compat `session_pay_amount(uuid)` if it is still there.
   The follow-up is a separate `db/…` branch on a separate day — one schema change in
   flight (§7.55).
6. **A post-deploy smoke on the live admin panel: assign a substitute to one lesson and
   clear it.** That is the exact action §7.123 broke last time, on this exact page. Two
   clicks, and it is the only check that exercises the deployed client against the deployed
   database.

No Edge Function changes in this wave, so no `supabase functions deploy`.

### Step 8 — Documents

`PRD.md` §7.13 (pay, shadow rates) and §7.6 (who may mark). `BACKLOG.md`: strike the `Clear`
item **in its own section and anywhere the ranked list names it** — the ⚠ at the top of
`## Build order` exists because three items were found listed as unbuilt while their own
sections read SHIPPED. New gotchas appended with the next free numbers, **never renumbered**
(the highest in use today is **§7.142**, so this wave starts at §7.143).

**Three of this wave's mitigations outlive the plan file and must graduate to
`docs/GOTCHAS.md` §7**, or they die when this file is discarded — §7 governs because
`/session-start` mandates reading it:

- **A seal is only a seal if every writer that can change the answer is behind it.** The
  assignment table was sealed and the absence table was not, and the two are inputs to one
  predicate. Generalises past this wave: whenever a payment becomes a function of *two*
  tables, the freeze belongs on both.
- **Two definitions of "settled" in one engine is a hole, not a duplication.** The plan's
  per-coach `coach_payouts` test versus Adjustments B's tenant-wide one — a coach with no
  payout row falls between them.
- **Dropping a column silently breaks every classic string-body function that reads it.**
  Postgres records no dependency; the failure is a runtime `column … does not exist` on a
  policy expression, i.e. an outage. The enumeration is
  `SELECT proname FROM pg_proc … WHERE prosrc ~ '<table>'`, before and after.

Also worth a line under §7.115: **a plan can commit the gotcha it cites.** This one cited
§7.115 and then described `platform_tenant_overview()` as "three platform-overview
functions" — one function replaced four times, three of the bodies dead.

---

## Risks, ranked — AN INDEX, NOT THE MITIGATIONS

⚠ **Each mitigation lives inline, next to the step it governs**, marked `⚠ RISK n
MITIGATION`. This list exists to be read once and to point at them; a risk read here and
nowhere else is a risk that was read at planning time and forgotten forty tool calls later.
Re-ranked after the risk review of 2026-08-12 — the numbering below is the current one.

**RISK 1 — the absence table re-opens both adjustment loops, and the seal that supposedly
closes them is defined differently from the engine's own.** *Highest, because both failure
directions are money and one of them is permanent and silent:* an absence row removed after a
paid month is invisible to Adjustments A (item-driven) **and** to Adjustments B
(`session_coaches`-driven), so the shadow is never paid; an absence row added after a paid
month emits an unguarded clawback; and the per-coach seal lets an admin backdate into a month
Adjustments B considers settled tenant-wide. → *"What the seal rule buys"*, §2 of the schema,
Step 2 cases 13–15, Step 4's attendance screen.

**RISK 2 — dropping `session_coaches.role` breaks five live function bodies and Postgres will
not stop you.** `coach_is_main_on_session` is the worst of them: it is `attendance_write`'s
whole USING and WITH CHECK, so it throwing means **no coach in any business can save
attendance**, and unmarked attendance blocks the billing month with no override (§8i) and
nothing on any screen saying why. → *§4, `session_coaches` simplifies*.

**RISK 3 — the `assign_session_coach()` signature change breaks the deployed admin panel.**
§7.123 was a live breakage from exactly this, and Step 7's migrations-first ordering is the
ordering §7.123 names as wrong for a removed signature. → *§4, and Step 7 items 5–6*.

**RISK 4 — the pay-attribution predicate and the rate choice can disagree about which arm
matched.** A coach who is both the class shadow and the lesson's substitute satisfies two
arms; a boolean predicate cannot say which, so the rate is chosen by a second copy of the
rule. That is §7.129's shape in §7.129's own function. → *Pay*, and `set_class_terms()`.

**RISK 5 — `coach_rostered_with_student()` gets the shadow branch on only one of its three
arms.** Enrolled children are the obvious arm; trial and make-up guests are the ones that get
forgotten. The failure is not "a shadow can't see a guest" — it is the engine expecting a
guest nobody could mark, a month that will not close, no override (§8i) and **no screen
anywhere saying why**. Wave 3's own comment says this in the same words. → *Access gates*.

**RISK 6 — the Wages page reads the newest rate of ANY role as "the rate".** `page.tsx:179`
sorts every `coach_rates` row by `effective_from` and takes `[0]`, so the first shadow rate
dated after a main rate silently becomes the coach's displayed rate — and `payoutItems.ts`,
which this plan never mentions, labels a shadow's payment `ordinary` or `reassigned`.
→ *§3, `coach_rates` gains a role*; Step 3's Wages page.

**RISK 7 — a hand-rolled date in the visibility function.** `CURRENT_DATE` is the session's
zone (UTC here), and `class_terms.test.sql` 16 already fails on any `public` function whose
body contains it. `today_sg()`, and nothing else. → *§1 of the schema*.

**RISK 8 — the coach app's shadow path needs the opposite date source from the substitute
path**, and `lessonRole()` will not get simpler however much the plan wants it to. Get the
first wrong and a shadow sees an empty schedule; get the second wrong by making it simpler
and the substitute case is what gets deleted. → *Step 4*.

**RISK 9 — `session_coach_absences` has no tenant stamp and no cross-tenant guard** while its
sibling table gets both — §7.125's shape, on the table that decides whether somebody is paid.
→ *§2 of the schema*.

**RISK 10 — the surfaces this plan does not name.** The two CI fixture files, three JS test
files and `coach_wages.test.sql`. → *Step 5*.

**RISK 11 — the two date questions get collapsed into one function.** Visibility asks
*today*; pay asks *the lesson's date*. One function answering both means either an ex-shadow
keeps seeing the class, or a current shadow loses their pay history. Two separately-named
functions, and pgTAP checks 3 and 7 are the pair that catches a merge.

**RISK 12 — an undated assignment silently claws back historical pay.** *Closed by the dated
schema.* Adjustments A re-asks "what is this coach owed now?" for every already-paid session
and writes the difference. An undated row that is deleted makes the answer `0`, so removing
a shadow in November would emit negative adjustments against their August, September and
October pay. This is the reason `effective_to` exists rather than a `DELETE`.

**RISK 13 — payroll's refusal is too easy to hit.** One shadow without a shadow rate blocks
the whole business's payroll. Accepted deliberately (the user chose loud over silent), and
mitigated by the inline warning at assignment time so the refusal is met months earlier, in
a place where it costs nothing.

**RISK 14 — the absence tick is a second, non-transactional write.** Accepted: attendance is a
direct `.upsert()`, and under default-paid a failed absence write leaves the coach paid,
which is the recoverable direction. Do **not** "fix" this by inverting to a presence record —
that trades a recoverable failure for a silent underpayment.

**RISK 15 — the coach app's covered-out probe.** `coveredOutFrom()` computes "somebody else has
this" as *asked minus returned*, so every short or reshaped response hides a lesson that needs
marking (§7.138). *Already closed structurally* — `probeIds` is pushed only under `owned &&`
(`schedule/index.tsx:636, :682`), so a shadowed class cannot enter the probe set. The risk is
that widening the date source in Step 4 widens this too; see the prohibition there.

---

## Explicitly out of scope

- **The Attendance page's Coach column can name someone who did not teach** (S) — still filed;
  it carries an unmade product choice.
- **The admin's invoice pre-flight misses an unmarked EXTRA lesson** (S) — over-reports
  readiness, never under-bills.
- **Deleting an admin destroys the audit history** (S) — unchanged since 2026-08-09.
- **Wave 4** (a lesson recorded into an already-billed month) — next in the ranking, untouched
  by this.
- Renaming `session_coaches` to `session_substitutes`. Clearer, but churn across ~9 files and
  two applied migrations' comments for no behaviour change. Noted, not done.

---

## Estimate

**Two and a half to three days**, comparable to Wave 3 itself. Roughly: migration + rollback
0.75d · pgTAP 0.5d · admin 0.5d · coach app 0.5d · driver 0.25d · verification and deploy 0.5d.

**Production holds zero `session_coaches` rows and zero shadow assignments**, so there is no
backfill and no risk to real pay history. That is the single biggest reason this is affordable
now and would not be in three months.

**Revised after the risk review: three and a half to four days, plus a follow-up migration on
a later day.** The additions are not polish — the absence seal and Adjustments B (RISK 1,
+0.5d), the five function bodies the `role` drop breaks (RISK 2, folded into the migration),
the compat shim and its drop migration (RISK 3, +0.25d now and a separate day later),
`coach_attribution_kind()` (RISK 4, +0.25d), and `payoutItems.ts` with the Wages rate filter
(RISK 6, +0.25d). **Production holding zero rows makes the DATA safe; it does not make the
CODE safe** — RISK 2 and RISK 3 are outages that an empty table does nothing to prevent.

---

## Pre-commit gate — walk this, do not skim it

A box that cannot be ticked is a **blocker**, not a caveat.

**The four that carry the money and the outage. Do these first.**

- [ ] **RISK 2** — `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid =
      p.pronamespace WHERE n.nspname='public' AND p.prosrc ~ 'session_coaches'` run **after**
      applying, and no result contains `role`. Then a real coach saves attendance in the
      running app.
- [ ] **RISK 1** — pgTAP 13, 14 and 15 exist, each proven red by disabling *its own* seal,
      and the seal is written against the **tenant**, not the coach. Adjustments B's `FROM`
      unions the class-shadow arm.
- [ ] **RISK 3** — `\df assign_session_coach` shows exactly **two** rows; the 4-arg shim
      raises on `'shadow'`; the 3-arg form has its own `GRANT`, asserted in pgTAP by exact
      signature; the follow-up drop migration is filed in `BACKLOG.md`.
- [ ] **RISK 4** — one `coach_attribution_kind()`, called by both the predicate and the rate
      choice. pgTAP 16 passes with three distinct amounts.

**Then the rest.**

- [ ] RISK 5 — one pgTAP count assertion returning exactly 3, proven red **three times**,
      once per arm.
- [ ] RISK 6 — the Wages embed filters `role = 'main'`; the insert sends `role`;
      `payoutItems.ts` renders `shadow`; `generate_coach_payouts`'s on-payroll `EXISTS` is
      still role-blind.
- [ ] RISK 7 — `grep -n 'CURRENT_DATE\|now()::date' <the migration>` returns nothing, and
      `class_terms.test.sql` is green.
- [ ] RISK 8 — `coachRoster.test.ts` has **more** `lessonRole` cases than the 4 it has today;
      a shadow sees the class's whole week in the real app; `probeIds` is still guarded by
      `owned &&` at both sites.
- [ ] RISK 9 — `session_coach_absences` has a tenant column and an INSERT-**and**-UPDATE stamp
      trigger that refuses a cross-tenant coach.
- [ ] RISK 10 — both fixture SQL files updated, `check-fixture-roundtrip.sh` green, and the
      per-file pgTAP counts recorded before the work are all **≥** what they were.
- [ ] The verification gate of Step 6 in full, Deno **×2**.
- [ ] Rollback rehearsed against the live bodies, diffed byte-for-byte (§7.93).

---
