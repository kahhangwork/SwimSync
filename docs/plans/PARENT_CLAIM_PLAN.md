# Parents claiming their own child — slice 2 of trial onboarding

_Planned 2026-07-26 with `/plan-with-confidence` + `/plan-review`. Slice 1 (`TRIAL_ONBOARDING_PLAN.md`,
PRD §7.17) shipped the **invite** path — the admin asserts the link. This slice covers the other
direction: the parent gets there first._

---

## 1. The problem, stated exactly

A child can exist before their parent (slice 1). The admin can invite that parent, and the child is
adopted with no ambiguity — **proven on production 2026-07-25**, `parent_students` 11 → 12.

But a parent can always **register on their own first**. Today they open Add Child, type their
child's name, and get a **second student record with none of the attendance**. The original keeps
holding the billing month open (slice 1's unclaimed-attendance seal condition), the duplicate
accumulates nothing, and **nothing in the app detects either fact**. The remedy is SQL.

Two distinct failures, and this slice closes both:

| | Failure | Fix |
|---|---|---|
| **A** | The duplicate is about to be created | Match at Add Child, offer the claim (§3) |
| **B** | The duplicate already exists | Admin-driven merge + detection (§7, §8) |

**B is not hypothetical.** Production has 14 students and 12 parent links; every child a coach ever
adds is a candidate for it, and the eleven that predate slice 1 have never been checked.

---

## 2. Decisions already made — do not re-derive

Settled with the user across two planning rounds. Where a decision **reverses** an earlier one, that
is called out, because the earlier one is written down elsewhere and will otherwise look authoritative.

1. **Matching happens at Add Child, on the name and DOB the parent just typed.** Not at join-code
   time. *(This REVERSES the first round's answer, on the user's redirect, and the reason is
   decisive: at join time the only signal is `profiles.phone` vs `students.provisional_contact_phone`,
   and that column is optional on both creation paths — so for most children there is nothing to fire
   on. Name + DOB is the strongest signal in the system and arrives for free.)*
2. **Three outcomes, the parent's words:** **Confirm** · **Not Sure** · **No**.
3. **Confirm and Not Sure both go to the admin queue.** Neither attaches the child directly.
   *(The user considered attaching immediately on a strong name+DOB match and declined. **The
   original rule stands: the admin confirms every claim.** A wrong link exposes a family's
   attendance and billing history, and that is not a risk the parent's own certainty can price.)*
4. **No** creates the child exactly as the parent entered it.
5. **A pending claim BLOCKS that parent from re-adding that child.** Preventing the duplicate is the
   whole point; letting them proceed anyway reintroduces it.
6. **Disclosure: first name + last initial + when they attended.** "Ethan T., trial on Sat 12 Jul".
   *(Chosen over initials-only: a business with two E-initial children makes initials a coin flip,
   and a wrong claim costs an admin decision. The parent has already typed a matching name, so the
   first name is largely information they supplied.)*
7. **The admin learns of a claim from an in-app badge + queue page.** No email. *(Volume is low —
   only Not Sure and confirmed claims land there, not every parent.)*
8. **`link_invited_parent()` does the linking.** It is written, deployed, tested and proven on
   production. Approval calls it. Do not re-implement linking.
9. **Merge is constrained** to *unclaimed ↔ claimed*, refuses when **both** rows carry attendance,
   the survivor is the row with the **history**, and the emptied duplicate is **hard-deleted** with
   its contents written to `audit_log`. A tombstone would collide with `students_identity_uniq`.
10. **Scope is claim + merge + detection**, in one slice.

---

## 3. The flow

```
Parent fills Add Child (name, DOB, gender, notes) and taps Save
        │
        ▼
  add_child_or_claim(mode := 'check')          ← server-side; the client cannot skip it
        │
        ├── no candidates ──────────► child created + linked (exactly today's behaviour)
        │
        └── candidates (max 3) ─────► popup:
              "Your coach may have already added your child.
               Is Ethan T., who had classes on Sat 12 Jul, your child?"

               [ Confirm ]   → claim (certainty 'confirmed')  → admin queue → child NOT created
               [ Not Sure ]  → claim (certainty 'unsure')     → admin queue → child NOT created
               [ No ]        → child created as entered, candidate recorded as rejected
```

While a claim is pending, re-submitting the same child returns **`pending`** rather than the popup,
so the parent cannot get round it by tapping Save again.

**Admin queue** → **Approve** (`link_invited_parent()`, child attached, parent notified in-app) or
**Decline** (claim closed, parent unblocked and told plainly they can add the child themselves).

### ⚠ RISK 7 MITIGATION — the popup itself can manufacture a wrong Confirm

The popup appears at the moment a parent is trying to finish a task, offering a card that looks like
the answer. Every UI instinct — a highlighted primary button, "we found your child!" phrasing —
pushes toward Confirm, and a wrong Confirm is what RISK 1 has to clean up. Write it to be *easy to
decline*:

- **The three buttons carry equal visual weight.** No primary/ghost hierarchy: Confirm is not the
  recommended answer, it is one of three.
- **The copy asks a question and does not assert a finding.** *"Your coach may have already added
  your child"* — never *"We found your child"*.
- **Show the lesson date and class**, not just the name. That is the detail a real parent can check
  and a guesser cannot, and it is why decision 6 includes it.
- **Never pre-select a candidate**, and never auto-advance when there is exactly one. A single
  candidate is the case most likely to be accepted without reading.

---

## 4. Phase 0 — verify the ground before writing anything

Cheap, and two of these have already caught documented facts being wrong.

- [ ] `supabase start` + `supabase db reset`, then **`docker restart supabase_kong_SwimSync`**
      (§7.44 — without it every auth-touching test fails with an empty error object and it reads
      like a catastrophic regression).
- [ ] Record the **before** test counts: pgTAP **299**, Deno **108**, admin vitest **106**, app jest
      **79**. A changed count at the end that you did not intend means a test was lost.
- [ ] Dump the live definition of every function this slice touches or reuses —
      `SELECT pg_get_functiondef('public.link_invited_parent(uuid,uuid)'::regprocedure);` — and work
      from **that**, never from the migration file whose name matches (§7.40, which has now fired
      twice).

---

## 5. Phase 1 — `student_claims`

One table. A claim is a **request**, not a link — the link is `parent_students`, written only by
`link_invited_parent()`.

```sql
CREATE TYPE claim_certainty AS ENUM ('confirmed', 'unsure');
CREATE TYPE claim_status    AS ENUM ('pending', 'approved', 'declined', 'withdrawn');

CREATE TABLE student_claims (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,  -- the candidate
  parent_id   UUID NOT NULL REFERENCES parents(id)  ON DELETE CASCADE,

  -- What the parent TYPED, snapshotted. Two uses: the admin judges the claim against the
  -- parent's own words rather than the candidate's, and a DECLINE can pre-fill "create a new
  -- child" without making them type it again. Same rule as invoice_items.student_name — a fact
  -- about a past act is never a live lookup (§6).
  claimed_name    TEXT NOT NULL,
  claimed_dob     DATE,
  claimed_gender  TEXT,
  claimed_notes   TEXT,

  certainty     claim_certainty NOT NULL,
  match_reason  TEXT NOT NULL,          -- 'name_dob' | 'name_only' | 'phone'
  status        claim_status NOT NULL DEFAULT 'pending',

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at  TIMESTAMPTZ,
  decided_by  UUID REFERENCES profiles(id),

  CONSTRAINT claim_decision_is_complete CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status <> 'pending' AND decided_at IS NOT NULL)
  )
);

-- One live claim per (parent, candidate). Partial, like trial_bookings_live_slot_uniq: a
-- DECLINED claim must not permanently block a corrected re-claim.
CREATE UNIQUE INDEX student_claims_live_uniq
  ON student_claims (parent_id, student_id) WHERE status = 'pending';

CREATE INDEX student_claims_pending_tenant
  ON student_claims (tenant_id) WHERE status = 'pending';   -- the badge's hot path
```

**The block (decision 5) is a QUERY, not an index.** The obvious index —
`UNIQUE (parent_id, tenant_id, lower(trim(claimed_name)), claimed_dob) WHERE status='pending'` —
**does not hold when `claimed_dob` is NULL**, because NULLs never collide in a unique index. That is
the exact mechanism that makes duplicate students form in the first place
(`students_identity_uniq` exempts NULL DOB). Enforce the block inside the RPC with an explicit
`IS NOT DISTINCT FROM`, where NULL = NULL is true.

**RLS.** Parent reads their own (`parent_id = current_parent_id()`); tenant admin reads their
tenant's. **No INSERT, UPDATE or DELETE policy at all** — every write goes through a SECURITY
DEFINER function, so there is no client write path to get wrong.

---

## 6. Phase 2 — the matcher and the one write path

### `find_student_candidates(p_tenant_id, p_full_name, p_dob)` — SECURITY DEFINER

Required: a registering parent matches **no branch** of `students_select`, so they cannot see an
unclaimed child at all without this.

**It takes a tenant and must therefore gate on it.** §7.42 says a SECURITY DEFINER *writer* must
derive its tenant rather than accept one; this is a reader, so it accepts one — and that makes
`parent_in_tenant(p_tenant_id)` the entire boundary between a parent and every business on the
platform. Refuse loudly if it fails.

**Candidate pool:** same tenant · `is_active` · **no `parent_students` row** (unclaimed) · no
pending claim already held by this parent. Ranked, **capped at 3**.

| Reason | Rule |
|---|---|
| `phone` | digits-only `profiles.phone` = digits-only `provisional_contact_phone`, ≥ 7 digits |
| `name_dob` | `lower(trim(full_name))` equal **and** `date_of_birth` equal |
| `name_only` | first token equal, **or** ≥ 2 shared tokens of length ≥ 2 |

**`name_only` is deliberately not "any shared token".** In Singapore that would make every *Tan*
match every other *Tan* — turning the popup into a directory of the business's unclaimed children,
which is precisely the disclosure BACKLOG warns against. Requiring the **given name** (first token)
or two tokens keeps "Ethan" ↔ "Ethan Tan Wei Ming" working while refusing "Tan" ↔ "Tan".

**Returns masked rows only** — `first name + last initial`, the date and title of the most recent
lesson, and the reason. Never DOB, never the contact phone, never notes.

### ⚠ RISK 3 MITIGATION — this function is a disclosure surface, and it answers to anyone with a join code

Everything protecting one family's children from another goes through this one function. The join
code is the only credential in front of it, and a code is shared over WhatsApp.

- **The masking happens in SQL, not in the client.** The function must not return a full name at
  all, so a future screen — or the network tab — cannot reveal one. A masked string built in the app
  from a full name sent over the wire is not masking.
- **Cap at 3 in the FUNCTION**, not in the caller, and `log()`-equivalent nothing: a silent cap is
  fine here precisely because the cap *is* the privacy rule, but it must be unbypassable.
- **`parent_in_tenant(p_tenant_id)` is the boundary** — a pgTAP test asserts a parent gets a
  **refusal**, not an empty set, for a tenant they have not joined. An empty set is what a
  *legitimately empty* business looks like, so the two must not be confused.
- **Assertion with a pass/fail value:** a test seeds two unclaimed children, `Tan Wei Ming` and
  `Ethan Tan`, and searches `Tan` → **0 candidates**. Surname-only overlap returning anything means
  the token rule regressed into a directory.
- **Named prohibition:** never add a "show me all unclaimed children" mode, however convenient it
  looks for the admin. The admin already has the Students page, under RLS.

### `add_child_or_claim(p_tenant_id, p_full_name, p_dob, p_gender, p_notes, p_mode, p_candidate_id)`

One function, one mode parameter — the shape `add_unclaimed_student(p_kind)` already established.

| `p_mode` | Behaviour |
|---|---|
| `check` | Run the matcher. Candidates → return them, **insert nothing**. None → create + link, return `created`. |
| `claim_confirmed` / `claim_unsure` | Insert a `student_claims` row for `p_candidate_id`. Return `pending`. |
| `create_anyway` | Create the child despite candidates. Audit-log the rejected candidates. |

Returns `(outcome TEXT, student_id UUID, candidates JSONB)`.

**Then narrow `students_insert`:** drop the parent branch
(`current_parent_id() IS NOT NULL AND parent_in_tenant(tenant_id)`), leaving platform admin and
tenant admin. Without this the popup is **client-side only**, and §7.8 is unambiguous about what
that is worth: *a safety gate that the only live caller bypasses is not a gate.*

⚠ **This is a CONTRACT, so the deploy order flips: app first, then the migration** (§6, §7.27). A
live app still inserting directly would break the moment the policy narrows.

### ⚠ RISK 2 MITIGATION — this narrowing can break the ONE path every new family walks

`students_insert`'s parent branch is how **every** parent has ever created a child. Getting this
wrong doesn't degrade a feature; it stops onboarding outright — and onboarding is what HANDOVER §9
calls the thing blocking everything else. It also fails *silently from the app's side*: a
policy-refused insert is an error object, and Add Child's existing handler turns any non-23505 error
into *"Failed to create child profile. Please try again."* A parent would retry forever.

- **Write `supabase/rollback/20260726_parent_claim_DOWN.sql` BEFORE the migration**, restoring the
  original `students_insert`. The trials work set this precedent and the rollback was **executed and
  verified forward and back** — do that again here, not just write the file.
- **Step 3 of the deploy is not done when `db push` returns.** It is done when a child has been
  created through the **real parent app on production** afterwards. Add that as an explicit deploy
  step, not an assumption.
- **The `check` path with no candidates must be byte-identical to today's behaviour** — same
  student row, same `parent_students` link, same 23505 message. Pin it with a **tripwire test**, the
  shape `packages.test.ts` used: a parent whose child matches nothing produces exactly the
  pre-slice-2 result. If that test ever fails, the ordinary case has regressed.
- **Named prohibition:** do NOT combine the narrowing migration with the additive ones. It must be
  its own file, pushed after the app is live, so it can be rolled back alone.

---

## 7. Phase 3 — the parent app

- **Add Child** (`SwimSyncApp/app/(parent)/home/add-child.tsx`) calls the RPC instead of
  `.insert()`. On `candidates`, render the popup — three buttons, the user's copy.
- **Pending state** on the home screen: *"Waiting for your coach to confirm Ethan is your child."*
  Without it the parent taps Save, sees a message once, and has nothing to look at afterwards.
- **Declined**: the pending card becomes *"Your coach said that wasn't your child — you can add
  them yourself."* with a button that re-opens Add Child pre-filled from `claimed_*`.
- **Approved**: the child simply appears. `link_invited_parent()` has already written both links.

Matching helpers (`normalizeName`, `tokens`, `maskName`) go in `SwimSyncApp/lib/` as **pure
functions with their own jest tests** — the SQL matcher is the authority, but the client masks and
formats, and formatting a name wrongly is how a leak looks.

### ⚠ RISK 5 MITIGATION — a blocked parent is stuck until an admin looks, and nothing chases the admin

Decision 5 blocks the parent deliberately, and decision 7 gives the admin **no email**. Together
they mean a parent's onboarding can stall indefinitely on an admin who does not log in — during the
exact onboarding push §9 says is the priority. The user chose both knowingly; these reduce the
cost without reversing either:

- **The pending card states elapsed time and what to do** — *"Waiting since Sat 26 Jul. Still
  waiting? Ask your coach to check their SwimSync admin."* Vague waiting is what makes a parent give
  up; a stated wait with a named next action does not.
- **The pending count also goes on the admin Dashboard**, not only the sidebar badge. The badge is
  visible only once they are already in the panel and looking left.
- **Blocked means blocked for THAT child, not for Add Child.** A family adding a second, unrelated
  child must not be stopped. Test it: a parent with one pending claim successfully adds a different
  child.
- **Deliberately NOT doing:** a parent-side self-cancel, and an email to the admin. Both were
  offered and declined. Recorded here so a future session does not read this risk and "fix" it by
  reversing a decision.

### ⚠ RISK 6 MITIGATION — two parents can hold a pending claim on the same child

`student_claims_live_uniq` is per **(parent, student)**, so two different parents may each have a
pending claim on the same candidate — separated families, or one genuine parent and one mistake.
Approving both is impossible (`link_invited_parent()` refuses the second), but the failure would
surface to the admin as a **raw error on a button that worked a moment ago**.

- **`approve_student_claim()` auto-declines every other pending claim on that student**, in the same
  transaction, and says so in the response: *"1 other pending claim on this child was declined."*
- **The queue groups claims by child** where more than one exists, so the admin sees the conflict
  *before* choosing, not after.
- **Assertion:** a pgTAP test files two claims on one child, approves one, and asserts the other is
  `declined` with `decided_at` set — not left `pending` and not erroring.

---

## 8. Phase 4 — the admin queue

New page `/claims`, added to `NAV` in `SwimSyncAdmin/lib/adminNav.ts` with `scope: "tenant"` —
that one declaration drives the sidebar **and** `RequiresTenant`'s route gate, so a page added there
is gated automatically.

Each pending claim shows: the parent (name, email, phone), **what they typed**, the candidate child,
the match reason in plain words, and the candidate's lesson count — the admin's real question is
*"is this the same child?"*, and lessons already marked are what makes the answer matter.

- **Approve** → `approve_student_claim(claim_id)`: gate on `is_tenant_admin`, `PERFORM
  link_invited_parent(profile_id, student_id)`, set status. If the child gained a different parent
  since the claim was filed, `link_invited_parent()` **already refuses** — that race is closed by
  reuse, not by a new check.
  - **Enrichment:** if the candidate has **no DOB** and the parent supplied one, write it.
    This is the one thing that stops the same duplicate forming again, since NULL DOB is what
    defeats `students_identity_uniq`. Wrap it: on `unique_violation`, **keep the link and skip the
    enrichment** — a name+DOB collision with a *third* row must not fail the claim.
- **Decline** → status `declined`, `decided_by` recorded, parent unblocked.
- **Badge:** count of pending claims for this tenant, in `Sidebar.tsx`.

### ⚠ RISK 1 MITIGATION — approving wrongly is the worst outcome available, and today there is NO WAY BACK

Approval hands a stranger a family's **attendance, invoices and billing history**. That is the
highest-blast-radius action this slice adds, and the review found the remedy missing:

**A tenant admin cannot unlink a parent from a child.** `parent_students_delete` is
`USING (parent_id = current_parent_id() OR is_platform_admin())` — the *parent* can unlink and the
*platform* admin can, but the business's own admin **cannot**. So a mis-approval is, in the shipped
product, permanent and fixable only by SQL. That is not an acceptable pairing with a one-click
Approve button.

**Build these three, in this order:**

1. **`undo_student_claim(claim_id)` — an admin-only reversal, and it ships in the SAME commit as
   Approve.** Deletes the `parent_students` row it created, sets the claim to `declined`, and
   audit-logs both acts. Do **NOT** ship Approve first and backlog the undo.
   - It must **refuse** once the link has been used for anything a reversal cannot unwind — an
     invoice issued to that parent covering that child. Refuse with the invoice number, don't
     silently half-undo.
   - It deliberately leaves `parent_tenants` alone. Membership is not the harm, and revoking it
     could evict a family who legitimately has *other* children at the business.
2. **The approval screen shows the admin what they need to decide** — the candidate's **full** name,
   DOB and lesson count (the admin is entitled to their own business's data; only the *parent* sees
   a masked version), the parent's name, email and phone, and what the parent typed, side by side.
   An Approve button next to a masked name is a coin flip with someone else's data.
3. **Approve is a two-step confirm** naming both parties: *"Attach Ethan Tan (12 lessons recorded)
   to Sarah Lim's account?"* — the same shape as the destructive-action guards already used for
   bulk attendance and deactivation.

**Assertion:** a pgTAP test proves `undo_student_claim()` removes the link, and a second proves it
**refuses** when an invoice exists for that (parent, student). **Prohibition:** do not "fix" the
unlink gap by widening `parent_students_delete` to tenant admins — that grants a blanket delete on
every family link in the business to close a one-row problem.

---

## 9. Phase 5 — merge

`merge_students(p_survivor_id, p_duplicate_id)` — SECURITY DEFINER, `is_tenant_admin` on the
tenant derived **from the students** (§7.42), both rows must be in the **same** tenant.

**Refusals, each with plain-English text:**
1. Different tenants.
2. **Both rows carry attendance** → *"Both children have lessons recorded. This one needs to be
   sorted out by hand."*
3. The duplicate carries `invoice_items` or `credit_notes` → refuse. Money already documented
   against a row is not something a merge may quietly re-point.

**Survivor = the row with the history**, asserted rather than trusted from the caller: if the
argument order disagrees with where the attendance is, **refuse** rather than silently swapping.
Repointing attendance is the dangerous operation; being explicit about direction is cheap.

**Order of operations**, all in one transaction:
1. Copy the duplicate's better fields onto the survivor **where the survivor's is NULL** — DOB,
   gender, notes, `level_id`. Never overwrite a value the business already set.
2. Move `parent_students` links to the survivor (skip a link that already exists).
3. Move live `trial_bookings` to the survivor, respecting `trial_bookings_live_slot_uniq`
   (`WHERE cancelled_at IS NULL`); drop a booking that would collide.
4. Move `student_settlements`.
5. Delete the duplicate's `student_class_enrolments` (it has no attendance, by rule 2).
6. `INSERT INTO audit_log … to_jsonb(duplicate_row)` — **before** the delete.
7. `DELETE FROM students WHERE id = p_duplicate_id`.

### ⚠ A DOCUMENTED SAFETY CLAIM IS NOW FALSE — read this before building step 7

`BACKLOG.md` states, and slice 1's design relied on: *"of five FKs into `students`, only
`parent_students` cascades; enrolments, attendance, invoice_items and credit_notes are all
`NO ACTION` — so a mis-aimed merge cannot destroy anything."*

**There are now SEVEN FKs into `students`, and THREE cascade.** Slice 1 and the trials work added
two more, in the same session that wrote that sentence:

| FK | On delete | Added by |
|---|---|---|
| `parent_students` | **CASCADE** | initial schema |
| `student_settlements` | **CASCADE** | `20260725000100` (slice 1) |
| `trial_bookings` | **CASCADE** | `20260725000700` (trials) |
| `student_class_enrolments` | NO ACTION | initial schema |
| `attendance` | NO ACTION | initial schema |
| `invoice_items` | NO ACTION | initial schema |
| `credit_notes` | NO ACTION | initial schema |

So the database still refuses to delete a student carrying **attendance or money** — the guarantee
that matters holds. But a delete now **silently destroys that row's trial bookings and
settlements**, and a settlement is *recorded revenue* (`BACKLOG.md` → Revenue reporting counts
`student_settlements.amount` alongside invoices). Steps 3 and 4 exist because of this, and they
are **not optional tidying**. Correct the BACKLOG sentence in the same commit.

### ⚠ RISK 4 MITIGATION — don't trust the FK list; make the merge prove it moved everything

The list above was accurate when written and became wrong within one session, silently, because
someone (me) added a cascading FK elsewhere. The next person to add one will not read this plan.
So the mitigation cannot be "remember the table" — it has to be **structural**:

- **`merge_students()` counts before and after, and RAISES if anything vanished.** Inside the same
  transaction, before the delete, tally the duplicate's `trial_bookings`, `student_settlements` and
  `parent_students`; after the delete, tally the survivor's. If the survivor did not gain what the
  duplicate held (less any deliberate collision drops, which are counted separately), **raise and
  roll back**. A future eighth cascading FK then fails the merge loudly instead of eating data.
- **Assertion with a pass/fail value:** a pgTAP test merges a duplicate holding 1 live trial booking
  and 1 settlement, and asserts the survivor ends with **exactly** those, and that
  `SELECT COUNT(*) FROM trial_bookings` and `FROM student_settlements` are **unchanged overall**.
  A merge must move rows, never destroy them.
- **Audit before delete**, `to_jsonb(duplicate)` — already step 6, and it is the last line of
  defence if the counts are ever wrong in a way the guard misses.

---

## 10. Phase 6 — detection

On the admin **Students** page, beside the existing *No parent account (N)* filter: flag pairs in
this tenant where the name matches by the §6 rule and **at least one side is unclaimed**. Each pair
offers **Review & merge**.

Detection is a **read-time derivation**, not a stored flag — nothing would maintain a stored one
(§7.37), and the pool is a few dozen rows.

A parent's **No** is recorded in `audit_log`, and the pair still appears here. The parent may be
wrong, and the admin is the one who decides.

---

## 11. Phase 7 — tests

| Suite | What it must pin |
|---|---|
| **pgTAP** `student_claims.test.sql` | Claim RLS both ways (a parent cannot read another parent's claim; an admin cannot read another tenant's). `find_student_candidates` **refuses a tenant the parent has not joined**. A claimed child is never a candidate. `name_only` refuses a surname-only overlap. The pending block holds **with a NULL DOB** — the case the index cannot cover. Approve → both links exist. Approve → the enrichment is skipped, not fatal, on collision. Decline → parent unblocked. |
| **pgTAP** `student_merge.test.sql` | Every refusal (cross-tenant, both-have-attendance, duplicate-has-money, wrong direction) each asserting **`students` did not shrink**. A successful merge moves attendance count, `trial_bookings` and `student_settlements`, writes `audit_log`, and leaves the survivor's non-NULL fields untouched. |
| **vitest / jest** | The pure matcher + masking helpers, both apps. Masking must never emit a full surname. |
| **UI driver** `verify-parent-claim.mjs` | The whole loop across both real apps: parent adds a child that matches → popup → Confirm → **blocked from re-adding** → admin badge shows 1 → approve → the child appears in the parent app with the lesson already marked. Then: Not Sure → queue; No → duplicate created → admin detection flags it → merge → one row survives with the attendance. |

**The driver is the load-bearing one.** Slice 1's driver found two bugs no unit test could — a
correct refusal rendering through a fail-safe branch so the modal never opened, and an error
rendered *behind* an open modal.

---

## 12. Deploy

Additive first, contract last:

1. Migrations for `student_claims`, the matcher, `add_child_or_claim`, `approve_student_claim`,
   `merge_students` — **all additive**, so `db push` first.
2. Push `main` → Vercel builds admin + app. Both now use the RPC.
3. **Then** the migration narrowing `students_insert` — a contract, so it goes **after** the app is
   live (§7.27, and §8's deploy got exactly this backwards once).
4. `supabase migration list --linked` — nothing pending. **`db push` may print a `pg-delta` SSL
   stack trace and still have succeeded** (§8.11); the list is the fact, not the trace.
5. Dump the remote and check the new functions' grants — `REVOKE … FROM anon, service_role` is
   written explicitly, and local `pg_proc` **cannot** confirm it (§7.39).
6. **Create a child through the real parent app on production** (RISK 2). Until that is done, the
   deploy is not finished — step 3 removed the only path every family uses.

---

## 13. Pre-commit gate

Walk this before committing. **A box that cannot be ticked is a blocker, not a caveat.**

**The three that matter most — if only three get checked, these:**

- [ ] **`undo_student_claim()` exists and ships in the same commit as Approve** (RISK 1). A tenant
      admin cannot unlink today; shipping Approve without the reversal makes a mis-approval
      permanent.
- [ ] **The `students_insert` narrowing is its own migration, pushed AFTER the app is live, with a
      tested rollback** (RISK 2) — and a child has been created through the real app afterwards.
- [ ] **`find_student_candidates` masks in SQL, caps at 3, and refuses an unjoined tenant** — with
      the `Tan` → 0 candidates test passing (RISK 3).

**The rest:**

- [ ] `merge_students()` counts before/after and raises if rows vanished; the trial-booking +
      settlement test passes and global counts are unchanged (RISK 4).
- [ ] `BACKLOG.md`'s "five FKs, only `parent_students` cascades" sentence is corrected to seven and
      three, in this commit (§9).
- [ ] The no-candidate tripwire test proves Add Child is byte-identical to pre-slice-2 behaviour.
- [ ] A parent with one pending claim can still add a **different** child (RISK 5).
- [ ] Approving one claim auto-declines the others on that child (RISK 6).
- [ ] The popup: three equal buttons, question-not-assertion copy, nothing pre-selected (RISK 7).
- [ ] Test counts moved only where intended — pgTAP 299 → ?, Deno 108 (unchanged: the engine is
      untouched), vitest 106 → ?, jest 79 → ?. An **unchanged** pgTAP count means the new suites
      did not run.
- [ ] `verify-parent-claim.mjs` green through both real UIs, including the merge half.
- [ ] Both apps typecheck; `grep` audits clean for `toISOString().split|slice` (§7.7).

### Graduating to HANDOVER §7

Two findings here outlive this task and belong in §7, which `/session-start` mandates reading:

- **§7.46 — "the FK cascade list into `students` is not static, and a stale copy of it is a
  data-loss bug."** It went from five FKs/one cascade to seven/three inside one session, while a
  document asserting the old shape was being written. Any code that deletes a tenanted row must
  verify what it takes with it *at runtime*, not from a list.
- **§7.47 — "a business's own admin cannot unlink a parent from a child."**
  `parent_students_delete` covers the parent and the platform admin only. Any feature that *creates*
  a family link must ship its own reversal, because the generic one does not exist.
