# Wave D plan — credit-note batch + 3 non-schema items

_Drafted 2026-08-17. Scope chosen with the user: the credit-note double-credit migration
batch PLUS the non-schema Wave D items (PayNow save validation, the 79px date column,
HANDOVER §3 graduation). `/plan-review` run 2026-08-17 (Fable agent, all risks verified in
code) — mitigations are inlined below as `⚠ RISK n MITIGATION`, ranked most→least risky in
the pre-commit gate at the foot._

## Decisions locked (user + code)

- **Trigger fix:** symmetric ledger, **reuse ONE `credit_notes` row per `invoice_item_id`**
  (never a second row).
- **Un-correction (absent→present) with spent credit:** if the note has **any
  `credit_applications`** rows → **refuse the attendance edit** (`RAISE EXCEPTION`).
  Undrawn note → void cleanly.
- **Engine (`core.ts`) needs NO change — VERIFIED by review.** Drawdown selects
  `.eq("status","available")` (`core.ts:1403-1409`); repo-wide grep found no
  `status != 'applied'` consumer, and the trigger + engine use the SAME balance table
  (`parent_tenant_balances`, trigger `20260720000200:125-129`, engine `core.ts:1252-1259`).
  A `reversed` note is skipped for free. No engine deploy; core.ts unchanged.
- **UNIQUE(invoice_item_id) does NOT collide with the package branch — VERIFIED.** The
  package-funded branch `RETURN NEW`s before any `credit_notes` write (`20260720000200:92-109`);
  no legitimate second cash note per line exists.

## Deploy spine — DELIBERATELY APPS-FIRST (inverted, with reason)

The normal rule is migrations→engine→apps (§7.60). This change **inverts it on purpose**,
the way the tenancy phase-4 deploy did (HANDOVER §3): **every app change here only
*tolerates* new states — a `reversed` status, a refuse errcode — it never *calls* a new
column/RPC.** Shipping the apps first is therefore safe AND closes the two deploy-window
traps (risks 2, 6) before the migration can trigger them.

1. **App push to `main`** (all forward-compatible, inert until the migration exists):
   attendance-save error handler (risk 2), parent + admin `reversed`-note labels (risks 4, 6),
   PayNow validation (track 2), date column (track 3). Verify each is inert today.
2. **Migration → prod** (with the dedup backfill, risk 1), AFTER the prod prechecks below.
3. **Deno ×2 + pgTAP green**, then grant-dump confirm (no privilege touched, but check §7.39/§7.89).
4. **Docs (§3 graduation)** — no deploy.

---

## Track A — the apps push (ships FIRST) · ~2–3 hrs

### A1. Attendance-save error handler
`⚠ RISK 2 MITIGATION` — **CONFIRMED (highest-blast app risk).** The coach save is ONE batch
upsert of every student's row (`SwimSyncApp/app/(coach)/classes/[id]/attendance.tsx:650-652`,
`.upsert(rows, {onConflict:"lesson_session_id,student_id"})`) and the trigger is
`AFTER UPDATE … FOR EACH ROW` (`20260309000500:97-100`) — so ONE refused row rolls back the
**entire roster's save**, and the current handler (line 654-655) discards the DB message and
shows a generic "please try again", i.e. a retry-forever trap for the coach.
- STEP: the migration's `RAISE EXCEPTION` carries a distinct `ERRCODE` (a custom SQLSTATE,
  e.g. `'CN001'`) + a human message.
- STEP: in `attendance.tsx`, on upsert error detect that errcode and surface the trigger's
  message ("X's lesson was already credited and the credit is spent — other changes were NOT
  saved; contact the admin"), not the generic toast.
- ASSERTION (jest): a batch containing one refused row saves nothing and surfaces the specific
  message.
- NOTE: this is the app change the spine ships FIRST — inert until the migration raises the code.

### A2. `reversed`-note display — parent AND admin (NOT admin-only)
`⚠ RISK 4 MITIGATION` — **CONFIRMED plan GAP.** The parent billing screen
(`SwimSyncApp/app/(parent)/billing/index.tsx:197-200`) fetches notes with **no status filter
and does not even select `status`**; line 774 labels by `applied_to_invoice_id ? "Applied" :
"Available"`, so a voided note (null `applied_to_invoice_id`) renders **"Available" forever** —
phantom credit the parent will chase.
- STEP: add `status` to that select; hide-or-label `reversed` (e.g. "Reversed").
- STEP: same for the admin list — `SwimSyncAdmin/app/(admin)/credit-notes/page.tsx:51,221,230,355`
  and dashboard count (`dashboard/page.tsx:140`) all use the binary
  `status==="applied"?"Applied":"Available"` (`⚠ RISK 6` — cosmetic mislabel window; closed by
  shipping this first). The invoice-detail page is already safe (filters `applied_to_invoice_id`,
  `billing/invoice/[id].tsx:151-154`).
- ASSERTION: with one `reversed` note seeded, neither parent nor admin shows an "Available"
  badge for it.

### A3. PayNow save validation
In `SwimSyncApp/app/(coach)/settings/index.tsx` save path, dry-run `buildPayNowPayload()`
(`SwimSyncApp/lib/paynow.ts`) on the entered proxy value/type; on throw show an **advisory
inline warning** — NOT `Alert.alert` (RN-web no-op, §7.10) — and do not hard-block the save.
jest test on the validation branch.

### A4. Date-column cosmetic
Widen the 79px date column in `SwimSyncAdmin/app/(admin)/makeups/page.tsx` and
`trials/page.tsx`. Eyeball in the browser.

---

## Track 1 — the credit-note migration (ships SECOND) · ~half a day

One migration file, single schema change in flight (§7.55), on a `db/…` branch off `main`,
landed on `main` before the migration is pushed to prod.

**PROD PRECHECKS (run before the push — local proves nothing, `credit_notes` count is 0
locally, §7 email-migration note):**
- `⚠ RISK 1` duplicate scan:
  ```sql
  SELECT invoice_item_id, count(*),
         bool_or(EXISTS(SELECT 1 FROM credit_applications ca WHERE ca.credit_note_id=cn.id)) AS any_drawn
  FROM credit_notes cn GROUP BY 1 HAVING count(*)>1;
  ```
- `⚠ RISK 5` vestigial-column scan: `SELECT count(*) FROM tenants WHERE suspend = true;` — must be **0**.

**Migration steps:**
1. Extend `credit_notes.status` CHECK → `('available','applied','reversed')` (drop + re-add).
2. Add `reversed_at TIMESTAMPTZ`, `reversed_by UUID` columns.
   `⚠ RISK 3 MITIGATION (audit half)` — reuse-row would otherwise erase the void's history;
   these give a disputed credit a trail.
3. **Dedup backfill BEFORE the unique index** — `⚠ RISK 1 MITIGATION` — **CONFIRMED.** The
   current bug (no absent→present branch, `20260720000200:80-130`) can have minted two rows +
   two balance increments per line; `BACKLOG.md:420-421` acknowledges it. For each
   `invoice_item_id` group with >1 row: keep the OLDEST, mark the younger **undrawn** rows
   `reversed` (+ stamp `reversed_at`) and decrement `parent_tenant_balances.credit_balance` by
   each one's amount.
   `⚠ RISK 1 NAMED PROHIBITION` — **do NOT auto-dedup a duplicate that HAS `credit_applications`
   rows.** That credit was already spent; reversing it is a manual money decision. If the
   precheck's `any_drawn` is true for any group, STOP and resolve by hand before deploying.
4. `CREATE UNIQUE INDEX` on `credit_notes(invoice_item_id)` (column is `NOT NULL`,
   `20260309000100:204`, so no NULL-multiplicity concern).
5. `CREATE INDEX` on `credit_notes(lesson_session_id)` (the `credit-note-emails` filter).
6. **Do NOT add the partial email index** (`WHERE email_sent_at IS NOT NULL`) — full
   UNIQUE(invoice_item_id) + reuse-row makes "one note, one email per line" structural, so the
   partial index is redundant. Record why in the migration comment.
7. `ALTER TABLE tenants DROP COLUMN IF EXISTS suspend;`
   `⚠ RISK 5 MITIGATION` — **PLAN-CORRECTING.** The column exists in the live DB but is
   created by **no migration file** (schema drift — verified: only comments mention it, e.g.
   `credit-note-emails/email.ts:150-152`). A bare `DROP COLUMN` breaks every fresh
   `supabase db reset` / CI. Use `IF EXISTS` + a comment explaining the drift. Dependency risk
   REFUTED (`pg_depend` = 0 objects; nothing reads/writes it).
8. Replace the trigger (`CREATE OR REPLACE`; capture the CURRENT body first, for the DOWN —
   confirmed newest body is `20260720000200`, last of 8 definitions):
   - **present→absent (correction):** find the row for `invoice_item_id`; if a `reversed` row
     exists, **re-activate** it — `status='available'`, refresh reason/corrected_status/
     issued_at, clear `reversed_at`/`reversed_by`, **AND set `email_sent_at = NULL`**, then
     `+amount` to `parent_tenant_balances`; else INSERT as today. Package-funded branch unchanged.
     `⚠ RISK 3 MITIGATION (email half)` — **CONFIRMED plan GAP.** All three send paths filter
     `.is("email_sent_at", null)` (`credit-note-emails/core.ts:81-83, 96-97, 234-236`); a
     re-activated row with a stale stamp is invisible to send AND to admin Resend. Resetting is
     safe because the sendability gate blocks a non-`available` note (`email.ts:137`). The coach
     app already calls `notifyCreditNoteEmails` on any leave-present save
     (`attendance.tsx:743-745`), so a re-issued note then emails automatically.
   - **absent→present (un-correction):** find the note; if `EXISTS credit_applications` for it →
     `RAISE EXCEPTION ... ERRCODE 'CN001'`; else `status='reversed'`, stamp `reversed_at`/
     `reversed_by`, `−amount` from `parent_tenant_balances`.
   - Keep `SECURITY DEFINER`; keep the `OLD.status = NEW.status` short-circuit.
9. Committed DOWN rollback file (drop the two indexes, drop `reversed_at`/`reversed_by`,
   re-add `tenants.suspend`, restore the old trigger body, revert the CHECK).

**Tests (each proven RED on current code first, §7.25):**
- pgTAP: re-toggle issues ONE note + balance = one amount · absent→present voids undrawn +
  balance→0 · refuse-when-drawn RAISES `CN001` · manual duplicate insert rejected by the unique
  index · after reverse→re-activate `email_sent_at IS NULL` and the note is selected by the
  lesson-session send query (risk 3) · after a void `credit_balance >= 0` (risk 7 belt-and-braces).
- Deno ×2 (§7.15): a seeded `reversed` note → `credit_applied = 0`, balance unchanged; run twice.

---

## Track 4 — HANDOVER §3 graduation (docs, no deploy) · ~1 hr

Keep the prohibitions + verified-vs-specified table; point restated PRD detail at the PRD.
May fold into the closing `/update-docs` instead.

---

## STATUS — 2026-08-18: BUILT + VERIFIED LOCALLY, not yet deployed

Code complete on branch `db/credit-note-double-credit`. Verified: pgTAP **1111** (14 new in
`credit_note_double_credit.test.sql`, RED-proven — the real $60 double reproduced against the
pre-fix trigger with no index); Deno **×2** green (211 each, two email tests updated off the old
bug); admin typecheck + **vitest 441** (+3 PayNow); app typecheck + **jest 391** (+2 CN001 msg).
Migration `20260818000100` + committed DOWN written. **Not deployed** — the prod prechecks below
and the apps-first spine run at ship time.

## PRE-COMMIT GATE — walk before committing (ranked, riskiest first)

A box that cannot be ticked is a BLOCKER, not a caveat.

- [ ] **(Risk 1) Prod duplicate scan run; dedup backfill written; `any_drawn` groups are ZERO
      or hand-resolved.** ← highest value. Post-migration, the duplicate query returns 0 rows
      AND `parent_tenant_balances.credit_balance` reconciles to `SUM(amount − drawn)` per
      (parent, tenant). NEVER auto-dedup a drawn duplicate.
- [ ] **(Risk 2) Attendance-save error handler shipped BEFORE the migration**, and a
      one-refused-row batch is proven to save nothing + show the specific message.
- [ ] **(Risk 3) Re-activation resets `email_sent_at = NULL`** and stamps `reversed_at`; pgTAP
      proves the re-issued note is picked up by the send query.
- [ ] **(Risk 4) Parent app selects `status` and does not render `reversed` as "Available"**;
      admin list same.
- [ ] (Risk 5) `SELECT count(*) FROM tenants WHERE suspend=true` on prod = 0; DROP uses `IF EXISTS`.
- [ ] Engine untouched; Deno suite run TWICE and green (§7.15).
- [ ] Committed DOWN file exists and was rehearsed (§7.93 — running it is the half that finds bugs).

## Graduate to `docs/GOTCHAS.md` §7 when this lands

- A row-level trigger `RAISE` aborts the WHOLE batch upsert (all students), surfaced as a
  generic toast unless the app decodes the errcode. (Risk 2.)
- Reuse-row on a lifecycle column must reset `email_sent_at` or the re-issued email never sends
  and Resend can't reach it. (Risk 3.)
- `tenants.suspend` is schema DRIFT — present in the DB, created by no migration; drops need
  `IF EXISTS`. (Risk 5.)
- Local `credit_notes` count is 0, so prod-duplicate/balance risks are INVISIBLE locally —
  precheck on prod. (Risk 1.)
