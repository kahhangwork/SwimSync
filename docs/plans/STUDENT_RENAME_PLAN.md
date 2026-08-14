# Let the admin set a claimed child's real name

_Planned 2026-08-14. Bug: when a parent claims an existing child and types the child's real
name, that name is stored on the claim (`student_claims.claimed_name`) but never applied to
`students.full_name` — so the admin's list keeps the coach's placeholder (production example:
`Anya (big)`). `approve_student_claim()` (`20260726000400`) enriches only DOB/gender/notes, and
never the name (deliberate: "never overwrite what a coach recorded"). The admin panel also has
no way to rename a student at all (`students/page.tsx:544` blocks `full_name` edits)._

## Decisions (settled with the user 2026-08-14 — do not re-litigate)

| # | Decision | Consequence |
|---|---|---|
| 1 | The admin **picks the name at approval** — sees current + parent-typed, can keep or edit | The approval screen gains a name field; the parent's name is pre-selected only for a `confirmed` claim, current name for `unsure` (⚠ RISK 1) |
| 2 | The fix **must also cover already-approved children** (Anya is already approved; approval runs once) | Needs a rename path that is NOT the approval flow |
| 3 | The parent's real name **replaces** the placeholder — `(big)/(small)` is discarded, not kept | No nickname column; a straight overwrite |
| 4 | Retroactive home: a **Rename action on the Students page**, reusing the same primitive | One shared RPC, two callers |

**Verified facts this plan rests on:**
- `invoice_items.student_name` snapshots the name at billing (`core.ts` ~815, ~1039) and
  `credit_notes` copy it (`20260719001700`), so a rename **never** rewrites an issued
  invoice/credit note (§7.7, §7.4). **The one live reader is `email.ts:323-330`** (the invoice
  email builds its lines from live `students.full_name`); harmless today because the email is
  sent only in the same engine run that issues the invoice — live == snapshot at send time, and
  there is no resend path (grep-confirmed). See ⚠ RISK 4.
- `students_audit_trigger` fires `WHEN (OLD.* IS DISTINCT FROM NEW.*)` (`20260809000200`) and
  records `auth.uid()` as actor (preserved under SECURITY DEFINER — the §7.104 `current_user`
  trap does not apply), so a `full_name` change writes a `student_updated` audit row
  automatically.
- `students_identity_uniq` is `UNIQUE(tenant_id, lower(trim(full_name)), date_of_birth)`
  (`20260719001400`). ⚠ **A NULL date of birth NEVER collides** — that is the whole reason
  claimed/coach duplicates arise, and it is the trap in ⚠ RISK 2 below.
- `is_tenant_admin(tenant_id)` already bakes in tenant **suspension** (`20260813000300:122`),
  co-admins, and admin deactivation — so the RPC needs no extra suspension/disable check, and a
  suspended tenant's admin is refused for free.

---

## Step 1 — Migration: `rename_student(p_student_id UUID, p_new_name TEXT)`

`SECURITY DEFINER`, one new function, its own migration on `main` first.

1. Derive tenant from the **student row**, authorize `is_tenant_admin(v_row.tenant_id)` — never
   a param (§7.42).
2. `btrim` the name; reject empty with `ERRCODE = 'check_violation'` (mirror
   `add_child_or_claim`'s `'a name is required'`).
3. `UPDATE students SET full_name = v_name WHERE id = p_student_id`. The audit trigger records it.
4. Wrap the UPDATE in `EXCEPTION WHEN unique_violation` → friendly message naming the collision
   (name + date of birth), not a raw 23505.

> **⚠ RISK 2 MITIGATION — a step, and it is the highest-value one in this file. THE INDEX ALONE
> DOES NOT PROTECT YOU.** `students_identity_uniq` does **not** fire when the date of birth is
> NULL, so a rename into a same-name NULL-DOB row succeeds silently and recreates the exact
> duplicate this whole subsystem exists to prevent — the coach then has two identically-named
> children they cannot tell apart. So **before** the UPDATE, probe for a live same-tenant row
> `WHERE lower(btrim(full_name)) = v_name AND id <> p_student_id AND is_active` (regardless of
> DOB, using `IS NOT DISTINCT FROM` for the DOB the way `add_child_or_claim:96` does) and refuse
> with a friendly "already registered with this coach or school" message. The
> `EXCEPTION WHEN unique_violation` in step 4 stays as the backstop for the non-NULL case.
> **Assertion (pgTAP):** renaming child A to match a NULL-DOB child B in the same tenant returns
> the friendly message, and afterwards `SELECT count(*) FROM students WHERE lower(btrim(full_name))='…'`
> is unchanged — proven red by removing the probe (the index lets it through).

5. Grants: `REVOKE ALL … FROM PUBLIC` + `REVOKE EXECUTE … FROM anon, service_role` + `GRANT
   EXECUTE … TO authenticated` (§7.87, §7.39). Rollback file committed **before** deploy.

> **⚠ RISK 6 MITIGATION — an assertion, and a named non-fix.** `GRANT EXECUTE … TO authenticated`
> means any parent or coach can *call* the RPC; the ONLY thing stopping them is the internal
> `is_tenant_admin` check. So the pgTAP must assert **a parent calling `rename_student` on their
> OWN child is refused** — not merely the cross-tenant case, which is the easy one. **Named
> non-fix:** `is_tenant_admin` is deliberately FALSE for the platform admin, so this RPC cannot
> rename cross-tenant; that is correct (they are unmounted from the Students page). Do not
> "fix" it to accept a platform admin.

## Step 2 — Students page: a "Rename" action

`students/page.tsx`. Add a Rename action per child that calls `rename_student` — **not** a raw
`.update({ full_name })` (the page blocks that at line 544 for a reason). Update that guard
comment to name the RPC as the sanctioned path. Surface the RPC's friendly errors inline.

> **⚠ RISK 5 MITIGATION — a named prohibition.** The parent already writes `full_name` directly
> (`SwimSyncApp/.../edit-child.tsx:95`, PRD §7.4), so after this there are TWO writers. That is
> fine: both pass `students_identity_uniq` and both are audited, so neither can corrupt integrity
> — worst case is last-writer-wins and the audit trail shows the order. **Do NOT try to "resolve"
> the two writers with a lock, a freeze, or a status field propagating between them** — that is
> §7.61's shape (inventing coupling the data does not need) and buys nothing.

> **⚠ RISK 7 MITIGATION (the missing category) — a decided stance, not a build step.** The
> contact-edit modal on this same page FREEZES while a claim is pending
> (`students/page.tsx:505-535`), because `match_reason` is snapshotted against the contact. A
> **name** change does not invalidate `match_reason`, so Rename is deliberately **NOT** frozen
> under a pending claim. State this in the code comment beside the Rename action so a reviewer
> expecting symmetry with the contact freeze sees it was considered, not missed.

## Step 3 — Claims page: show both names

`claims/page.tsx`. `list_student_claims` already returns `claimed_name`, the student's
`full_name`, **and `certainty`** (`confirmed` | `unsure`) — no backend change to read them.
Render current name, parent-typed name, or an edit field.

> **⚠ RISK 1 MITIGATION — a step, and the riskiest item in this review. THE DEFAULT IS
> CERTAINTY-DEPENDENT; do not pre-select the parent's name unconditionally.** A claim can be
> `confirmed` ("yes, that's my child") or `unsure` ("not sure") — `add_child_or_claim:133`. For
> an `unsure` claim, auto-applying the parent-typed name would rewrite the coach's roster
> identity (read LIVE on the coach attendance screen) with an unverified guess — the exact thing
> `approve_student_claim` refuses to do with gender/notes. So:
> - `certainty = 'confirmed'` → pre-select the **parent-typed** name (the settled default).
> - `certainty = 'unsure'` → pre-select the **current** name; applying the parent's name requires
>   an explicit click/edit by the admin.
> **Assertion (driver):** approving an `unsure` claim WITHOUT touching the name field leaves
> `students.full_name` unchanged.

## Step 4 — Apply the chosen name on Approve

Leave `approve_student_claim` **untouched** (highest-blast-radius function in the slice); the
page calls `approve_student_claim`, then `rename_student` only when the chosen name differs from
the current one. Not one transaction — acceptable, because a failed rename after a successful
approve leaves a **correct link** (the irreversible half) and the name is cosmetic and retryable
on the Students page. Do not fold `p_apply_name` into approve — that forces a DROP+regrant
(§7.150) for atomicity that RISK 3 shows is not worth it.

> **⚠ RISK 3 MITIGATION — a step, on the failure MESSAGE.** `approve_student_claim` fills a
> missing DOB from `claimed_dob` FIRST (lines 81-91), which can make the follow-up `rename_student`
> newly collide with a third same-name row — so a rename can throw *right after* a successful
> approve, on one click. The link is fine; the messaging must say so. On a failed post-approve
> rename, show **"Linked successfully — but the name couldn't be applied because &lt;collision&gt;.
> Rename from the Students list."** NEVER surface it as a blanket approval failure: a re-click of
> Approve then throws `'that claim has already been decided'` (lines 57-59) and reads as a
> deeper bug. **Assertion (vitest):** when `rename_student` rejects after `approve_student_claim`
> resolves, the UI shows the linked-but-not-renamed message, not the generic approve error.

## Step 5 — Tests (each proven red first, §7.25)

- **pgTAP** on `rename_student`: admin-only refusal; **a PARENT calling it on their own child is
  refused** (RISK 6), not just cross-tenant; the **NULL-DOB same-name probe** refuses and leaves
  the row count unchanged (RISK 2, proven red by removing the probe); non-NULL collision → clean
  error not 23505; audit row written; **a rename does NOT change an existing
  `invoice_items.student_name`** (RISK 4 — the snapshot boundary).
- **vitest**: Students-page rename (success + collision error surfaced); claims picker default is
  parent-name for `confirmed` and current-name for `unsure` (RISK 1); the linked-but-not-renamed
  message on a post-approve rename failure (RISK 3).
- **driver**: seed a placeholder child + an approved link → rename → list shows new name; a fresh
  `confirmed` claim → approve with the parent's name → applied; **an `unsure` claim → approve
  without touching the name → `full_name` unchanged** (RISK 1).

## Step 6 — Deploy (migration-first, §7.60 / §11.9)

Migration on `main` alone → `db push` → `migration list --linked` clean → grant dump → then the
app commit. Rollback rehearsed both directions.

## Not doing
- No `(big)/(small)` nickname column (decision 3).
- No change to the parent's mobile rename path (PRD §7.4 — already works).
- No data backfill — the Students-page rename fixes Anya by hand, once.

> **⚠ RISK 4 — a named constraint for the future, not a step now.** The invoice **email**
> (`email.ts:323-330`) reads live `students.full_name`. It is safe today only because email is
> sent in the same run that issues the invoice and there is no resend path. **If an invoice
> RESEND feature is ever built, it MUST read `invoice_items.student_name`, not
> `students.full_name`** — otherwise a renamed child's resent email diverges from the issued
> document. This belongs in `docs/GOTCHAS.md` when the work lands.

## Pre-commit gate

**The three that matter most:**
- [ ] **RISK 1** — the claims picker defaults to the CURRENT name on an `unsure` claim; a driver
      proves approving an `unsure` claim untouched leaves `full_name` unchanged.
- [ ] **RISK 2** — `rename_student` probes for a same-name row regardless of DOB and refuses;
      proven red by removing the probe (the index alone lets a NULL-DOB duplicate through).
- [ ] **RISK 6** — pgTAP proves a PARENT calling `rename_student` on their own child is refused.

**The rest:**
- [ ] `rename_student` derives tenant from the row and is admin-only; empty name rejected.
- [ ] non-NULL name+DOB collision returns a friendly error, not 23505.
- [ ] a pgTAP check proves a rename leaves `invoice_items.student_name` unchanged (RISK 4 boundary).
- [ ] **RISK 3** — a post-approve rename failure shows "linked, name not applied", never the
      generic approve error.
- [ ] Students page calls the RPC, not a raw `full_name` update; the line-544 guard comment stays.
- [ ] grant dump clean (`anon` EXECUTE still 18).
