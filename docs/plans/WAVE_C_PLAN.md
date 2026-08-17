# Wave C — all five items, sequential on `main`

_Plan authored 2026-08-17. Source: BACKLOG.md → Wave C. `/plan-with-confidence` +
`/plan-review` (Fable agent). Mitigations are inlined as `⚠ RISK n` next to the step
they govern — do not move them to a trailing section._

## Shared facts

- **All five are app-only** — no migration, no edge function, no backend deploy. Each ships
  via a push to `main` (Vercel builds both web apps). **If any item turns out to need a
  migration, STOP and re-plan** — that breaks the batch's core assumption and the worktree/
  deploy-order rules change (§7.55, §7.60).
- One feature branch per item → implement → verify → merge to `main` → push → delete branch.
- **Build order:** #5 CSV first (pure, lowest risk, warm-up), then value order 1→4. Each
  item is independent; no edges between them.
- House rule, every item: **write the test, prove it red without the fix, then build** (§7.25).
- **Deploy proof:** a 200 proves nothing — grep the served bundle for a new user-visible
  string only the new build has (§7.31, §7.51).

---

## 1. Convert a trial → enrolled student (admin) — S
`SwimSyncAdmin/app/(admin)/trials/page.tsx`

1. Add `class_id` to the trials `.select` (`trials/page.tsx:108-114`) and to the `Booking`
   type (`:33-40`) — the row currently carries only `class_title`.
2. Add a **"Convert to enrolled"** button on each row of the *past — needs marking* red panel
   (`:340-367`), beside the existing Cancel.
3. On press, reuse the Unassigned Children insert verbatim (`unassigned/page.tsx:199-216`):
   `student_class_enrolments.insert({ student_id, class_id, is_active: true })` then
   `students.update({ assignment_status: "assigned" })`. **No RPC exists — direct insert.**
4. Keep the **"this makes them expected every week"** confirm wording (unmarked attendance
   blocks billing, §8i).
5. Surface the enrolment-overlap trigger refusal (§8.43) from `error.message` as-is.

> **⚠ RISK 1 MITIGATION — HIGHEST BLAST RADIUS (tenant-wide billing halt). Do NOT skip
> the live-trial guard.** The original plan said "skip the two-press guard, the trial is
> the reason to convert." That premise is WRONG about what the guard checks. The guard
> (`unassigned/page.tsx:179-197`) queries only *future* trials
> (`.gte("session_date", todaySg).is("cancelled_at", null)`) — so it **cannot fire on the
> past trial being converted** anyway. What it catches is the real hazard: a family that
> rebooked a *second, upcoming* trial. Converting then creates an enrolment (expected every
> week, forever) *on top of* a live trial booking, and an unmarked trial booking blocks the
> whole tenant's invoice month with **no override** (`generate-invoices/core.ts:675-708`).
> - **STEP:** Port the future-trial query verbatim into the convert handler and keep the
>   two-press escalation when it returns a row.
> - **PROHIBITION:** Conversion must NOT mark, hide, restyle, or remove the past trial row —
>   it stays on the *needs-marking* list (keyed on `!marked`, `trials/page.tsx:158,162`)
>   until the lesson is actually marked. An unmarked trial still blocks billing.
> - **STEP:** Check the `students.update({assignment_status})` error (the Unassigned page
>   ignores it, `:214-217`) — a swallowed failure leaves the child enrolled but still on the
>   Unassigned page. Add `class_id` to the trials select (`:111`) — it is not selected today.

**Tests:** vitest for the convert action + **both** confirm gates (plain convert, and the
escalated two-press when a future trial exists — assert the escalation fires, proven red by
removing the guard); extend a trials driver to click Convert and assert the child leaves the
past list only when marked, and gains an enrolment.

## 2. Upcoming lessons for parents (parent app) — S
`SwimSyncApp/app/(parent)/attendance/index.tsx`

1. The screen already reads `student_class_enrolments.select("enrolled_at, classes(day_of_week)")`
   and already calls `expectedLessonDates()` for its `hasExpectedLesson` probe (`:181-197`) —
   pointing at the *past*. Extend that select to `classes(title, day_of_week, start_time, end_time)`.
2. Compute the future list: `expectedLessonDates(day, todayInSg(), addDays(todayInSg(), 28))`
   — `addDays` from `scheduleWeek.ts:58`. ~4-week horizon, as a named constant.
3. Render an **"Upcoming"** section at the top of the list `ScrollView` (`:289`), *outside*
   `filtered.map` so the status chips don't touch it. Reuse the `Card` markup (`:350-373`)
   with `formatSgDate()` + `formatTime()`.

> **⚠ RISK 4 MITIGATION — subtract public holidays; do NOT ship the naive weekday walk.**
> `expectedLessonDates` is a pure weekday recurrence with no holiday/cancellation input.
> The original v1 defence ("matches `hasExpectedLesson` fidelity") does not hold: that probe
> is an *invisible past boolean*; this is a *forward-facing promise*. `tenant_public_holidays`
> already exists (`20260815000100`), the admin curates it, and **parents already hold SELECT**
> (`parent_in_tenant(tenant_id)`). Listing a lesson on Chinese New Year sends a family to a
> closed pool.
> - **STEP:** Fetch `tenant_public_holidays` where `holiday_date` between `todayInSg()` and
>   +28d, and filter those dates out of the projection. RLS already permits the read; it is
>   one query and uses data the business already maintains.
> - **ACCEPTED v1 LIMIT (named, not silent):** `lesson_sessions`-level cancellations/reschedules
>   are still NOT reflected — that stays a follow-up (union `lessonDatesInRange`). Holidays are
>   in scope because the data is free; ad-hoc cancellations are not.

**Tests:** jest-expo — mock enrolment → assert upcoming dates render, past filter untouched,
**and a seeded holiday inside the window is excluded** (proven red without the filter).

## 3. Book a make-up from the Attendance page (admin) — S
`SwimSyncAdmin/app/(admin)/attendance/page.tsx`

1. Add an **Actions** `<Td>`, rendered only when
   `["absent","cancelled_rain","cancelled_coach"].includes(row.status)`.
2. The row gives `student_id` → `p_student_id` and `class_id` → `p_home_class_id` (the missed
   class). **The multi-class ambiguity is resolved by the row itself** — no home-class picker.

> **⚠ RISK 6 MITIGATION — guard the button against guest rows (confusion, not corruption).**
> `book_makeup()` holds every real guard (verified full body, `20260811000100:375-553` —
> SECURITY DEFINER, so no RLS gap; a bad call is *refused*, never corrupt). But the attendance
> page also shows **guest** rows (`trial_paid`/`trial_free`, make-up absences) where
> `row.class_id` is the *host* class, not one of the child's enrolments. Passing that as
> `p_home_class_id` earns a baffling "not one of the child's current classes" refusal.
> - **STEP:** Render the Actions button only when `row.class_id` is in the child's *active*
>   enrolment set (one `student_class_enrolments` lookup, mirroring `hostChoices`'s `ownIds`
>   at `makeups/page.tsx:244-251`). Guest/trial rows get no button.
3. Collect the **host** class + date via a modal: reuse `hostChoices` (same category, minus
   the child's own classes) and `datesFor()` from `makeups/page.tsx:244-268`. Needs the row's
   class *category* — add it to the attendance select or a small lookup.
4. Call `supabase.rpc("book_makeup", { p_class_id: host, p_session_date, p_student_id,
   p_home_class_id: row.class_id })` (`makeups/page.tsx:311`). Show refusals from
   `error.message` verbatim — `book_makeup()` holds every guard (§7.20).
5. Makeups page stays the primary home; this is an entry point only.

**Tests:** vitest for host-choice filter + call args; driver clicking a make-up from an
absent row.

## 4. Attendance edit history → "Change History" (admin) — S
New `SwimSyncAdmin/app/(admin)/history/page.tsx` + nav entry

1. New route `/history`, label **"Change History"** — deliberately NOT `/audit` / "Audit log"
   (the trail has holes by design: §7.120, `prepare_admin_delete()` purges; NULL-`tenant_id`
   rows are platform-admin-only). Settled decision.
2. Read `audit_log` directly — grant + RLS already exist (`GRANT SELECT ... TO authenticated`;
   `audit_log_select` scoped to `is_tenant_admin(tenant_id)`). No server route.
3. **One global filtered list** (settled — not per-entity): mirror `attendance/page.tsx` —
   date range in the DB (`gte/lte` on `created_at`, with the out-of-order-resolve guard
   `:148-179`), `entity_type` dropdown client-side, `ROW_LIMIT = 1000` banner.
4. **Diff** `old_value`/`new_value` (`to_jsonb` snapshots) — show what changed, not raw JSON.
5. Resolve `actor_id` → `profiles.full_name`; render an unattributed row as **"system"**.

> **⚠ RISK 5 MITIGATION — never relabel a real person as "system" (audit integrity).**
> The cross-tenant leak is *refuted in code*: `audit_log_select` is tenant-scoped
> (`20260718000900:474-475`) and the BEFORE-INSERT trigger refuses NULL-`tenant_id` rows
> (`20260804000300:128-162`). The residual risk is presentation: `actor_id` can be a real
> person (e.g. a platform admin acting inside the tenant) whose `profiles` row the tenant
> admin's `profiles_select` policy does not expose. Calling that "system" is an audit-integrity
> failure — the one thing this page must not do.
> - **PROHIBITION:** Render "system" **only when `actor_id IS NULL`**. A non-null actor that
>   fails profile resolution renders as `unknown user (<first-8-of-id>…)`, never "system".
> - **STEP:** Push the `entity_type` filter into the DB query alongside the date range, so the
>   `ROW_LIMIT = 1000` cap applies *after* filtering — otherwise "no invoice changes in July"
>   can be a false negative (the cap ate them before the client filter ran).

**Tests:** vitest for the snapshot-diff renderer; **assert a non-null-but-unresolvable actor
renders `unknown user (…)`, not "system"** (proven red by mapping unresolved→"system"); driver
loading the page, filtering, asserting a known attendance edit shows a before/after.

## 5. Export to CSV — invoices + credit notes + attendance (admin) — S
New `SwimSyncAdmin/lib/csv.ts` + an "Export CSV" button on three pages

1. New pure `lib/csv.ts`: `toCsv(rows, columns)` + `downloadCsv(filename, text)` (Blob +
   anchor). No export util exists today; mirror `holidaysCsv.ts`'s `splitCsvLine` quoting
   rule *inversely*. Prepend a UTF-8 BOM so Excel opens unicode names correctly.

> **⚠ RISK 3 MITIGATION — CSV formula injection into the admin's Excel (workstation compromise).**
> Student/parent names are free text, parent-entered at signup. A name like `=HYPERLINK(...)`
> or `+cmd|...` executes when the tenant admin opens the file — and **quoting does not stop it**
> (Excel evaluates quoted formulas). The attacker is any parent.
> - **STEP:** In `toCsv`, prefix any field whose first char is `=`, `+`, `-`, `@`, TAB, or CR
>   with a leading `'`.
> - **ASSERTION (proven red first, §7.25):** `toCsv([{n:"=1+1"}], …)` emits the field as
>   `'=1+1`. This graduates to `docs/GOTCHAS.md` §7 at close.

2. Hang each export off the page's already-computed **`visible`** array (post-search, filter,
   sort — `sort.apply(filtered)`). Export what's on screen; do not refetch.

> **⚠ RISK 2 MITIGATION — block a silently-truncated financial export.** The attendance page
> is hard-capped at `ROW_LIMIT = 1000` (`attendance/page.tsx:56,173`) and the invoices query
> (`invoices/page.tsx:597`) has **no `.limit()`**, so it rides PostgREST's ~1000 default. An
> accountant exporting "the year" gets the newest N rows and sums wrong revenue in Excel — the
> on-screen banner warns the viewer but the file does not.
> - **ASSERTION:** if `rows.length >= cap` (1000, or the page's `ROW_LIMIT`), **block the
>   download** and show "Narrow the date range and export again." Never emit a capped file.
>   A warning row *inside* the CSV corrupts parsing — blocking is the safe form.
> - **STEP (money):** PostgREST returns `NUMERIC` as *strings*. Export from the page's already
>   `Number()`-coerced row objects (`invoices/page.tsx:613`), not a fresh query — amounts are
>   dollars not cents (`NUMERIC(10,2)`), so no 100× error, but string-vs-number must be
>   consistent.

3. Column maps: Invoices — Parent, Student(s), Month, Gross, Package, Credit, Net, Status,
   Reference. Credit notes — Reference, Student, Parent, Amount, Reason, Linked Invoice, Date,
   Status, Emailed. Attendance — Student, Class, Coach, Date, Status.
4. Money as raw numbers (accountant math). Filename `<table>-<todayInSg()>.csv`.

**Tests:** vitest for `lib/csv.ts` — commas, embedded quotes, newlines in a name/reason must
stay quoted and round-trip; **the injection assertion above; and the cap-block assertion**.

---

## Cross-cutting

- Each item, once merged to `main`, is live via Vercel. Confirm per the deploy-proof rule above.
- Docs: each shipped item → PRD entry, BACKLOG strike-through, §8 note at close via `/update-docs`.
- No worktrees, no migrations.

---

## Pre-commit gate

Walk these before committing each item. A box that cannot be ticked is a **blocker**, not a
caveat. The top three carry business-stopping or workstation-compromise blast radius.

**Highest value — do not ship without these:**
- [ ] **#1 Convert-a-trial:** the future-trial guard is ported into the convert handler and
      the two-press escalation fires when a rebooked upcoming trial exists (test proves it red
      without the guard). The past trial row is NOT marked/hidden/removed by conversion.
- [ ] **#2 CSV truncation:** `downloadCsv` caller blocks the download when `rows.length >= cap`
      and shows "narrow the date range" — no capped financial file is ever emitted.
- [ ] **#3 CSV injection:** `toCsv` prefixes `= + - @ TAB CR` leading chars with `'`; unit test
      `toCsv([{n:"=1+1"}]) → '=1+1` passes and was proven red first.

**The rest:**
- [ ] **#4 Upcoming:** `tenant_public_holidays` in the window are subtracted from the projection;
      test seeds a holiday and asserts exclusion (red without the filter). Cancellation follow-up
      is named, not silent.
- [ ] **#5 History:** "system" renders ONLY for `actor_id IS NULL`; a non-null unresolved actor
      renders `unknown user (…)` (test proves it). `entity_type` filter is in the DB query so the
      1000-cap applies after filtering.
- [ ] **#6 Make-up:** the Actions button appears only on rows whose `class_id` is an active
      enrolment of the child; guest/trial rows get no button.

**Every item:**
- [ ] Its new test was **proven red without the fix** (§7.25).
- [ ] Full suites green: vitest, jest-expo, both typechecks. Deploy proof = grep the served
      bundle for a new user-visible string, not a 200 (§7.31/§7.51).

**Graduate at session close:** RISK 3 (CSV formula injection) and RISK 1 (the convert guard
checks *future* trials, so skipping it re-opens the blocked-billing hole) are durable — promote
both to `docs/GOTCHAS.md` §7 via `/update-docs`, not just this plan file.
