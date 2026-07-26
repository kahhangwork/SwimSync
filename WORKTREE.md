# Worktree — Editing a student's PARENT contact details

**Branch:** `feat/parent-contact-details` · **Base:** `main` @ `48d9d49`
**Backlog item:** `BACKLOG.md` → *Coach workflow* → *Editing a student's PARENT contact
details* (**S**)

---

## What this actually is

**These are the PARENT's contact details, stored on the child's row — not the child's.**
A child has no phone or email of their own anywhere in the model, and should not get one.

Three columns on `students` (`20260725000100_student_settlements.sql:132-135`):

| Column | Holds |
|---|---|
| `provisional_contact_name` | The adult who brought the child |
| `provisional_contact_phone` | *"The number the coach arranged the trial on"* — the column's own `COMMENT` |
| `provisional_contact_email` | The address taken at the same moment |

They exist for the window **before that adult has an account**.

## Why now

All three are **load-bearing, not record-keeping**:

- `_email` and `_phone` are the **top two ranked signals** in `find_student_candidates()`
  (refined across `20260726000800` / `000900` / `001000`). They are what makes Add Child
  offer *"is this your child?"* instead of silently creating a duplicate.
- `_name` becomes the invited parent's `full_name` (`invite-parent/route.ts:183`). A blank
  one showed an **unnamed parent** on the admin roster — one of the ten defects production
  testing found (HANDOVER §8.12).

The phone is **required going forward**, but only going forward. Every child added before
2026-07-26 has **no contact details at all**, so they can only ever be matched by name —
the weakest signal. On production, several real children are in exactly that state, and one
has `964` stored, which `normalize_phone()` correctly rejects as too short. **No screen can
fix any of it.**

## Scope

An admin-side edit path for the three columns. Home is the admin's student edit surface —
note there is currently **no student edit screen at all**; `students/page.tsx` is the only
file under `app/(admin)/students/`.

**No migration is needed** — verified: `students_update` already grants
`is_tenant_admin(tenant_id)` (`20260718000900_tenant_rls.sql:299-305`).

## Decide first — it changes the design

**Should these stay editable once the child is CLAIMED?** Nothing clears them on claim,
link or merge (`merge_students()` `COALESCE`s them), so a claimed child keeps them forever.

The argument for **read-only after claim**: the real details then live on `profiles`, so a
second editable copy on the student row is a stale duplicate of exactly the kind
`students.age` and `classes.price_per_lesson` were removed for — and it feeds the matcher
for a child who can no longer be a candidate. Settle this with the user before building.

## Constraints — read before writing

- **NO MIGRATIONS in this worktree.** The other worktree
  (`../SwimSync-attendance-window`) owns `supabase/` and is the only one that may
  `supabase db reset`. If you find you need a schema change, **stop and raise it** — that
  is the one thing that makes these two streams collide.
- Expect the local stack to be reset out from under you occasionally; just re-seed.
- **Coaches must not get this path.** Granting them `UPDATE` on `students` also exposes
  names, DOBs and notes — **RLS is row-level, not column-level**. This is the same reason
  coaches have no write path to students at all.
- **`Alert.alert` is a no-op on RN-web** — but this is the Next.js admin, so use its
  existing patterns. Follow what `students/page.tsx` already does.
- **Don't touch `HANDOVER.md` / `PRD.md` / `BACKLOG.md`.** They are the one guaranteed
  merge conflict between the two worktrees; `/session-close` writes them once at the end
  from `main`.

## Verify

- `cd SwimSyncAdmin && npm test && npm run typecheck`
- Drive it with `run-ui-playwright` — the read paths are where the last two sessions'
  invisible bugs lived (HANDOVER §7.48), and neither was reachable from a unit test.
