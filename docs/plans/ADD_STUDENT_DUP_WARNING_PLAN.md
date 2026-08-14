# Plan — warn on a possible duplicate at the admin's Add-student step

_Status: proposed (2026-08-14). Settled with the user through `/plan-with-confidence`,
hardened through `/plan-review` (product-risk mitigations inlined below, marked
`⚠ RISK n`)._

## What and why

When an admin adds an unregistered child (Students → Add student →
`add_unclaimed_student`), the only duplicate defence today is a hard error on an
**exact name + DOB** collision — and that constraint is **NULL-DOB-exempt**
(`students_identity_uniq`, `20260719001400:44,49`), so it catches nothing when
the DOB is blank, which is the usual case. In practice the admin does not know
the child's full legal name or DOB, so a placeholder gets created for a child a
registered family already has on the roster — a silent duplicate.

Post-§8.55 that duplicate's **history is unrecoverable in the UI**: the "possible
duplicate" banner deliberately no longer compares a claimed child against an
unclaimed one (`duplicateStudents.ts:137`), and the merge dialog can only open
for a pair the banner flags (`setMerging` has one open call site — `page.tsx:953`).
The `merge_students()` RPC exists but nothing in the UI reaches it for this case.
(Precise: the admin can still set one row inactive; what they cannot do is
**merge the stranded attendance/billing history**.) So the right place to catch
it is **at creation**, the one moment a human is looking.

## Scope

**Admin Add-student path only.** `add_unclaimed_student` is also callable by a
class coach (`20260725000200:98-106`, "the person standing at the poolside"), and
that is a real duplicate source — but the coach app has **no UI** that reaches
the write RPC today, so there is nothing to front. `find_roster_duplicates` is
therefore **admin-gated and REFUSES a coach caller by design** (see RISK 2). If a
coach-side add UI is ever built, warning there is a separate follow-up, filed in
`BACKLOG.md` at close — do not silently assume this function covers it.

## Decisions (locked with the user)

1. **On-submit warn + confirm.** Admin clicks Add; if matches are found the
   dialog lists them and the button becomes "Add anyway". Friction only when
   there is a possible duplicate.
2. **Show full name + claim status** ("Anya Gundecha — claimed by Priya"). It is
   the admin's own business — **not a new disclosure**: the admin already sees
   parent `full_name` (`page.tsx:685,742`) and parent phone/email (contact modal,
   `page.tsx:509-547`) in-tenant.
3. **Warn on phone OR name.** Name-only included, to catch the case where the
   admin keys a different family member's number (dad signed up, mom's number
   keyed). A DOB conflict disqualifies a name-only match.
4. **pgTAP + vitest + one manual browser pass.** No new UI driver (§8.55 added
   none for the sibling change either).

## Signals that trigger the warning (OR)

- Entered phone matches an existing child's `provisional_contact_phone`
  (last-8, `normalize_phone`).
- Entered phone matches a **claiming parent's account phone** (`profiles.phone`,
  via `parent_students` of in-tenant students only — RISK 5).
- `names_match(existing, entered)` is true.
- DOB conflict disqualifies a **name-only** match (two "Ethan Tan" born on
  different days are not a duplicate).
- Searches **claimed + unclaimed**, and **BOTH active and inactive** rows
  (RISK 1), within `p_tenant_id` only.

## Two things true by design

- **A phone match is never a hard block.** Siblings share a parent phone, so a
  phone hit + "Add anyway" must always be allowed. The warning lists names
  precisely so the admin distinguishes a sibling from a duplicate.
- **This reintroduces name-only matching on claimed children** — exactly what
  §8.55 turned off for the persistent banner. Correct here because it is a
  one-shot creation prompt (dismissable), not a standing nag, AND because the
  mom/dad case we are catching IS a name-only match against a claimed child.
  Record this in the migration header and the session log so nobody "re-fixes"
  it later. (The `/plan-review` agent proposed suppressing name-only-vs-claimed
  to cut noise — **rejected**: it would silently reopen the exact gap decision 3
  closes. Noise is handled by ranking/labelling instead — RISK 3.)

---

## Steps

### Step 1 — Migration `20260814000200_find_roster_duplicates.sql`

New read-only `SECURITY DEFINER` function
`find_roster_duplicates(p_tenant_id, p_full_name, p_phone, p_dob)`:

- **Auth, in this order (mirrors `find_student_candidates:121-133`):**
  1. `IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'`.
  2. **`is_tenant_admin(p_tenant_id)` gate — REFUSE, do not return empty**
     (a refusal and a legitimately empty roster must not be confusable). This
     also refuses a coach and a foreign-tenant admin.
- Returns `student_id, full_name` (**unmasked** — own business, decision 2),
  `parent_name` (null if unclaimed), `is_active`, `reason`
  (`'phone'` | `'name'`), `last_lesson`, `class_title`.

- **⚠ RISK 5 MITIGATION (cross-tenant/family disclosure — a SECURITY DEFINER
  function bypasses RLS).** Scan `students WHERE tenant_id = p_tenant_id` ONLY.
  Resolve the claiming-parent phone by joining `parent_students` → `profiles`
  **for those in-tenant students only** — never `profiles` globally by phone. A
  parent in two businesses has one global `profiles` row; an unscoped join would
  surface tenant B's child inside tenant A. NAMED PROHIBITION: do not look up a
  student or a parent by phone/name outside `p_tenant_id`.

- **⚠ RISK 1 MITIGATION (returning family = the silent duplicate this feature
  exists to kill).** Include **inactive** rows in the candidate scan, carrying
  `is_active` in the result so the UI can label them "inactive". Do NOT copy
  `duplicateStudents.ts`'s active-only rule — its rationale ("the banner has no
  dismiss, so an inactive pair is permanent noise", `duplicateStudents.ts:56-61`)
  does not transfer to a one-shot dismissable prompt. A family that left and
  returns, re-added with no DOB, is caught by nothing else (NULL-DOB-exempt
  constraint + active-only warning = miss).

- Reuse `normalize_phone` / `names_match` — do **not** write a second copy
  (§8.55 lesson).
- **⚠ RISK 3 MITIGATION (name-only noise / alarm fatigue).** ORDER phone matches
  before name matches; cap at 5; keep the DOB-conflict disqualifier on name-only.
  The UI (Step 3) labels a name-only hit as the weaker "same name" signal, ranked
  under phone/DOB hits, so the admin reads the strong evidence first and does not
  train themselves to click through. Presentation, not suppression.
- Grants: `authenticated` only; `REVOKE EXECUTE ... FROM anon, service_role`
  explicitly (§7.39). (Low-stakes for a read-only `is_tenant_admin`-gated
  function — anon has no `auth.uid()` so the gate refuses — but keep it identical
  to `find_student_candidates:226-235`.)
- **Committed rollback:** `supabase/rollback/20260814_find_roster_duplicates_DOWN.sql`
  (drop function) — the §8.52 pattern, committed before deploy.

### Step 2 — pgTAP `supabase/tests/find_roster_duplicates.test.sql`

Prove each signal fires and each guard holds; each proven red by removing its
clause:

- phone-via-child fires · phone-via-parent-account fires · name-only fires ·
  DOB-conflict disqualifies a name-only match · **claimed child is included**.
- **⚠ RISK 1 assertion:** an **inactive** same-name row (claimed and unclaimed)
  IS returned, flagged `is_active = false`.
- **⚠ RISK 5 assertions:** a two-tenant parent's child in the OTHER tenant is
  **absent** from a tenant-A lookup; a **foreign-tenant admin is REFUSED** (not
  empty).
- **⚠ RISK 2 assertion:** a **coach** caller is **REFUSED** — pins the scope so
  nobody later wires this into the coach path expecting a warning.
- **⚠ RISK 3 assertion:** a name-only hit sorts AFTER a phone hit in the result.

### Step 3 — Admin UI `app/(admin)/students/page.tsx`

- In `handleAddStudent`: before the insert, if not yet confirmed, call
  `find_roster_duplicates`. If rows return → render them in the dialog (name +
  "claimed by X" / "unclaimed" + "inactive" when so + last lesson) and flip the
  button to **"Add anyway"**. Second click proceeds.
- **⚠ RISK 4 MITIGATION (advisory check must never block the core action).**
  FAIL OPEN: if the RPC errors or refuses, surface a non-blocking note and STILL
  allow the insert. `students_identity_uniq` remains the DB floor. NAMED
  PROHIBITION: a null/error result from `find_roster_duplicates` must not gate
  the `add_unclaimed_student` call — the warning is advisory, the constraint is
  the guarantee.
- **⚠ RISK 6 MITIGATION (double-insert; NULL-DOB constraint can't catch a
  repeat).** On the "Add anyway" click set `addBusy` synchronously and disable
  the button (as the existing insert path does, `page.tsx:1245`). Reset the
  confirm token as a STATE RESET (not merely a re-query) whenever
  name/phone/DOB change, so an edited form re-warns. Note in-code that concurrent
  creation (two co-admins) is only ever caught by the constraint — the hard
  name+DOB error stays as the true backstop.
- **⚠ RISK 3 MITIGATION (UI half).** Render phone/DOB matches first and visually
  distinct from a weaker "same name" group; keep the list capped at 5.
- Leave the existing hard name+DOB error path untouched — it is the floor
  beneath the soft warning.

### Step 4 — vitest

Extract a small pure helper (candidate-label / match-description formatter,
including the "inactive"/"claimed by X" wording and the phone-before-name
grouping) and unit-test it. Substantive logic is in SQL (pgTAP); this keeps
client formatting honest.

### Step 5 — Verify + deploy (backend-first, §7.60)

1. `supabase test db` + `npm run typecheck` (admin) + vitest — green locally.
2. **Migration to `main` alone** → `supabase db push` →
   `supabase migration list --linked` (remote column filled) → **remote grant
   dump** (`find_roster_duplicates` = authenticated-only; anon EXECUTE count
   unchanged — §7.39/§7.89).
3. **Then** the app commit to `main` (Vercel builds it) — production never runs
   an app calling an RPC it lacks.
4. One manual browser pass, recorded in the session log:
   - same-phone match warns · name-only match warns · **inactive returning-family
     match warns** · "Add anyway" proceeds · **sibling-under-same-phone is
     dismissable** · a forced RPC error still lets the add through (fail-open).

## Pre-commit gate (walk before committing)

- [ ] **RISK 5** — function scans `tenant_id = p_tenant_id` only; parent-phone
      join limited to in-tenant students; pgTAP cross-tenant-absent + foreign-admin-refused both green. *(highest value — cross-family disclosure)*
- [ ] **RISK 1** — inactive rows included and labelled; pgTAP inactive-match green. *(highest value — the silent duplicate the feature targets)*
- [ ] **RISK 4** — RPC error/refusal fails OPEN; the add still completes.
- [ ] **RISK 2** — coach caller refused; pgTAP green; coach path noted out of scope.
- [ ] **RISK 6** — "Add anyway" disables synchronously; confirm token resets on field edit.
- [ ] **RISK 3** — phone before name in SQL and UI; cap 5; DOB-conflict disqualifier on name-only; pgTAP order assertion green.
- [ ] Deploy order held: migration on `main` + `db push` + grant dump BEFORE the app commit.

## Graduation

RISK 5 (SECURITY DEFINER + tenant-scoped phone join) and RISK 1 (do not copy the
banner's active-only rule into a one-shot prompt) are durable traps, not
task-local. If they prove out, graduate both to `docs/GOTCHAS.md` §7 at
`/update-docs` — §7 is read every session; this plan file is discarded.

## Size

~half a day. Migration + pgTAP is the bulk; the UI change is one function plus a
dialog block.
