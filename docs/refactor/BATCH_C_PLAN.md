# Admin L-C — lite batch plan (money pages)

_Unit in the feature-tier rollout (playbook `FEATURE_TIER_REFACTOR_PLAYBOOK.md` §7.1). Lite
track, folded: **one code commit per page** (L1+L2+L3 folded, the proven L-A/L-B default),
plus one L0 (this doc + the drift-test widening) and one L4 (drivers) for the whole batch.
**Nothing here changes behaviour** — every cut is a Fowler refactor, markup verbatim, both
apps' suites green at each commit (playbook §0)._

Started 2026-09-17 on branch `refactor/admin-lc` off `main` (`6bbf360`). Root checkout, no
worktree, no migration. Follows `classes` (the 4th full giant, §8.108) — **do not merge until
nightly `35187663332` (classes) is green** (never two units in flight, playbook §7.1).

## The batch

Four admin "money" pages, grouped by driver net. Line counts from `wc -l` on 2026-09-17
(re-measured) — total **2,309**, one giant's worth of risk, one nightly.

| Page | Lines | `useState` | `.from` / `.rpc` / other | `lib/` → MOVE (sole importer) | `lib/` → STAY (shared) |
|---|---|---|---|---|---|
| `wages` | 894 | 18 | 10 / 2 / `auth.getUser` | `payoutItems` | `lessonDates`, `lessonAttribution` |
| `credit-notes` | 631 | 17 | 2 / 2 / `auth.getUser`, `functions.invoke` | `creditNoteEmailState`, `creditNoteVoidState` | `csv`, `lessonDates`, `packageCoverage`, `tableSearch` |
| `referrals` | 447 | 13 | 6 / 3 / `auth.getUser` | — | `lessonDates`, `referralDiscount` |
| `accounting` | 337 | 9 | 1 / 2 / `auth.getUser` | `accounting` | — |

**`wages` is the heaviest (894 / 18)** — top of the lite range. Its `loadPayouts` is a
multi-round-trip load with `isStale()` checks between awaits; those checks are
**load-bearing** (a stale row carries an irreversible "Mark paid"), so every `await` boundary
and every `isStale()` stays exactly where it is — the dao functions are one query each and
the hook keeps the orchestration.

**`accounting` has a page-level component test** (`accounting/page.test.tsx`) that mocks
`@/lib/supabase` and asserts the ⚠ RISK 6 owner gate (no accounting RPC for a non-owner) and
the wages-withholding render. It stays beside `page.tsx` and must pass unchanged — the mock is
module-level, so it still intercepts the client once `dao/` imports it. It is this batch's
strongest net for that page.

**Move-or-stay rule (grep-confirmed 2026-09-17, both `@/lib/<mod>` AND `./<mod>`, excluding
`.test`, playbook §2):**

- `payoutItems` — only `wages/page.tsx` → **MOVE** into `wages/domain/` (+ its test).
  `lib/lessonAttribution.ts` and `lib/sessionRoster.ts` name `lib/payoutItems.ts` in
  **comments** only (not imports) — repoint those two comments in the same commit.
- `creditNoteEmailState`, `creditNoteVoidState` — only `credit-notes/page.tsx` → **MOVE**
  into `credit-notes/domain/` (+ tests). `creditNoteVoidState.ts` names its sibling in a
  comment by bare name only — no path to fix.
- `accounting` — only `accounting/page.tsx` → **MOVE** into `accounting/domain/` (+ test).
- `referralDiscount` — `referrals` + `packages/ui/ProductModal` → **STAY**.
- `lessonDates`, `lessonAttribution`, `csv`, `packageCoverage`, `tableSearch` → **STAY** (shared).
- `supabase` — bound in each page's `dao/`, never imported by the page after its commit.

Doc pointers to the moved paths (`docs/ARCHITECTURE.md`, `docs/TESTING.md`,
`docs/GOTCHAS.md`, `docs/plans/*`) are listed in §12 for `/update-docs`.

## The driver net (grep, not the playbook's suggested list — §7.236)

`grep -lE "/<route>([\"'\`/?]|$)" verify-*.mjs`, 2026-09-17:

| Page | Drivers that open the ADMIN route | What they exercise |
|---|---|---|
| `wages` | `coach-wages`, `platform-admin-scope`, `smoke-admin` | set a rate · Calculate payroll · Mark paid (+ coach My Pay) |
| `credit-notes` | `platform-admin-scope`, `smoke-admin` | render only |
| `referrals` | `referrals`, `smoke-admin` | render + minted REF- code shown (rest of the driver is Packages + RPCs) |
| `accounting` | `smoke-admin` | render only (+ `page.test.tsx` unit net) |

**Batch net (dedup):** `coach-wages`, `referrals`, `platform-admin-scope`, `smoke-admin`.
Matches the playbook's suggested net plus `platform-admin-scope` (opens every admin route).

**Hand-checks at L4 (no driver presses these):** wages — expand a payout breakdown, the
teaching/shadow role switch re-prefilling the amount, rain toggle + pay-day blur; credit-notes —
scoped search, status filter, Export CSV, Void confirm/cancel (Resend if a not-emailed note
exists); referrals — Save settings, Disable/Enable a code, Grant a reward, Void a reward;
accounting — owner view renders tiles / month picker. Screenshot each, name it in the L4 commit.

## The commits

Gate every commit: `cd SwimSyncAdmin && npm run typecheck && npm test` **and**
`cd SwimSyncApp && npm run typecheck && npm test`. Green or `git checkout -- .` (playbook §2).

- [x] **L0** (this doc + the drift-test widening) — `SCOPE_DIRS` widened to the four folders;
      every current violation pinned (36 data-access lines, 18 page imports), by file + snippet.
      All four checks proven red (checks 3+4 on the real violations before pinning; breakers
      `wages/ui/Break` → `../dao`, `wages/dao/break` → React, `wages/domain/break` → `fetch(`,
      and an unpinned `@/lib/utils` on `accounting/page.tsx`), breakers removed, 6/6 green.
- [x] **L1–L3 folded, ONE commit per page.** Smallest first: `f1c547d` accounting (337→116) ·
      `205959e` referrals (447→78) · `3086156` credit-notes (631→85) · `0dcc61c` wages (894→115).
      Every page: **0 `useState`**, its ledger entries deleted as the code moved. **Both ledgers
      empty again.** 757 vitest (+23 characterisation cases across the 4 pages) + 429 jest, both
      apps green at each commit. Every `ui/` file checked verbatim against the original page by
      a whitespace-insensitive script (prop renames mapped back); the big `ui/` cuts were taken
      by line range from `git show HEAD:<page>`, not retyped.
- [x] **L4** (once) — full batch net GREEN on the live stack 2026-09-17, one driver at a time
      (`--only`, per-driver DB reset), routes warmed first (§7.108): **smoke-admin 64/64 ·
      coach-wages 10/10 · referrals 13/13 · platform-admin-scope 32/32**. Hand-check script
      (temporary, deleted) against `coach@swimsync.test` on a reset DB +
      `fixtures-admin-table-geometry.sql` (its credit note) + one attended June lesson:
      **26/26** — accounting owner view; referrals Save settings · Disable/Enable code · Grant ·
      Void via prompt (all DB-verified); credit-notes listed · Not emailed + Resend shown ·
      Reversed filter · scoped reference search hit + miss · Export CSV download · empty-reason
      refusal · Cancel · Confirm void → Reversed (DB-verified); wages rain toggle + pay-day clamp
      to 28 (DB-verified) · Shadow role re-prefills the amount · Calculate payroll → Draft ·
      breakdown opens (`Sat, 6 Jun · Saturday Beginners · 60 min · S$40.00`) and closes.
      Screenshots `handcheck-lc-{accounting,referrals,credit-notes,wages,wages-expanded}.png`
      (scratchpad). Resend was NOT pressed (it would invoke the real email function). **No product
      finding.** Two script reds, both the script: `launch()` already registers a dismissing
      dialog handler (the Void prompt got dismissed → "already handled"), and
      `button[aria-expanded="false"]` matched a collapsed sidebar group before the payout row.

**Gate cleared:** nightly `35187663332` (classes, `7b19d8d`) went GREEN 2026-09-17 07:18 UTC
(1h23m) → fast-forwarded to `main`, pushed, branch deleted. **Wait for a nightly on L-C
before the next unit.**

## §12 — findings for `/update-docs` (append as they arise)

_**Graduated 2026-09-17 (`/update-docs`, §8.109):** doc pointers repointed in ARCHITECTURE §10 /
TESTING / GOTCHAS §7.152 (plans left as historical records); the path-pin + verbatim-script +
hand-check-script lessons → playbook §2/§4; the missing driver → `BACKLOG.md` (`verify-money-admin`)._

- **Moved-module doc pointers.** `lib/payoutItems.ts` is cited by path in `docs/ARCHITECTURE.md`,
  `docs/GOTCHAS.md`, `docs/TESTING.md`, `docs/plans/CLASS_SHADOW_COACHES_PLAN.md`;
  `lib/creditNoteEmailState.ts` in ARCHITECTURE + TESTING; `lib/creditNoteVoidState.ts` in
  TESTING; `lib/accounting.ts` in `docs/plans/SGT_DISPLAY_PLAN.md`. (Precedent: `classes` left
  `lib/classRoster.ts` stale in ARCHITECTURE §618 — same sweep can fix both.)
- **A moved `lib/` module can be path-pinned in a DRIFT TEST's allowlist, which `tsc` never
  sees.** `lib/accounting.ts` sat in `ALLOWED` of both `sgDisplay.drift.test.ts` twins (a
  Number formatter + a UTC-built Date). After the `git mv` the scanner found the same lines at
  the new path, unpinned → 2 red in vitest AND 2 red in jest. Fix: repoint the `file:` in both
  twins (same allowance, new path). **Before moving a helper, `git grep "lib/<mod>" -- '*.test.ts'`
  too** — the sole-importer grep only finds imports. Candidate addition to playbook §2's move note.
